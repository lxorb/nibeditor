/** The order the app comes up in.
 *
 *  One rule: the file list is painted before anything reads a note. A tree is a
 *  directory listing, which is cheap on any machine and instant on a phone; the
 *  things that make it complete - which notes link to which, what a note chose as
 *  its icon, what can be searched - all read every body in the space, and a
 *  thousand bodies is the difference between a launch that is there and a launch
 *  somebody waits through. So they wait instead, and they wait in a stated order.
 *
 *  `shown` is the line between the two. Whoever has just put something on screen
 *  awaits it, the browser gets its frame, and only then does the queue behind it
 *  start moving. Everything after that asks for its turn by name, and the turns
 *  come one idle callback apart in the order below: the index first, because a
 *  note's icon and every link in the open note come out of it; then the search
 *  index; then the icon sets, which are fetched rather than read; then the rooms,
 *  which are a socket per open note and the one thing here that nobody is looking
 *  at while it happens; and last the doors - the parts of the app that are fetched
 *  rather than carried and that a single keystroke can ask for, which is the one
 *  stage that exists so that something is *already* there rather than so that it
 *  arrives late. See `warmDoors` in surfaces.svelte.ts. The two sides' panels are
 *  the same bargain and come after it, built shut so that opening one is a column
 *  sliding over rows already laid out (see App.svelte): the left and then the
 *  right, a turn each, because a file list and a panel built in one breath held the
 *  thread for longer than a key may wait, and either one alone does not.
 *
 *  A turn is when a stage may *start*, not when it has finished. The index takes
 *  as long as the space is large, and a phone that had to finish scanning before
 *  it would open a socket would be a phone that never opened one.
 *
 *  `breathe` is the other half of the same idea, for inside one of those stages: a
 *  pass long enough to be worth breaking up hands the thread back with it. It
 *  lives in breathe.ts, because the search worker breathes too and a worker has no
 *  runes runtime to load this file with.
 *
 *  Nothing here is about a particular store, which is why it is not in any of
 *  them: the order is the app's, and an order spread across five files is not an
 *  order anybody can read. */

import { mark, sendTrace } from './trace'

/** The stages, in the order their turns come. */
const STAGES = ['index', 'search', 'icons', 'rooms', 'doors', 'left', 'right'] as const

/** Not exported, because nothing outside says a stage except by name: the words
 *  below are the only ones there are, and a caller that gets one wrong is a type
 *  error at the call site. */
type Stage = (typeof STAGES)[number]

/** A frame the browser has actually painted.
 *
 *  Two of them: the first callback runs before the paint it was scheduled for, so
 *  the second is the first moment the pixels are on screen. Under node there are
 *  no frames and a macrotask is the honest stand-in - it still yields, which is
 *  the whole of what a caller wants. */
function frame(): Promise<void> {
  return new Promise((go) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(go, 0)
      return
    }

    requestAnimationFrame(() => requestAnimationFrame(() => go()))
  })
}

/** A moment the browser has nothing better to do, or soon enough either way: a
 *  launch that idles forever behind a busy main thread has simply not happened. */
function idle(): Promise<void> {
  return new Promise((go) => {
    if (typeof requestIdleCallback !== 'function') {
      setTimeout(go, 0)
      return
    }

    requestIdleCallback(() => go(), { timeout: 500 })
  })
}

class Startup {
  /** How many stages have had their turn. Reactive, so markup and effects can
   *  ask without polling; see `reached`. */
  private at = $state(0)
  /** Who is waiting for which turn. */
  private waiting = new Map<Stage, (() => void)[]>()
  /** Whether the queue has been set going, so a second paint does not run it
   *  again and a window that paints twice keeps one order. */
  private moving = false

  /** What is on screen is painted, and everything that reads a body may go.
   *
   *  Awaited by whoever put it there. It both yields the frame and starts the
   *  queue, because those are one moment and splitting them into two calls is how
   *  one of them gets forgotten at a new call site. */
  async shown(): Promise<void> {
    await frame()
    mark('first frame painted')
    if (!this.moving) void this.run()
  }

  /** This stage's turn.
   *
   *  A stage whose turn has passed waits for the next frame rather than for the
   *  queue: the launch is over, so there is nothing to be after, but there is still
   *  something on screen to be after. Opening a second space is the case - the
   *  listing lands, the rows go up, and the scan of every body in it starts on the
   *  frame after that rather than in the same breath. */
  async turn(stage: Stage): Promise<void> {
    if (this.reached(stage)) {
      await frame()
      return
    }

    await new Promise<void>((go) => {
      const queue = this.waiting.get(stage) ?? []
      queue.push(go)
      this.waiting.set(stage, queue)
    })
  }

  /** Whether this stage's turn has come. Reactive. */
  reached(stage: Stage): boolean {
    return this.at > STAGES.indexOf(stage)
  }

  /** Everything from here is a test starting again. */
  reset() {
    this.at = 0
    this.waiting.clear()
    this.moving = false
  }

  private async run() {
    this.moving = true

    for (const stage of STAGES) {
      await idle()
      this.at = STAGES.indexOf(stage) + 1
      mark(`${stage} may start`)

      // Taken before they are called: a waiter that asks for a later turn from
      // inside its own would otherwise be walked over by this same loop.
      const queue = this.waiting.get(stage) ?? []
      this.waiting.delete(stage)
      for (const go of queue) go()
    }

    // The launch is over as far as the order is concerned, so whatever was timed
    // goes to the crate to be written beside its own steps; see trace.ts. Nothing
    // is awaited for it: the order costs the seven idle callbacks above and not one
    // more, and the trace waits on a timer of its own.
    mark('launch order finished')
    sendTrace()
  }
}

export const startup = new Startup()
