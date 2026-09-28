/** Where the pages of a PDF sit in the scroller, and which of them are worth
 *  drawing.
 *
 *  Pure arithmetic, deliberately: a 300 page document is laid out on every zoom
 *  and read on every scroll, so this is the part that has to be cheap and the
 *  part worth stating in tests. Nothing here touches pdf.js or the DOM.
 *
 *  A page's size is not known until the page itself has been asked for, and
 *  asking for three hundred of them before anything is on screen is how a viewer
 *  takes a second to open. So every page is laid out at the first page's size
 *  until it has been measured, and the column settles as the pages arrive - which
 *  for the documents people read is no change at all, because the pages of a
 *  paper are all the same size. */

/** A page as pdf.js measures one, in PDF points. */
export interface Size {
  width: number
  height: number
}

/** Where one page lands in the scroller, in CSS pixels. */
export interface PageBox {
  top: number
  width: number
  height: number
}

/** PDF points are 72 to the inch and CSS pixels are 96, so a page at zoom 1 is
 *  the size it would be printed. */
export const PDF_TO_CSS = 96 / 72

/** The gap between two pages, and the same margin above the first and below the
 *  last: a page is a sheet of paper, and sheets are not stacked flush. */
export const GAP = 16

/** The zooms the keys step through. Wider than the editor's, because a page is a
 *  fixed size: a scanned book wants making bigger and a poster smaller, where a
 *  note only ever wants its words a little larger. */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const

/** A zoom held to what a page may be drawn at. */
export function heldZoom(value: number): number {
  return Math.min(Math.max(value, ZOOMS[0]), ZOOMS[ZOOMS.length - 1] ?? 4)
}

/** The next step past `from` in a direction, or the end of the row. Past rather
 *  than nearest, so a step always moves - which matters after a wheel has left
 *  the zoom between two of them. */
export function nextZoom(from: number, direction: number): number {
  const steps = direction > 0 ? [...ZOOMS] : [...ZOOMS].reverse()
  const found = steps.find((one) => (direction > 0 ? one > from + 0.001 : one < from - 0.001))

  return found ?? heldZoom(from)
}

/** The canvas one page is drawn on: crisp on the screen it is on, within `most`
 *  pixels in all.
 *
 *  The canvas holds device pixels and CSS sizes it back down to the page's box, so a
 *  page `at` CSS pixels is drawn at `ratio` device pixels to each of them - unless
 *  that asks for more than `most`, and then a little softer rather than not at all,
 *  though never below one to one. Answers the canvas's size and what pdf.js is asked
 *  to draw through, which at one to one is nothing. The reader's pages and a page
 *  embedded in a note both size theirs here, each against its own ceiling. */
export function sheetFor(
  at: Size,
  most: number,
  ratio: number,
): { width: number; height: number; drawn: { transform?: number[] } } {
  const room = Math.sqrt(most / (at.width * at.height))
  const density = Math.min(ratio, Math.max(1, room))

  return {
    width: Math.floor(at.width * density),
    height: Math.floor(at.height * density),
    drawn: density === 1 ? {} : { transform: [density, 0, 0, density, 0, 0] },
  }
}

/** Every page's place, top to bottom. */
export function stack(
  sizes: readonly (Size | undefined)[],
  fallback: Size,
  zoom: number,
): PageBox[] {
  const scale = zoom * PDF_TO_CSS
  const boxes: PageBox[] = []
  let top = GAP

  for (const size of sizes) {
    const page = size ?? fallback
    // Rounded down, which is how pdf.js sizes the text layer over the page: the
    // two have to land on the same pixel or a selection sits beside its words.
    const height = Math.max(1, Math.floor(page.height * scale))
    boxes.push({ top, width: Math.max(1, Math.floor(page.width * scale)), height })
    top += height + GAP
  }

  return boxes
}

/** How far the column runs, which is what the scroller is told it holds. */
export function heightOf(boxes: readonly PageBox[]): number {
  const last = boxes[boxes.length - 1]
  return last ? last.top + last.height + GAP : 0
}

/** The pages worth having drawn: the ones any part of which is on screen, and
 *  `spare` either side so a scroll meets a page that is already painted.
 *
 *  Half open, as a range is: `from` up to but not including `to`. Empty as
 *  `{ from: 0, to: 0 }` for a document with no pages. */
export function nearby(
  boxes: readonly PageBox[],
  scrollTop: number,
  viewHeight: number,
  spare = 1,
): { from: number; to: number } {
  if (!boxes.length) return { from: 0, to: 0 }

  const top = scrollTop
  const bottom = scrollTop + viewHeight
  let first = -1
  let last = -1

  for (const [index, box] of boxes.entries()) {
    if (box.top + box.height <= top || box.top >= bottom) continue
    if (first === -1) first = index
    last = index
  }

  // Scrolled clear of every page, which a rubber band scroll does at either end:
  // the nearest end is what to keep drawn.
  if (first === -1) {
    const at = top < (boxes[0]?.top ?? 0) ? 0 : boxes.length - 1
    first = at
    last = at
  }

  return {
    from: Math.max(0, first - spare),
    to: Math.min(boxes.length, last + 1 + spare),
  }
}

/** Which page the reader is on, counting from one: the one taking up most of
 *  what is on screen, so a scroll that shows the end of one page and the start of
 *  the next names whichever there is more of.
 *
 *  Zero for a document with no pages, which is not a page anyone can be on. */
export function pageAt(boxes: readonly PageBox[], scrollTop: number, viewHeight: number): number {
  let best = 0
  let most = -1

  for (const [index, box] of boxes.entries()) {
    const shown =
      Math.min(box.top + box.height, scrollTop + viewHeight) - Math.max(box.top, scrollTop)
    if (shown > most) {
      most = shown
      best = index + 1
    }
  }

  return best
}

/** How far to scroll for a page to sit at the top, with its margin above it.
 *  Pages count from one, and a page the document does not have is the nearest
 *  one it does. */
export function topOfPage(boxes: readonly PageBox[], page: number): number {
  if (!boxes.length) return 0

  const at = Math.min(Math.max(1, Math.round(page)), boxes.length) - 1
  return Math.max(0, (boxes[at]?.top ?? 0) - GAP)
}
