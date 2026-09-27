/** How wide each tab in a strip is, where it sits, and what fits inside it.
 *
 *  Chrome's rules, with Chrome's numbers: see docs/chrome-tabs.md for where each
 *  one comes from. Geometry and nothing else, so the whole of it can be read off a
 *  list of tabs in a test rather than off a running window; Tabs.svelte measures
 *  the room and draws what this answers.
 *
 *  Every width here is a tab's pitch - how far the next tab starts after this one.
 *  Chrome counts its widths with the eighteen pixels two neighbours overlap by,
 *  because its tabs share their feet; nib's sit edge to edge and draw the feet
 *  outside the box, so each of Chrome's widths is eighteen less here.
 *
 *  Everything counts along the strip, in the direction the interface reads: the
 *  caller multiplies by `i18n.factor` on the way to a transform. */

/** The four widths a tab can be given. */
export const WIDTH = {
  /** Where a tab stops growing: Chrome's 232 of body and a foot either side. */
  standard: 238,
  /** The narrowest the tab being read gets: its close button and nothing else. */
  active: 38,
  /** The narrowest any other tab gets, which is a sliver of its mark. */
  inactive: 14,
  /** A pinned tab, which is its mark and never changes. */
  pinned: 46,
} as const

/** From the tab's edge to its contents: half the gap between two tabs, and the
 *  padding inside the body. The contents of a tab are its width less twice this. */
const INSET = 3 + 8

/** The room a mark takes, and the room the close button takes with the gap in
 *  front of it. */
const MARK = 16
const CLOSE = 16 + 4

/** How much room an inactive tab's contents need before it shows its close
 *  button. Wider on a touch screen, where a finger aiming at the tab must not land
 *  on the cross instead. */
const CLOSE_FROM = 68
const CLOSE_FROM_TOUCH = 100

/** What the layout needs to know about a tab. */
export interface Sized {
  readonly pinned: boolean
  readonly active: boolean
}

