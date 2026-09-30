import type { StateEffect } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { RunnableFence } from './door'
import { addRunLines, closeRun, dropRun, openRun, runPanels } from './panel'
import { frameScript } from '../web-frame'
import { parseRunMessage, runnerDocument } from './protocol'

/** How long the code may run before it is stopped and reported as timed out. A
 *  synchronous loop cannot be interrupted from outside, so this is not a
 *  deadline the code is asked to meet: it is when the sandbox is taken down.
 *
 *  Counted from the sandbox saying it is about to start, not from the click. A
 *  frame with an opaque origin is a browser process of its own, and on a loaded
 *  machine it can be seconds coming up; charging that to the note's code would
 *  time out programs that never got to run. */
const RUN_TIME_LIMIT = 10_000

/** How long the sandbox itself has to come up before the run is given up on.
 *  Generous on purpose: this is a browser starting a process, and a machine
 *  that is already fully loaded can take tens of seconds over it. Giving up
 *  earlier would report a timeout against code that never got to run. */
const RUN_START_LIMIT = 45_000

/** A sandbox on screen: the frame the code runs in, and what has to be undone
 *  when it goes. */
interface Sandbox {
  view: EditorView
  frame: HTMLIFrameElement
  /** Rearmed once the code starts; see RUN_TIME_LIMIT. */
  timer: number
  listener: (event: MessageEvent) => void
  /** Whether the sandbox has said it is starting. Recorded so it can only say
   *  so once: `ready` moves the deadline, and the code inside can post one of
   *  its own. It cannot reach another block's panel - the run number is
   *  checked - but it could keep its own frame alive for as long as it liked. */
  started: boolean
  /** Whether the code finished on its own. Such a sandbox is kept for a while
   *  on purpose, so a timer or a promise it left behind can still reach the
   *  panel; the sweep below has to know not to take it away early. */
  finished: boolean
}

const live = new Map<number, Sandbox>()

let counter = 0

/** Starts the code of one fence in a fresh sandbox, replacing whatever that
 *  fence was running before. Returns false when the editor has no panels to
 *  show them in, which is what source mode looks like from here. */
export function runFence(view: EditorView, fence: RunnableFence): boolean {
  const panels = view.state.field(runPanels, false)
  // And a build with no frame script is a build with nothing to run code in; see
  // web-frame.ts.
  const script = frameScript()
  if (!panels || script === null) return false

  // One run per block. The old sandbox goes now rather than when its timer is
  // up, so a note being iterated on does not stack up frames.
  for (const panel of panels) {
    if (panel.from === fence.from) teardown(panel.run)
  }

  const run = ++counter
  const startedAt = Date.now()
  view.dispatch({ effects: openRun.of({ run, from: fence.from, to: fence.to, startedAt }) })

  const frame = document.createElement('iframe')
  // No `allow-same-origin`, so the document inside has an opaque origin: it
  // shares nothing with the app and cannot read it. The policy the document
  // carries takes away the network as well; see protocol.ts.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.title = 'nib runner'
  // Hidden, but not `display: none`: a frame with no box still runs its
  // scripts, and this way it stays out of the layout without relying on that.
  frame.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden'

  const expire = () => {
    // Only a run that never finished timed out. One that did is simply over,
    // and its sandbox has been kept this long in case a timer or a promise it
    // left behind still had something to say.
    //
    // Reported as the time that actually passed, not as the limit that ran out.
    // The panel counts up from `startedAt` while the run is going, so giving it
    // the limit made the number it was showing jump backwards at the moment it
    // stopped - and told a run that never started that it had had ten seconds.
    const elapsed = Date.now() - startedAt
    view.dispatch({ effects: closeRun.of({ run, status: 'timeout', elapsed }) })
    teardown(run)
  }

  const listener = (event: MessageEvent) => {
    // The only sender that counts is the frame this run made. Origin is no help
    // here: a sandboxed document's origin is opaque, so it reports as null.
    if (event.source !== frame.contentWindow) return

    const message = parseRunMessage(event.data, run)
    if (!message) return

    const sandbox = live.get(run)
    if (!sandbox) return

    // Honoured once. The startup allowance is generous because a browser may be
    // starting a process; the run's own allowance begins the moment it says so,
    // and a second `ready` would push it out again for as long as the code cared
    // to keep saying it.
    if (message.ready && !sandbox.started) {
      sandbox.started = true
      window.clearTimeout(sandbox.timer)
      sandbox.timer = window.setTimeout(expire, RUN_TIME_LIMIT)
    }

    const effects: StateEffect<unknown>[] = []
    if (message.lines.length) effects.push(addRunLines.of({ run, lines: message.lines }))
    if (message.done) {
      sandbox.finished = true
      effects.push(closeRun.of({ run, status: 'done', elapsed: Date.now() - startedAt }))
    }
    if (effects.length) view.dispatch({ effects })
  }

  window.addEventListener('message', listener)

  live.set(run, {
    view,
    frame,
    listener,
    timer: window.setTimeout(expire, RUN_START_LIMIT),
    started: false,
    finished: false,
  })

  // The document is set before the frame joins the page, so the frame has it to
  // load rather than an empty one to be navigated away from a moment later.
  frame.srcdoc = runnerDocument(fence.code, run, script)
  // Appended to the page rather than into the panel: the panel is a widget, and
  // redrawing it on every line of output would restart the code each time.
  document.body.append(frame)

  return true
}

/** Stops a run by taking its sandbox away, which is the only way to stop code
 *  that is not asking to be stopped. */
function teardown(run: number) {
  const sandbox = live.get(run)
  if (!sandbox) return

  live.delete(run)
  window.clearTimeout(sandbox.timer)
  window.removeEventListener('message', sandbox.listener)
  sandbox.frame.remove()
}

/** Watches for a run losing its panel, and takes the sandbox down with it. A run
 *  that finished on its own keeps its sandbox until the time limit, so a promise
 *  it left pending still reaches the panel.
 *
 *  Kept out of the panel's own DOM so that the state stays the single account of
 *  what is running: the buttons dispatch, and this reacts.
 *
 *  The panels are compared rather than the effects watched, because a panel can
 *  go without any effect saying so: deleting the block, or deleting its fence
 *  characters, drops it in `runPanels.update` (see panel.ts). Watching only the
 *  effects left the frame, the timer and the message listener behind, with the
 *  code still running and no Stop button anywhere - and a later run of the same
 *  block then started alongside it. */
const runSandboxes = ViewPlugin.define((view) => ({
  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        // Said out loud rather than left to the sweep: a run cut short goes now,
        // whether or not its panel is still on screen.
        if (effect.is(dropRun)) teardown(effect.value)
        else if (effect.is(closeRun) && effect.value.status !== 'done') teardown(effect.value.run)
      }
    }

    const panels = update.state.field(runPanels, false)
    if (!panels || panels === update.startState.field(runPanels, false)) return

    const shown = new Set(panels.map((panel) => panel.run))
    for (const [run, sandbox] of [...live]) {
      if (sandbox.view === view && !sandbox.finished && !shown.has(run)) teardown(run)
    }
  },

  destroy() {
    // The view is going, or live preview was switched off. Either way nothing
    // is left to show the output, so nothing should still be running.
    for (const [run, sandbox] of [...live]) {
      if (sandbox.view === view) teardown(run)
    }
  },
}))

/** The panels and the sandboxes behind them, which door.ts puts into every editor
 *  that draws a Run button once the first one is pressed. */
export const runExtension = [runPanels, runSandboxes]
