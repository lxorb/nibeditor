// How often syncing goes looking. Quick just after something happened, then
// slower the longer nothing does, and slower still when the window is not on
// screen: a change nobody can see does not need fetching yet. Coming back to
// the window resets it, so it is fast exactly while it is being watched.
const POLL_BUSY = 20_000
const POLL_IDLE_MAX = 120_000
const POLL_HIDDEN_MAX = 600_000

/** After a local save, so an edit does not sit waiting for a slow timer. Long
 *  enough that a burst of saves becomes one pass. */
export const NUDGE_DELAY = 2_000

/** How long a nudge leaves before the next pass, given how long the pass already
 *  planned has left.
 *
 *  Sooner, never later. A nudge exists to bring a pass forward, and the one already
 *  planned may be nearer than the nudge's own delay - at a launch it is due at once
 *  - so re-planning it for later would postpone the very sync the nudge is asking
 *  for, and go on postponing it for as long as somebody kept typing. Its own
 *  function, beside the interval it belongs to, so the rule can be read and tested
 *  without a clock. */
export function nudgeDelay(left: number): number {
  return Math.min(NUDGE_DELAY, Math.max(0, left))
}

/** Spaces are made and renamed rarely. Asking on every pass was most of the
 *  traffic and almost none of the answers. */
export const RECONCILE_INTERVAL = 300_000

/** How long to wait before looking again. Doubles for every pass that found
 *  nothing, up to a cap that depends on whether anyone is there to see the
 *  answer. Its own module so it can be tested without starting a workspace. */
export function pollDelay(quiet: number, hidden: boolean): number {
  return Math.min(POLL_BUSY * 2 ** quiet, hidden ? POLL_HIDDEN_MAX : POLL_IDLE_MAX)
}

/** A room's socket, which is a different shape of waiting. The first try is at
 *  once, because the usual reason a socket closed is a network that came back a
 *  moment later and a note somebody is writing in should rejoin before they
 *  notice. After that it doubles, to a cap short enough that a laptop opened after
 *  lunch is back in the note by the time the words are on screen. */
const ROOM_FIRST = 400
const ROOM_MAX = 20_000

/** Spread either side of the wait, so a machine that lost twenty notes at once
 *  does not ask for all of them in the same millisecond. */
const ROOM_SPREAD = 0.3

export function roomDelay(tries: number, spread = Math.random()): number {
  const wait = Math.min(ROOM_FIRST * 2 ** Math.max(0, tries - 1), ROOM_MAX)
  return Math.round(wait * (1 + ROOM_SPREAD * (spread * 2 - 1)))
}
