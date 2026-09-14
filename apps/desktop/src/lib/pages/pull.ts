/** Pulling a new page into being past the end of a page note.
 *
 *  A page note is read by scrolling, and the one movement a reader makes at the
 *  end of it that means nothing else is carrying on downwards. So that is what
 *  adds a page: the silhouette of the next sheet rises out from under the last
 *  one, and letting go past a threshold makes it real. Nobody has to be told, and
 *  it is the same gesture with a thumb, a trackpad and a wheel.
 *
 *  The whole of the decision is here and pure, because it is arithmetic about a
 *  gesture and not about a screen: how far the silhouette comes for how far the
 *  reader pulled, when letting go would make a page, what a wheel that has
 *  stopped does next, and the two rules that keep a page from appearing by
 *  accident. The wiring - the events, the rubber on screen, the camera settling -
 *  is Pages.svelte. See pull.test.ts, and pull.svelte.ts for the other pull in
 *  this app, whose rubber is the same shape for the same reason.
 *
 *  **Three roads, one model.** A finger has a lift, so it pulls and then releases;
 *  a wheel has no lift at all, so its notches are added up and the page is made
 *  the moment the pull crosses the threshold, after which a wheel makes nothing
 *  for a moment - one long scroll is one page and never four. A trackpad's two
 *  fingers arrive as a wheel on every platform and take the wheel's road. */

/** How far the silhouette has to rise before letting go makes a page, in screen
 *  pixels.
 *
 *  A third of the page on screen, which is what "past the end of this sheet"
 *  looks like at any zoom - with a floor, because a third of a page seen from far
 *  away is a flick, and a ceiling, because a third of a page zoomed in is taller
 *  than the window and a threshold nobody can reach is a gesture that does not
 *  work. */
export const LEAST_REACH = 96
export const MOST_REACH = 160

/** How much further than the threshold the pull will come, as a multiple of it.
 *
 *  It is what makes the rubber rubber: the silhouette can never travel further
 *  than this, and the curve below approaches it. Three, which puts the threshold
 *  at half again the distance the hand has moved - pull 240 pixels and the page
 *  has risen 160 - and leaves somewhere to go for a reader who keeps pulling. */
const GIVE = 3

/** How long the pull falls back over once the wheel stops, in milliseconds. Long
 *  enough to read as the silhouette settling rather than blinking out, short
 *  enough that the next scroll starts from nothing. */
export const FALL = 250

/** How long a wheel makes nothing after a page was made, in milliseconds. A
 *  trackpad flick is a hundred events, and every one of them after the page is
 *  the same gesture still arriving. */
export const SETTLE = 300

/** The threshold for a page this tall on screen. */
export function reachFor(pageOnScreen: number): number {
  return Math.min(MOST_REACH, Math.max(LEAST_REACH, pageOnScreen / 3))
}

/** How far the silhouette has risen for a pull of `raw` pixels.
 *
 *  Rubber: the first pixels are the reader's own, one for one, and the further it
 *  goes the less each one buys, approaching `reach * GIVE` and never passing it.
 *  That is what tells a hand it is reaching for something rather than dragging
 *  it, and it is the curve iOS overscroll draws.
 *
 *  `still` is a reader who has asked their system for as little movement as
 *  possible. The rubber is the app moving something further than the hand did, so
 *  it goes; what is left is the silhouette following the hand exactly, which is
 *  the reader's own movement rather than the app's. */
export function risen(raw: number, reach: number, still = false): number {
  if (raw <= 0) return 0

  const most = reach * GIVE
  if (still) return Math.min(most, raw)

  return Math.min(most, raw / (1 + raw / most))
}

/** Whether letting go now would make a page. */
export function armed(rise: number, reach: number): boolean {
  return rise >= reach
}

/** What is left of a pull `elapsed` milliseconds after the last notch of the
 *  wheel: all of it at once, then less and less, and nothing at all once the fall
 *  is over.
 *
 *  This is also what adds a scroll up: a wheel notch asks how much of the last one
 *  is still standing before adding its own, which is what turns a trackpad's
 *  hundred small deltas into one pull and a scroll a second later into none.
 *
 *  A reader who asked for no movement keeps the whole of it and then has none:
 *  reduced motion means the app does not ease it away, not that a gesture has no
 *  memory - without the memory a trackpad, whose deltas are five pixels each,
 *  could never reach the threshold at all. */
