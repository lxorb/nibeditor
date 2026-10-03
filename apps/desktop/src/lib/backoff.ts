// How often syncing goes looking. Quick just after something happened, then
// slower the longer nothing does, and slower still when the window is not on
// screen: a change nobody can see does not need fetching yet. Coming back to
// the window resets it, so it is fast exactly while it is being watched.
const POLL_BUSY = 20_000
const POLL_IDLE_MAX = 120_000
const POLL_HIDDEN_MAX = 600_000

/** After a note is written, so an edit does not sit waiting for a slow timer. Long
 *  enough that a burst of writes becomes one pass. */
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

/** How long after the last change a document is written, in milliseconds.
 *
 *  Short, because nothing else keeps the words: a window killed a second after the
 *  typing stopped has lost nothing. Still a pause rather than a keystroke, so a
 *  burst of typing - whose gaps are shorter than this - is one write, and what a
 *  write costs is paid per pause and never per character. A web note's address
 *  follows the page on the same pause; see web-tab/keep.ts. */
export const SAVE_DELAY = 400

/** And the longest the first unwritten change waits while the changes never stop:
 *  somebody typing without a pause for a minute is written every couple of
 *  seconds all the same. */
export const SAVE_AT_MOST = 2000

/** A note the disk refused, tried again: soon, since most locks let go in a
 *  moment, then doubling to a minute. */
export function saveRetryDelay(tries: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, tries - 1), 60_000)
}

/** The heartbeat on the account's hub socket. The hub counts a device alive while its
 *  last beat is under thirty seconds old, so three can go missing before a lease this
 *  device holds is anybody else's; see docs/sync-v2.md section 6.2. */
export const BEAT_EVERY = 10_000

/** How long nobody may touch this computer before it tells its hub it is idle, which is
 *  what lets another computer have a web login without Use here. Five minutes: shorter
 *  hands a session over while somebody reads, longer makes them press Use here after
 *  switching computers (docs/sync-v2.md, open question 2). */
export const IDLE_AFTER = 5 * 60_000

/** How often the system is asked when it last had input, for the keys and the pointer
 *  that go to a web page rather than to the app's own; see presence.rs. A tenth of the
 *  idle time, so going idle is said at most half a minute late. */
export const INPUT_EVERY = 30_000

/** How long a page waits for its hub to say whose a web login is before it loads on
 *  this computer's own state anyway. The answer is one round trip on a socket already
 *  open, a few tens of milliseconds; a hub that has not answered in this long is a hub
 *  somewhere else, and the page is not kept waiting for it (the answer still arrives, and
 *  a login that turns out to be another computer's stops the page then). */
export const LEASE_WAITS = 800

/** While somebody is using a site, its cookies and localStorage go up this often, when
 *  they changed, so a computer that crashes loses at most this much of a login. */
export const LIGHT_EVERY = 2 * 60_000

/** A page that has finished loading sends its site's login up at most this often: a
 *  sign-in is several pages in a row, and each is worth keeping without every one being
 *  an upload. */
export const LIGHT_AT_MOST = 60_000

/** How long a site's lease is kept after its last tab closed before it is let go of,
 *  so closing a tab and opening the site again is not two trips to the hub. */
export const RELEASE_AFTER = 3_000

/** How long a window going waits for the web logins it holds to be handed back: inside
 *  the two seconds it already waits for the engine to keep its session cookies. What
 *  does not make it is the last upload from before, at most `LIGHT_EVERY` old. */
export const HANDS_BACK_WITHIN = 2_000
