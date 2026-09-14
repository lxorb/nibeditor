/** What a sheet of paper is: the three sizes, their names, and which one a size is.
 *
 *  Its own module and not part of canvas.ts, for one measured reason. The setting that
 *  says what paper a new page note starts on lives in the app's modes store, which is in
 *  front of the first paint - and canvas.ts is the whole JSON Canvas format, which is
 *  deliberately not: a window that opens on a note has no plane to read. One import of
 *  `isPaper` put the format back in front of every launch. See weight.test.ts, which is
 *  what said so.
 *
 *  So this is a leaf: no imports at all, forty lines, and the one thing anything outside
 *  the pages engine needs to know about paper. canvas.ts re-exports every name here, so
 *  nothing that already reads them had to change. */

/** The paper a page is, in pixels.
 *
 *  Three, and the third is not a size. A4 is what the world outside North America
 *  prints on and Letter is what North America prints on, and a note that is going to be
 *  printed wants to be the shape of the paper it will be printed on from the first
 *  stroke rather than reflowed at the end. `long` is the other kind of page altogether:
 *  as wide as A4 and as tall as somebody keeps writing, which is what a page of notes
 *  taken in a lecture actually is.
 *
 *  In pixels rather than in millimetres because everything else on the plane is in
 *  pixels - a card's box, a stroke's width, the grid - and a page that measured itself in
 *  another unit would be one conversion away from every sum in the app. The numbers are
 *  the millimetres at 96dpi, rounded: 210x297mm is 794x1123. */
export const PAPERS = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
  long: { width: 794, height: 1123 },
} as const

export type Paper = keyof typeof PAPERS

/** The papers, in the order they are offered: the two sizes, then the page that does
 *  not end. Read off `PAPERS` so a fourth cannot be added in one place only. */
export const PAPER_NAMES = Object.keys(PAPERS) as Paper[]

export function isPaper(value: unknown): value is Paper {
  return PAPER_NAMES.some((one) => one === value)
}

/** How far a size may be off and still be that paper, in pixels.
 *
 *  A PDF measures in points and the plane measures in pixels, so every page arrives
 *  through a conversion and a rounding: A4 is 595.28 by 841.89 points, which is 793.7 by
 *  1122.5 pixels, which is 794 by 1123. Two pixels of slack is enough for that
 *  arithmetic and far too little for a paper that is a different paper - the nearest
 *  pair of sizes here is 22 pixels apart across and 67 down. */
const NEAR = 2

/** Which paper a page of this size is, by name.
 *
 *  A page keeps its own size whatever this answers: the name is what a reshape reads -
 *  "back to A4" has to know which A4 - and what the page menu shows a tick beside. A
 *  size that is neither is its own size under the name every page note starts as,
 *  because there is no third name to give it and a page that lied about being Letter
 *  would jump to Letter's size the first time somebody changed its ruling.
 *
 *  `long` is never answered: it is A4's size and a choice somebody makes, not a size to
 *  be recognised. */
export function paperSized(width: number, height: number): Paper {
  const near = (one: number, other: number) => Math.abs(one - other) <= NEAR

  if (near(width, PAPERS.letter.width) && near(height, PAPERS.letter.height)) return 'letter'

  return 'a4'
}

/** Whether this size grows downwards instead of ending. A long page is the one that
 *  does, which is the whole of what makes it different from A4. */
export function endless(paper: Paper): boolean {
  return paper === 'long'
}