export function fallen(raw: number, elapsed: number, still = false): number {
  if (elapsed >= FALL || raw <= 0) return 0
  if (still || elapsed <= 0) return raw

  const left = 1 - elapsed / FALL
  return raw * left * left
}

/** Whether a scroll that starts here may reach a new page at all: the bottom of
 *  the view has to be in the lower half of the last page already.
 *
 *  Which is the rule that stops a fling. A page note is read by scrolling, and a
 *  hard flick from the top of a sixty page note passes the end of the column with
 *  hundreds of pixels of wheel left over; without this it would arrive at the
 *  bottom and make a page out of momentum. Somebody who means to add a page is
 *  somebody who is already looking at the end of the last one.
 *
 *  In plane units, both of them, because that is what the surface has. */
export function startedNearEnd(
  viewBottom: number,
  last: { y: number; height: number } | null,
): boolean {
  if (!last) return false

  return viewBottom >= last.y + last.height / 2
}

/** A pull under way, or the absence of one.
 *
 *  `raw` is what the reader has asked for in screen pixels, before the rubber:
 *  how far the finger has carried past the end of the column, or the wheel
 *  notches added up. `at` is when it last grew, which is what the fall is
 *  measured from. */
export interface Pulling {
  raw: number
  at: number
  /** Whether this gesture began near the end, so it may make a page. */
  allowed: boolean
  /** Whether a finger is still down, which is what holds the fall off. */
  holding: boolean
  /** Until when a wheel adds nothing, so one long scroll makes one page. */
  quiet: number
}

export function noPull(): Pulling {
  return { raw: 0, at: 0, allowed: false, holding: false, quiet: 0 }
}

/** A gesture beginning: a finger landing, or the first wheel after a quiet
 *  moment. `near` is `startedNearEnd`, asked by the surface because only the
 *  surface knows where the view is. */
export function began(pull: Pulling, near: boolean, now: number): Pulling {
  return { ...pull, raw: 0, at: now, allowed: near, holding: false, quiet: pull.quiet }
}

/** How far the silhouette is up, now. A finger holds it where it is; a wheel that
 *  has stopped lets it fall. */
export function riseOf(pull: Pulling, reach: number, now: number, still = false): number {
  const raw = pull.holding ? pull.raw : fallen(pull.raw, now - pull.at, still)
  return risen(raw, reach, still)
}

/** What one notch of the wheel past the end of the column comes to.
 *
 *  Answers the pull as it now stands and whether this is the notch that makes the
 *  page. A wheel has no lift, so the threshold itself is the moment: crossing it
 *  makes the page and starts the quiet, and the pull goes back to nothing because
 *  the silhouette has become a sheet. */
export function wheeled(
  pull: Pulling,
  said: { delta: number; reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { delta, reach, now, still = false } = said

  // Still the same gesture arriving: one long scroll is one page.
  if (now < pull.quiet) return { pull: { ...pull, raw: 0, at: now }, makes: false }
  if (!pull.allowed || delta <= 0) {
    return { pull: { ...pull, raw: fallen(pull.raw, now - pull.at, still), at: now }, makes: false }
  }

  const raw = fallen(pull.raw, now - pull.at, still) + delta
  if (armed(risen(raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: { ...pull, raw, at: now, holding: false }, makes: false }
}

/** A finger carried past the end of the column. `raw` is the whole overscroll it
 *  is asking for, not a step, so dragging back up gives it back.
 *
 *  Answers whether this is the moment the page is made, which for a reader who
 *  asked for no movement is the threshold itself: there is no rubber to spring
 *  and nothing to wait for. Everybody else gets the page when they let go. */
export function dragged(
  pull: Pulling,
  said: { raw: number; reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { raw, reach, now, still = false } = said
  if (!pull.allowed || now < pull.quiet) return { pull, makes: false }

  const held = { ...pull, raw: Math.max(0, raw), at: now, holding: true }
  if (still && armed(risen(held.raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: held, makes: false }
}

/** The finger lifted. Past the threshold it makes the page; short of it the pull
 *  springs back from wherever it got to. */
export function lifted(
  pull: Pulling,
  said: { reach: number; now: number; still?: boolean },
): { pull: Pulling; makes: boolean } {
  const { reach, now, still = false } = said
  if (!pull.holding) return { pull: { ...pull, holding: false }, makes: false }

  if (pull.allowed && armed(risen(pull.raw, reach, still), reach)) {
    return { pull: { ...noPull(), at: now, quiet: now + SETTLE }, makes: true }
  }

  return { pull: { ...pull, at: now, holding: false }, makes: false }
}
