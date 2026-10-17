/** How far along a strip too full to show every tab it scrolls to bring one into view:
 *  the nearest place that shows all of it, as a browser's strip does, and never past
 *  either end. Everything is measured along the strip, in the direction it reads.
 *  `page` is how much of it shows, `length` how long it is. */
export function revealed(
  at: number,
  page: number,
  length: number,
  start: number,
  end: number,
): number {
  const nearest = start < at ? start : end > at + page ? end - page : at
  return Math.min(Math.max(nearest, 0), Math.max(length - page, 0))
}