/** A tab's place in the strip: where it starts, and how wide it is. */
export interface Bounds {
  x: number
  width: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const lerp = (from: number, to: number, at: number): number => from + (to - from) * at

const sum = (values: readonly number[]): number => values.reduce((all, one) => all + one, 0)

/** The three widths a tab has in the three totals the layout is solved against. */
function limits(tab: Sized): { least: number; crossover: number; preferred: number } {
  if (tab.pinned) return { least: WIDTH.pinned, crossover: WIDTH.pinned, preferred: WIDTH.pinned }

  return {
    least: tab.active ? WIDTH.active : WIDTH.inactive,
    crossover: WIDTH.active,
    preferred: WIDTH.standard,
  }
}

/** How wide each tab is, given the room the strip has for them.
 *
 *  Chrome's two regimes. With room for every tab at the active tab's least width,
 *  all of them are one width, somewhere between that and the standard one. With
 *  less, the active tab holds at its least width and only the others go on
 *  shrinking - so the note being read is the last name still worth reading.
 *
 *  `room` of null is a strip that has not been measured yet: every tab is as wide
 *  as it would like to be. */
export function widthsFor(tabs: readonly Sized[], room: number | null): number[] {
  const sizes = tabs.map(limits)
  if (room === null) return sizes.map((one) => one.preferred)

  const least = sum(sizes.map((one) => one.least))
  const crossover = sum(sizes.map((one) => one.crossover))
  const preferred = sum(sizes.map((one) => one.preferred))

  const roomy = room >= crossover
  const share = roomy
    ? preferred === crossover
      ? 1
      : clamp((room - crossover) / (preferred - crossover), 0, 1)
    : crossover === least
      ? 1
      : clamp((room - least) / (crossover - least), 0, 1)

  const widths = sizes.map((one) =>
    Math.floor(
      roomy ? lerp(one.crossover, one.preferred, share) : lerp(one.least, one.crossover, share),
    ),
  )

  // The pixels the rounding down left over, one each to the first tabs that can
  // still grow, so the strip ends exactly at the room rather than a few pixels
  // short of it. Nothing to hand out at either end of the scale.
  if (share <= 0 || share >= 1) return widths

  let spare = Math.floor(room - sum(widths))
  return widths.map((width, at) => {
    const one = sizes[at]
    const grows = !!one && (roomy ? one.crossover < one.preferred : one.least < one.crossover)
    if (spare <= 0 || !grows) return width

    spare -= 1
    return width + 1
  })
}

/** Where each tab starts, given how wide each one is: one after the other. */
export function placed(widths: readonly number[]): Bounds[] {
  let x = 0
  return widths.map((width) => {
    const one = { x, width }
    x += width
    return one
  })
}

/** Where the strip's tabs end, which is where the plus goes. */
export function endOf(bounds: readonly Bounds[]): number {
  const last = bounds[bounds.length - 1]
  return last ? last.x + last.width : 0
}

/** What a tab of this width shows.
 *
 *  `mark` and `close` are the two controls, `title` whether any of the name fits,
 *  and `centred` a tab too narrow for anything but its mark, which is then drawn in
 *  the middle and clipped rather than pushed off its own edge. */
export interface Parts {
  mark: boolean
  close: boolean
  title: boolean
  centred: boolean
}

/** Chrome's order of giving things up as a tab narrows: the active tab keeps its
 *  close button whatever happens and the mark goes first; any other tab keeps its
 *  mark and drops the close button once its contents are under 68 pixels. A pinned
 *  tab is its mark, and a tab narrower than the least inactive width is nothing at
 *  all - it is on its way in or out. */
export function partsFor(width: number, tab: Sized, touch = false): Parts {
  if (width < WIDTH.inactive) return { mark: false, close: false, title: false, centred: false }
  if (tab.pinned) return { mark: true, close: false, title: false, centred: true }

  const contents = width - 2 * INSET
  let left = contents

  if (tab.active) {
    left -= CLOSE
    const mark = left >= MARK
    if (mark) left -= MARK
    return { mark, close: true, title: left > 0, centred: false }
  }

  const close = contents >= (touch ? CLOSE_FROM_TOUCH : CLOSE_FROM)
  const mark = left >= MARK
  if (mark) left -= MARK
  if (close) left -= CLOSE

  if (!close && !mark) return { mark: true, close: false, title: false, centred: true }
  return { mark, close, title: left > 0, centred: false }
}

/** Which place in a strip a point along it is at: before every tab whose middle it
 *  has not reached. What a note out of the file list, or a tab out of another pane,
 *  is dropped at.
 *
 *  A pinned tab heads the strip against every drop, so what arrives unpinned
 *  arrives after the last of them. */
export function slotAt(
  bounds: readonly Bounds[],
  along: number,
  pinnedRun: number,
  pinned = false,
): number {
  const at = bounds.filter((one) => one.x + one.width / 2 < along).length
  return pinned ? Math.min(at, pinnedRun) : Math.max(at, pinnedRun)
}

/** The strip's order with one tab taken from `from` and put in at `to`. */
export function moved<T>(order: readonly T[], from: number, to: number): T[] {
  const rest = order.filter((_, at) => at !== from)
  const one = order[from]
  if (one === undefined) return [...order]

  return [...rest.slice(0, to), one, ...rest.slice(to)]
}

/** Where a tab would start if it were moved from `from` to `to`, given every
 *  tab's width in the strip as it stands. Moving a tab changes no width - only
 *  which tab is active or pinned does - so the widths travel with their tabs. */
function startIf(widths: readonly number[], from: number, to: number): number {
  return sum(moved(widths, from, to).slice(0, to))
}

/** The slot a tab being dragged belongs in: the one whose start is nearest to
 *  where the tab is being drawn. Which is Chrome's rule, and the same as saying a
 *  neighbour gives way once the dragged tab has passed its middle.
 *
 *  Only the slots its kind may have: a pinned tab among the pinned, any other
 *  after them. Ties go to the slot it is in, so a drag that has gone nowhere has
 *  moved nothing. */
export function nearestSlot(
  widths: readonly number[],
  from: number,
  x: number,
  pinnedRun: number,
  pinned: boolean,
  current = from,
): number {
  const low = pinned ? 0 : pinnedRun
  const high = pinned ? Math.max(pinnedRun - 1, 0) : widths.length - 1

  let best = clamp(current, low, high)
  let nearest = Math.abs(x - startIf(widths, from, best))

  for (let to = low; to <= high; to++) {
    const away = Math.abs(x - startIf(widths, from, to))
    if (away < nearest) {
      nearest = away
      best = to
    }
  }

  return best
}

/** How far the pointer has to have moved since the last reorder before the next
 *  one is taken: sixteen pixels at the standard width, less on a narrower tab.
 *  What keeps a tab dragged across a neighbour's middle from flicking back and
 *  forth on one pixel. */
export function reorderSlack(width: number): number {
  return Math.round((16 * width) / WIDTH.standard)
}

/** How far a tab being dragged may go: from the start of the strip to where it
 *  would sit flush against its end, the empty stretch after the last tab included. */
export function clampedStart(x: number, width: number, room: number): number {
  return clamp(x, 0, Math.max(0, room - width))
}

/** How far outside the strip a pointer may stray, above or below it, before a tab
 *  it is carrying comes out of the strip. More for a finger, which is less exact
 *  and hides what it is over. */
export const MAGNETISM = { mouse: 15, touch: 50 } as const

/** A rectangle, the way the browser hands one over. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Whether a point is still the strip's while a tab is being carried along it. */
export function holds(strip: Rect, x: number, y: number, magnetism: number): boolean {
  return (
    x >= strip.left &&
    x < strip.right &&
    y >= strip.top - magnetism &&
    y <= strip.bottom + magnetism
  )
}

/** After a tab is closed with the pointer, the others keep their widths until the
 *  pointer has left the strip: this far below it, and this far past its end. So a
 *  hand closing tab after tab finds the next close button already under it. */
const CLOSING_SLOP = { below: 40, past: 60 } as const

/** Whether the pointer is still near enough the strip to keep the widths. The
 *  strip's end is the reading end, which `factor` says. */
export function near(strip: Rect, x: number, y: number, factor: number): boolean {
  const left = strip.left - (factor < 0 ? CLOSING_SLOP.past : 0)
  const right = strip.right + (factor < 0 ? 0 : CLOSING_SLOP.past)

  return x >= left && x <= right && y >= strip.top && y <= strip.bottom + CLOSING_SLOP.below
}

/** The widths a strip keeps while tabs are being closed with the pointer: every
 *  tab that is still there keeps the width it had. A tab that has become active
 *  is let out to the active tab's least width if it was narrower than that, which
 *  is the one width Chrome also lets change.
 *
 *  Null where there is nothing to keep: a tab has arrived that was not there when
 *  the widths were taken, and a new tab ends the closing. */
export function keptWidths(
  tabs: readonly (Sized & { id: string })[],
  kept: ReadonlyMap<string, number>,
): number[] | null {
  const widths: number[] = []

  for (const tab of tabs) {
    const width = kept.get(tab.id)
    if (width === undefined) return null
    widths.push(tab.active && !tab.pinned ? Math.max(width, WIDTH.active) : width)
  }

  return widths
}

/** Whether closing a tab should hold the others still at all: only while they
 *  are narrower than they would like to be. At the standard width there is
 *  nothing for them to grow into, and the strip simply ends a tab sooner. */
export function worthKeeping(tabs: readonly Sized[], room: number | null): boolean {
  if (room === null) return false
  return sum(tabs.map((one) => limits(one).preferred)) > room
}

/** Whose separator shows. A hairline between two tabs that are both only their
 *  name on the frame, and none beside a tab with a fill of its own - the active
 *  one, the hovered one, the one being carried - which is outline enough. None
 *  after the last tab either: the plus is not a tab to be told apart from. */
export function separated(ids: readonly string[], filled: ReadonlySet<string>): Set<string> {
  const shown = new Set<string>()

  for (let at = 0; at < ids.length - 1; at++) {
    const here = ids[at]
    const next = ids[at + 1]
    if (here && next && !filled.has(here) && !filled.has(next)) shown.add(here)
  }

  return shown
}
