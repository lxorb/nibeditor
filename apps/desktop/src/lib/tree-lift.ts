/** A row lifted out of the file list and put back somewhere else: what the pointer
 *  is pointing at, and how far every other row has to move to get out of its way.
 *
 *  The arithmetic only. Which rows are carried, what the drop does to the space and
 *  how the lifted row is drawn are Tree.svelte's, and what the order then is is
 *  tree-order.ts's. This is here so the two questions a drag has to answer every
 *  frame - "before this row, on it, or after it" and "how far did each row just
 *  travel" - can be read and tested without a pointer. */

/** Which part of a row the pointer is in.
 *
 *  Three bands rather than two, because a row in a file list means two things a drop
 *  could land on. The middle of it is the row itself: dropping there puts what was
 *  carried inside it, which is what a drag in the list has always done and what makes
 *  a note out of a folder. The thin bands at the top and the bottom are the spaces
 *  between rows, which is where a new order is. */
export type Band = 'before' | 'on' | 'after'

/** How much of a row each of the outer bands takes.
 *
 *  A quarter, so half the row is still "into this folder": the move into a folder is
 *  the older gesture and the one a reader is more likely to want, and a band that
 *  took a third from each end would leave a third of the row for it. A quarter of a
 *  28 pixel row is 7 pixels, which a mouse hits comfortably; under a thumb the row is
 *  56 and the band is 14. */
const EDGE = 0.25

/** Which band the pointer is in, for a row whose top is at `top` and which is
 *  `height` tall. A row of no height is all middle, since there is nothing to divide. */
export function bandOf(y: number, top: number, height: number): Band {
  if (height <= 0) return 'on'

  const along = (y - top) / height
  if (along < EDGE) return 'before'
  if (along > 1 - EDGE) return 'after'

  return 'on'
}

/** How far each row has moved, by the path written on it: where it was, less where
 *  it is now, which is the offset it has to start from to slide into place.
 *
 *  Rows that did not move are left out, so nothing is animated for nothing. So are
 *  the rows being carried: one of those is under the pointer and is drawn there, and
 *  a row that slid to where the pointer already is would be the same row moving
 *  twice. And so is any row only one of the two measurements has, which is a row that
 *  scrolled into or out of the window while the order changed - it has no distance to
 *  travel, only a place to be. */
export function slides(
  was: ReadonlyMap<string, number>,
  now: ReadonlyMap<string, number>,
  carried: readonly string[] = [],
): Map<string, number> {
  const out = new Map<string, number>()

  for (const [path, here] of now) {
    if (carried.includes(path)) continue

    const before = was.get(path)
    if (before === undefined || before === here) continue

    out.set(path, before - here)
  }

  return out
}
