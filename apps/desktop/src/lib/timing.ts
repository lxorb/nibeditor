/** Doing something later: after a moment, after the asking stops, or once in the
 *  next frame.
 *
 *  Three shapes, and the app had written them out about fifty times between them.
 *  Seven modules each had their own two-line promise around `setTimeout`; two
 *  dozen held a timer id in a field, cleared it and set it again on every call,
 *  and remembered to clear it on the way out in most of those places; nine more
 *  held a frame id and checked it before asking for another. The copies had drifted
 *  in the ways copies do - some cancelled on teardown and some did not, and one
 *  store's trailing write could not be hurried along, so closing the window lost
 *  it.
 *
 *  None of these is a clock. `pollDelay` and `roomDelay` in backoff.ts say how
 *  long to wait and are tested on their own; this is only the waiting. */

/** A promise that settles after `ms`, or after a turn of the event loop where no
 *  time is given.
 *
 *  Not `breathe()`, which is the other half of this: that one hands the thread
 *  back to the browser in the middle of a long pass and comes back at the front
 *  of the queue. This is a wait. */
export function waited(ms = 0): Promise<void> {
  return new Promise((go) => setTimeout(go, ms))
}

/** A call that happens later, and the two things worth doing to a waiting one. */
export interface Later {
  (): void
  /** Drops a waiting call. Nothing happens until the next one asks. */
  cancel(): void
  /** Runs a waiting call now. Does nothing where none is waiting, so it is safe
   *  to say on the way out whether or not anything was typed. */
  flush(): void
}

/** `run`, once the calls have stopped for `ms`. Every call puts it off again, so a
 *  burst of keystrokes is one write and a burst of scroll events is one
 *  measurement.
 *
 *  The delay may be a function, for the two callers whose wait is not a constant:
 *  one reads it through `dur()`, which is zero where the reader asked for less
 *  motion, and one waits longer for a store than for a screen. It is read at each
 *  call rather than once, which is what makes that work.
 *
 *  `atMost` is how long the first call still waiting may be put off in all, for a
 *  caller whose calls may never stop: somebody typing without a pause for a minute
 *  still has their words written every couple of seconds. */
export function afterQuiet(
  run: () => void,
  ms: number | (() => number),
  atMost = Number.POSITIVE_INFINITY,
): Later {
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the first call that is still waiting arrived. */
  let since: number | undefined

  const waiting = () => {
    timer = undefined
    since = undefined
    run()
  }

  const later = () => {
    clearTimeout(timer)
    const now = Date.now()
    since ??= now

    const wait = typeof ms === 'number' ? ms : ms()
    timer = setTimeout(waiting, Math.max(0, Math.min(wait, since + atMost - now)))
  }

  later.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    since = undefined
  }

  later.flush = () => {
    if (timer === undefined) return

    clearTimeout(timer)
    timer = undefined
    since = undefined
    run()
  }

  return later
}

/** `run` once in the next frame, however many times it was asked for in this one.
 *
 *  For the work that reads the layout: a scroll event fires many times a frame and
 *  each measurement taken straight from one makes the browser lay the document out
 *  again there and then. The first call in a frame wins, which is what makes a
 *  burst cost one pass rather than the last one.
 *
 *  Where there are no frames at all - a test in node - the call happens on the next
 *  turn of the loop instead, so nothing has to branch on having a browser. */
export function onceAFrame(run: () => void): Later {
  let frame: number | undefined

  const arrive = () => {
    frame = undefined
    run()
  }

  const ask = (): number =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(arrive)
      : (setTimeout(arrive, 0) as unknown as number)

  const drop = (held: number) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(held)
    else clearTimeout(held as unknown as ReturnType<typeof setTimeout>)
  }

  const soon = () => {
    frame ??= ask()
  }

  soon.cancel = () => {
    if (frame !== undefined) drop(frame)
    frame = undefined
  }

  /** The frame's work now rather than in the frame. Here so every `Later` answers
   *  the same three calls; the drawing callers have no use for it. */
  soon.flush = () => {
    if (frame === undefined) return

    drop(frame)
    frame = undefined
    run()
  }

  return soon
}
