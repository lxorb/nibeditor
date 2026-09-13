/** Which rows of a long list are worth having in the page.
 *
 *  A space of three thousand notes is three thousand buttons, three thousand
 *  marks and three thousand reads of the link index, and all of it for the
 *  twenty-odd rows a panel can show at once. So the list keeps a window: the
 *  rows in view plus a little either side, with the rest of the height standing
 *  in as two empty boxes, one above and one below.
 *
 *  Every row in a list is exactly one row tall - `--row-height` under a pointer,
 *  `--touch-row` under a thumb, and nothing else, because the label is one line
 *  that gives way with an ellipsis; see `.nib-row` and `.nib-row-label` in the
 *  themes package. So no row is ever measured: where a row sits is `index *
 *  height`, and opening a note's children lengthens the list rather than any row
 *  in it.
 *
 *  Pure, which is the point: what mounts for a given scroll position is
 *  arithmetic, and arithmetic can be read as a table of numbers instead of
 *  driven with a mouse. See row-window.test.ts.
 *
 *  One fold is the exception to "no row is measured", and it is still not a
 *  measurement: while a note's children are sliding into place the band of new
 *  rows is only part way out, so the rows in it are drawn short and clipped and
 *  everything under them sits that much higher. How much is a number this is
 *  told - `grown`, in rows - so the whole slide is this same arithmetic asked once
 *  a frame with one number changed. */

/** A note's children on their way in or out.
 *
 *  `at` is the row that was twisted open, `rows` how many appeared under it, and
 *  `grown` how many of those are out so far: 0 the moment the twist turns, `rows`
 *  once the slide is over, and a fraction in between. Going shut is the same
 *  number running back down. */
export interface Fold {
  at: number
  rows: number
  grown: number
}

/** A list, as the window arithmetic sees it. All lengths in pixels; `top` and
 *  `room` are the scroller's, measured against the list's own first row, so `top`
 *  is negative while there is something above the list still on screen. */
export interface Rows {
  /** How many rows the list has, mounted or not. */
  count: number
  /** How tall one row is. */
  height: number
  /** How far down the list the scroller has reached. */
  top: number
  /** How much of it the scroller can show. */
  room: number
  /** How many rows to keep beyond either edge, so a scroll of one row does not
   *  arrive at an empty box. */
  overscan: number
  /** A fold on the move, or null while the list is still. */
  fold?: Fold | null
  /** Rows the list must hold on to wherever they are: the row with the keyboard on
   *  it, the row whose name is being typed, and the row a key or an open has just
   *  asked for. A focus inside a row that is taken out of the page is a focus on
   *  nothing, and the arrows stop working. */
  pinned?: readonly number[]
}

/** The rows to draw, and the two boxes that stand in for the rest. */
export interface RowWindow {
  /** The first and last row to mount, inclusive. `last` is -1 for a list with
   *  nothing in it. */
  first: number
  last: number
  /** Rows inside that stretch with nothing to draw: the part of a fold's band that
   *  is not out yet, which is flat, stacked at the band's edge, and as long as a
   *  note holding four hundred notes. A row no pixels high adds no pixels to the
   *  flow, so leaving it out moves nothing - and leaving four hundred of them out is
   *  the difference between a slide and a stutter. Null while no fold is moving. */
  skip: { from: number; to: number } | null
  /** How tall the box above the first of them is, and the one below the last. */
  above: number
  below: number
  /** Those of them that fall outside the slice, in order, and so have to be drawn
   *  at their own offsets rather than in the flow - the flow between the two boxes
   *  is the slice. Empty whenever the slice already holds them. */
  pinned: number[]
}

/** The box a list scrolls in: the nearest ancestor that scrolls.
 *
 *  A list does not own its scroller. The file list shares the panel's body with
 *  the bookmarks above it, and the Links panel's body holds three lists one after
 *  another - so where a list's window is depends on a box it does not know about,
 *  and it finds it by looking up. Here rather than in row-window.svelte.ts because
 *  it is a walk of parents and a string comparison, which needs no runes and can
 *  be read without a browser. */
export function scrollerOf(from: HTMLElement): HTMLElement | null {
  for (let box = from.parentElement; box; box = box.parentElement) {
    const flow = getComputedStyle(box).overflowY
    if (flow === 'auto' || flow === 'scroll') return box
  }

  return null
}

