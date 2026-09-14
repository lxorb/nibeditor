/** The window's half of the launch trace; see src-tauri/src/trace.rs.
 *
 *  The crate times its own setup and the machine's work before it. This times what
 *  happens after the page is handed to the webview: the modules being evaluated,
 *  the stores being read, the first frame, and each stage of the queue in
 *  startup.svelte.ts. Both lists end up on one axis in one file, so the answer to
 *  "where did the ten seconds go" is one page rather than two that have to be
 *  lined up by hand.
 *
 *  Always marked, never sent unless asked. A mark is a string and a number on an
 *  array - cheaper than the `console.log` it replaces - and nothing leaves the
 *  window until `sendTrace`, which the crate ignores when the switch is off. So
 *  there is no build to make and no flag to pass: the app somebody already has is
 *  the app that can answer this.
 *
 *  `performance.timeOrigin` goes with the marks because it is the only thing that
 *  places them: a mark is milliseconds since the webview began loading the page,
 *  which is some way into a launch and is not the crate's zero. */

import { invoke, isNative } from './tauri'

/** One step, as the crate reads it. */
interface Step {
  step: string
  at: number
}

/** What has been marked so far, in the order it happened. */
const STEPS: Step[] = []

/** Past this the list stops growing. A launch is a few dozen steps; anything that
 *  marks in a loop is a bug, and a bug here should not be a leak. */
const MOST = 200

/** How long after the launch order finishes the trace is handed over.
 *
 *  Not at once. The stages the order lets go of are only *started* by it - the scan
 *  of the space, the search's own read, the papers - and those are exactly the
 *  steps somebody tracing a slow launch wants to see land. So the trace waits for
 *  them, on a timer rather than on an idle callback: the launch order costs the
 *  callbacks it costs, and a diagnostic has no business adding one to it. */
const SETTLE = 3000

/** Whether the trace has already been handed over, so the stages that finish after
 *  it do not send the same launch twice. */
let sent = false

/** One step of the launch, now. */
export function mark(step: string): void {
  if (STEPS.length >= MOST) return
  STEPS.push({ step, at: performance.now() })
}

/** One step of the launch, on the frame after now.
 *
 *  For the steps that are about pixels rather than about code: "the shell is on
 *  screen" is not the moment the markup was handed over, it is the moment after the
 *  browser has drawn it. Two frames, because the first callback runs before the
 *  paint it was scheduled for and the second is the first moment the pixels are
 *  really there - the same two frames every drive in test/e2e waits for. */
export function markPainted(step: string): void {
  requestAnimationFrame(() => requestAnimationFrame(() => mark(step)))
}

/** The first thing somebody did, once.
 *
 *  What "interactive" means for a launch: not a clock reaching a number, but a key
 *  or a pointer being answered in the frame it happened in. A probe nobody touches
 *  never records it, and that is honest - there is nothing to record. Listened for
 *  in the capture phase so it is marked before whatever handles it, and taken off
 *  after the first one: the question is about the launch, not about the session. */
export function watchFirstInput(): void {
  const kinds = ['keydown', 'pointerdown'] as const
  const heard = () => {
    mark('interactive: first input answered')
    for (const kind of kinds) removeEventListener(kind, heard, true)
  }

  for (const kind of kinds) addEventListener(kind, heard, { capture: true, once: false })
}

/** Hands the launch over to the crate, which writes it beside its own steps if the
 *  switch is on and drops it if it is not.
 *
 *  The navigation's own timings go with it: how long the page took to be fetched
 *  and parsed is the webview's part of the launch, and it is the part no mark of
 *  ours can see. Only in the app - a browser tab has no crate to write a file. */
export function sendTrace(): void {
  if (sent || !isNative) return
  sent = true

  setTimeout(() => {
    void invoke('trace_startup', {
      origin: performance.timeOrigin,
      steps: [...navigationSteps(), ...STEPS],
    }).catch(() => undefined)
  }, SETTLE)
}

/** What the webview did before the first line of the app ran, as the navigation
 *  entry reports it. Nothing at all where the entry is missing, which is every
 *  engine that does not keep one. */
function navigationSteps(): Step[] {
  // `at` rather than an index, because a webview that keeps no navigation entry
  // hands back an empty list and there is nothing to time.
  const entry = performance.getEntriesByType('navigation').at(0) as
    PerformanceNavigationTiming | undefined
  if (!entry) return []

  return [
    { step: 'page requested', at: entry.fetchStart },
    { step: 'page arrived', at: entry.responseEnd },
    { step: 'page parsed', at: entry.domContentLoadedEventEnd },
    { step: 'page and assets loaded', at: entry.loadEventEnd },
  ].filter((one) => one.at > 0)
}
