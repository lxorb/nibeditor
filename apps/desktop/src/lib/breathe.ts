/** Letting go of the thread, for a pass that has more to do than a frame's worth.
 *
 *  A long pass that yields nowhere is one task however many things it is made of,
 *  and a keystroke during it is a keystroke that appears when it ends. Awaited
 *  between chunks of work, this turns that one task into as many short ones with
 *  room for a keystroke between them.
 *
 *  Not an idle callback, which is what this was first written as: idle time is
 *  exactly what a launch does not have, and waiting for it turned a scan of three
 *  thousand notes from one second into two and a half. `scheduler.yield` is the
 *  one that answers this properly - it lets input through and comes back at the
 *  front of the queue rather than the back - and a timer is the same bargain more
 *  roughly where there is no scheduler.
 *
 *  Its own module rather than a function in startup.svelte.ts, where the rest of
 *  the launch order lives: the search worker breathes as well, and a worker that
 *  imported a file with runes in it would need the whole Svelte runtime to hand
 *  the thread back. See `scanLinks` in web/commands.ts, which is the pass that
 *  reads every note there is, and web/space-cache.ts, which is the one that holds
 *  them. */

/** What a browser that can be asked to hand the thread back offers. Chrome has
 *  it; the fallback below is for everything else. */
interface Yields {
  yield?: () => Promise<void>
}

export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Yields }).scheduler
  if (scheduler?.yield) return scheduler.yield()

  return new Promise((go) => setTimeout(go, 0))
}

/** A task of its own for whatever comes next.
 *
 *  `breathe` is the wrong tool where the point is *which task* the work lands in:
 *  `scheduler.yield` hands input through and then comes back at the front of the
 *  queue, which is exactly right for a long scan and exactly wrong for this. Asked
 *  to put a plane's parse in one task and the surface's mount in the next, it put
 *  both in one frame of a hundred and eighteen milliseconds - the two were still
 *  adjacent, which the browser's own attribution showed and a clock would not have.
 *
 *  A timer is a real task boundary, which is the whole of what is wanted here. */
export function nextTask(): Promise<void> {
  return new Promise((go) => setTimeout(go, 0))
}