/** How far down the list a row's top edge is. */
export function offsetOf(index: number, rows: Rows): number {
  const { height, fold } = rows
  if (!fold || index <= fold.at) return index * height

  const base = (fold.at + 1) * height
  const band = index - fold.at - 1
  if (band < fold.rows) return base + Math.min(band, fold.grown) * height

  return base + fold.grown * height + (band - fold.rows) * height
}

/** How tall a row is drawn: one row, or the part of one that is out so far while
 *  the fold it belongs to is moving. */
export function heightOf(index: number, rows: Rows): number {
  const { height, fold } = rows
  if (!fold) return height

  const band = index - fold.at - 1
  if (band < 0 || band >= fold.rows) return height

  return clamp((fold.grown - band) * height, 0, height)
}

/** How long the whole list runs, which is what the two boxes and the rows
 *  between them have to add up to. */
export function listHeight(rows: Rows): number {
  const whole = rows.count * rows.height
  if (!rows.fold) return whole

  return whole - (rows.fold.rows - rows.fold.grown) * rows.height
}

/** The row `y` pixels down the list is in, or the nearest one where `y` is past
 *  either end. The inverse of `offsetOf`, run over the three stretches a folding
 *  list has: the rows above the fold, the band itself, and everything under it
 *  sitting however high the band has left it. */
export function indexAt(y: number, rows: Rows): number {
  const { count, height, fold } = rows
  if (count <= 0) return 0

  const at = Math.max(0, y)
  const last = count - 1
  if (!fold) return clamp(Math.floor(at / height), 0, last)

  const base = (fold.at + 1) * height
  if (at < base) return clamp(Math.floor(at / height), 0, last)

  const shown = fold.grown * height
  if (at < base + shown) {
    const band = Math.min(Math.floor((at - base) / height), fold.rows - 1)
    return clamp(fold.at + 1 + band, 0, last)
  }

  const under = Math.floor((at - base - shown) / height)
  return clamp(fold.at + fold.rows + 1 + under, 0, last)
}

/** The rows to mount for a scroll position, and the height either side of them.
 *
 *  A row is in as soon as any part of it is in view, and `overscan` rows are in
 *  beyond that at either end, so a wheel click's worth of scrolling arrives at
 *  rows that are already drawn rather than at nothing. */
export function windowFor(rows: Rows): RowWindow {
  if (rows.count <= 0) {
    return { first: 0, last: -1, skip: null, above: 0, below: 0, pinned: [] }
  }

  const last = rows.count - 1
  const first = clamp(indexAt(rows.top, rows) - rows.overscan, 0, last)
  // One pixel short of the far edge, so a scroll that lands exactly on a row's
  // top does not pull in the row after it for nothing.
  const end = clamp(indexAt(rows.top + Math.max(0, rows.room - 1), rows) + rows.overscan, 0, last)

  const skip = flatBand(first, end, rows)
  const held = [...new Set(rows.pinned ?? [])]
    .filter((one) => one >= 0 && one <= last)
    .filter(
      (one) => one < first || one > end || (skip !== null && one >= skip.from && one <= skip.to),
    )
    .sort((a, b) => a - b)

  return {
    first,
    last: end,
    skip,
    above: offsetOf(first, rows),
    below: Math.max(0, listHeight(rows) - (offsetOf(end, rows) + heightOf(end, rows))),
    pinned: held,
  }
}

/** The stretch of a fold's band that is not out yet: every row of it beyond the one
 *  part way out is flat, and a flat row is nothing to draw. Null where the window
 *  does not reach that far, and while no fold is moving. */
function flatBand(first: number, last: number, rows: Rows): { from: number; to: number } | null {
  const fold = rows.fold
  if (!fold) return null

  const from = Math.max(first, fold.at + 1 + Math.ceil(fold.grown))
  const to = Math.min(last, fold.at + fold.rows)

  return from <= to ? { from, to } : null
}

/** How far to scroll this frame while something is held over the list, from how
 *  far into the band at the top or the bottom the pointer is.
 *
 *  A drag can only drop on a row it can reach, and a space of three thousand
 *  notes has one row on screen out of a hundred. So holding near an edge brings
 *  rows in under the pointer, faster the closer to the edge it is: `y` is where
 *  the pointer is down the scroller, `edge` how deep the band reaches, and `most`
 *  the fastest it goes. Negative is up. */
export function autoScrollBy(y: number, room: number, edge: number, most: number): number {
  if (room <= 0 || edge <= 0) return 0

  if (y < edge) return -most * clamp((edge - y) / edge, 0, 1)
  if (y > room - edge) return most * clamp((y - (room - edge)) / edge, 0, 1)

  return 0
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most)
}
