/** A page note: what the pages are, where they sit, and what one is.
 *
 *  The file itself is canvas.ts. A page note is a JSON Canvas file - the same
 *  reader, the same writer, byte for byte the same rules - whose `nodes` hold pages
 *  among the cards, so there is one format in this package and not two that drift.
 *  What is here is only the part a canvas has no word for: the column the pages are
 *  laid out in, and the four things somebody does to it.
 *
 *  Pages are a column, top to bottom, with a gap between them. That is the whole
 *  layout: a page note is read by scrolling, not by panning, and a page's own `x`
 *  and `y` are worked out from the list rather than remembered - two devices that
 *  add a page at the same moment would otherwise both put it at the same `y`, and
 *  one of the two pages would be under the other. So the list is the truth and the
 *  boxes follow from it, which is also what makes reordering a page a matter of
 *  moving one entry.
 *
 *  Here rather than in the app because three parts of Nib read it: the surface
 *  somebody writes on, the merge that puts two copies of a file together, and the
 *  export that puts one page on one sheet of paper.
 *
 *  Nothing here draws, saves, or knows what a screen is. */

import {
  type Canvas,
  emptyCanvas,
  endless,
  freshId,
  isPage,
  type PageNode,
  PAPERS,
  type Paper,
  paperSized,
  type Pattern,
  writeCanvas,
} from './canvas'

/** The gap between two pages, in the same pixels everything else on the plane is
 *  in. Wide enough that the edges read as two sheets rather than one long one, and
 *  narrow enough that a scroll crosses it without a pause. */
export const GUTTER = 40

/** How far a long page grows each time writing reaches the bottom of it, and how
 *  much room is left below the lowest thing on it. A screenful at a time, so the
 *  page under the nib does not end mid-sentence and does not grow on every stroke
 *  either. */
export const GROWTH = 600
const HEADROOM = 240

/** The pages of a note, in the order they turn. The list `nodes` already gives:
 *  reading a file keeps the order it was written in, so this is a filter and never
 *  a sort. */
export function pagesOf(canvas: Canvas): PageNode[] {
  return canvas.nodes.filter(isPage)
}

/** How many pages there are, which is what the status bar counts. */
export function pageCount(canvas: Canvas): number {
  return canvas.nodes.reduce((count, node) => (isPage(node) ? count + 1 : count), 0)
}

/** Where each page sits, worked out from the list and from nothing else.
 *
 *  Every page is centred on the same middle - `x` is the same negative half-width
 *  for all of them - so a note of A4 pages and one Letter page among them reads as
 *  a stack rather than a staircase. The first page starts at the origin, which is
 *  what makes an empty note's camera the identity.
 *
 *  Answers the pages with their boxes filled in, in order. Pure, and cheap enough
 *  to call on every read: a note of four hundred pages is four hundred sums. */
export function laidOut(pages: readonly PageNode[]): PageNode[] {
  let y = 0
  const out: PageNode[] = []

  for (const page of pages) {
    const x = -Math.round(page.width / 2)
    out.push(page.x === x && page.y === y ? page : { ...page, x, y })
    y += page.height + GUTTER
  }

  return out
}

/** The same, done to the whole canvas: the pages put back where the column says
 *  they are, and everything else left exactly where it was.
 *
 *  Hands back the very same canvas when nothing moved, which is what every edit in
 *  this app does and what lets a store tell an edit from a no-op. */
export function settled(canvas: Canvas): Canvas {
  const pages = pagesOf(canvas)
  if (!pages.length) return canvas

  const placed = laidOut(pages)
  if (placed.every((page, at) => page === pages[at])) return canvas

  const byId = new Map(placed.map((page) => [page.id, page]))
  return { ...canvas, nodes: canvas.nodes.map((node) => byId.get(node.id) ?? node) }
}

/** How tall the column is, which is what a scroll can reach. Nought for a note
 *  with no pages, which is a note that is still arriving. */
export function columnHeight(pages: readonly PageNode[]): number {
  return pages.reduce((tall, page) => tall + page.height + GUTTER, 0) - (pages.length ? GUTTER : 0)
}

/** A fresh page of a size, with nothing on it. */
export function newPage(paper: Paper = 'a4', pattern: Pattern = 'blank'): PageNode {
  const size = PAPERS[paper]

  return {
    id: freshId(),
    type: 'page',
    x: -Math.round(size.width / 2),
    y: 0,
    width: size.width,
    height: size.height,
    paper,
    pattern,
  }
}

/** A page showing a page of a PDF. The size is the PDF page's own, in the points a
 *  PDF measures in, which are the same 72-to-the-inch units a browser's own PDF
 *  viewer reports - so a page imported from an A4 paper is A4 and one from a US
 *  brief is the size of the brief.
 *
 *  And it is called what it is: a Letter page says `letter`, which is what the page
 *  menu ticks and what a reshape back to its own size reads. Every page used to say
 *  `a4` however big it was, so a Letter scan was a Letter-sized page that called
 *  itself A4 and snapped to A4 the moment anybody changed its ruling.
 *
 *  No ruling, because the paper already has whatever the paper has: lines drawn
 *  over a printed page are lines drawn over a printed page. */
export function pdfPage(file: string, page: number, width: number, height: number): PageNode {
  const wide = Math.max(1, Math.round(width))
  const tall = Math.max(1, Math.round(height))

  return {
    id: freshId(),
    type: 'page',
    x: -Math.round(wide / 2),
    y: 0,
    width: wide,
    height: tall,
    paper: paperSized(wide, tall),
    pattern: 'blank',
    file,
    page,
  }
}

/** A page put in, after the one named or at the end, and the note settled round
 *  it. The new page's id comes back with the canvas so the caller can turn to it.
 *
 *  A page is added with the size and the ruling of the one it follows, which is
 *  what somebody adding a page to a note of ruled A4 means by it. */
export function added(canvas: Canvas, after: string | null = null): { canvas: Canvas; id: string } {
  const pages = pagesOf(canvas)
  const from = after === null ? pages[pages.length - 1] : pages.find((one) => one.id === after)
  const page = newPage(from?.paper ?? 'a4', from?.pattern ?? 'blank')

  const at = after === null ? -1 : canvas.nodes.findIndex((node) => node.id === after)
  const nodes = [...canvas.nodes]
  if (at < 0) nodes.push(page)
  else nodes.splice(at + 1, 0, page)

  return { canvas: settled({ ...canvas, nodes }), id: page.id }
}

/** A page taken out, and everything that was written on it with it.
 *
 *  Everything on it, because a page is not a frame somebody drew round their notes:
 *  it is the sheet they are on, and taking the sheet away takes the notes on it. A
 *  tombstone for each, so a device that was away does not put them back; `stamped`
 *  in canvas-merge.ts writes those, so this only has to say what has gone.
 *
 *  The last page is never taken away. A page note with no pages is a note with
 *  nowhere to write, and the gesture that would make one is better as no gesture at
 *  all. */
export function removed(canvas: Canvas, id: string): Canvas {
  const pages = pagesOf(canvas)
  const page = pages.find((one) => one.id === id)
  if (!page || pages.length < 2) return canvas

  const box = { x: page.x, y: page.y, width: page.width, height: page.height }
  const on = (thing: { x: number; y: number; width: number; height: number }) =>
    thing.x + thing.width > box.x &&
    thing.x < box.x + box.width &&
    thing.y + thing.height > box.y &&
    thing.y < box.y + box.height

  const nodes = canvas.nodes.filter((node) => node.id !== id && !(isPage(node) ? false : on(node)))
  const ink = canvas.ink.filter((stroke) => !onPage(stroke, box))

  return settled({ ...canvas, nodes, ink })
}

/** Whether a stroke belongs to a page: where its first point landed, which is
 *  where the pen was put down. A stroke that ran off the bottom of one page onto
 *  the next is still the stroke somebody started on the first.
 *
 *  Exported because the export asks the same question per sheet, and one answer
 *  means a stroke never comes out on two pages or on none. */
export function onPage(
  stroke: { points: readonly { x: number; y: number }[] },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const first = stroke.points[0]
  if (!first) return false

  return (
    first.x >= box.x &&
    first.x < box.x + box.width &&
    first.y >= box.y &&
    first.y < box.y + box.height
  )
}

/** A page moved to another place in the order, with everything on it.
 *
 *  What is on a page moves with it, which is what makes this a reorder and not a
 *  shuffle of empty sheets. The pages are reordered first, the column is laid out
 *  again, and everything that was on the moved page is shifted by however far the
 *  page itself went.
 *
 *  `to` counts pages, not nodes: 0 puts it first. Out of range is clamped, and a
 *  page already there comes back as the very same canvas. */
export function moved(canvas: Canvas, id: string, to: number): Canvas {
  const pages = pagesOf(canvas)
  const from = pages.findIndex((one) => one.id === id)
  if (from < 0) return canvas

  const target = Math.min(Math.max(0, Math.round(to)), pages.length - 1)
  if (target === from) return canvas

  const page = pages[from]
  if (!page) return canvas

  const order = pages.filter((one) => one.id !== id)
  order.splice(target, 0, page)

  const placed = laidOut(order)
  const was = pages[from]
  const is = placed.find((one) => one.id === id)
  if (!was || !is) return canvas

  const by = is.y - was.y
  const box = { x: was.x, y: was.y, width: was.width, height: was.height }

  // The pages back into the slots the pages already occupied, in their new order.
  // Their order in `nodes` is what the file writes and what `pagesOf` reads back, so
  // a reorder that only moved the boxes would come back in the old order the next
  // time the file was read.
  let next = 0
  const nodes = canvas.nodes.map((node) => {
    if (isPage(node)) return placed[next++] ?? node

    // Everything the moved page was carrying, by the same amount. Worked out against
    // where the page was before the column was laid out again, because that is where
    // the cards and the strokes still are.
    return by !== 0 && on(node, box) ? { ...node, y: node.y + by } : node
  })

  const ink =
    by === 0
      ? canvas.ink
      : canvas.ink.map((stroke) =>
          onPage(stroke, box)
            ? { ...stroke, points: stroke.points.map((one) => ({ ...one, y: one.y + by })) }
            : stroke,
        )

  return { ...canvas, nodes, ink }
}

function on(
  thing: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    thing.x + thing.width > box.x &&
    thing.x < box.x + box.width &&
    thing.y + thing.height > box.y &&
    thing.y < box.y + box.height
  )
}

/** A page's size or its ruling changed. Changing the size of a long page is what
 *  makes it stop growing, and changing an A4 page into a long one is what starts
 *  it; either way the column is laid out again, since the page is now another
 *  height. */
export function reshaped(
  canvas: Canvas,
  id: string,
  change: { paper?: Paper; pattern?: Pattern },
): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (node.id !== id || !isPage(node)) return node

    const paper = change.paper ?? node.paper
    const pattern = change.pattern ?? node.pattern
    if (paper === node.paper && pattern === node.pattern) return node

    // A page that was long and is now A4 goes back to A4's height; one that was A4
    // and is now long keeps the height it had, because it is about to grow from
    // there rather than start again.
    const size = PAPERS[paper]
    const height = endless(paper) ? Math.max(size.height, node.height) : size.height

    return { ...node, paper, pattern, width: size.width, height }
  })

  return settled({ ...canvas, nodes })
}

/** A long page grown to hold what is now on it, or the very same canvas where no
 *  page had to grow.
 *
 *  Only a long page, and only downwards. A4 is A4: writing past the bottom of a
 *  sheet of A4 is writing off the sheet, and the page that grows instead of ending
 *  is the one somebody chose for exactly that. Called after an edit rather than
 *  during a stroke, so the paper does not move under the nib.
 *
 *  `lowest` is how far down anything on that page reaches, which the surface knows
 *  and this does not: a stroke's outline is wider than its points, and working that
 *  out is the ink code's job. */
export function grown(canvas: Canvas, lowest: ReadonlyMap<string, number>): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (!isPage(node) || !endless(node.paper)) return node

    const reach = lowest.get(node.id)
    if (reach === undefined) return node

    const wanted = reach + HEADROOM - node.y
    if (wanted <= node.height) return node

    // In whole screenfuls, so the page grows in steps a scroll can follow rather
    // than by a pixel per stroke.
    const steps = Math.ceil((wanted - node.height) / GROWTH)
    return { ...node, height: node.height + steps * GROWTH }
  })

  // The very same canvas where no page had to grow, which is what every operation
  // here does and what lets the store tell an edit from a no-op.
  if (nodes.every((node, at) => node === canvas.nodes[at])) return canvas

  return settled({ ...canvas, nodes })
}

/** A page note with one blank page on it: what a new one says before anybody has
 *  written a word. */
export function emptyPages(paper: Paper = 'a4'): Canvas {
  return { ...emptyCanvas(), nodes: [newPage(paper)] }
}

/** And that as a file. The paper is the reader's to choose - A4 outside North America
 *  and Letter inside it - so it is asked for rather than assumed; see `pagesPaper` in
 *  the app's modes store. */
export function blankPages(paper: Paper = 'a4'): string {
  return writeCanvas(emptyPages(paper))
}

/** A page note out of a PDF: one page per page of the paper, all of them showing
 *  the PDF that stays beside them.
 *
 *  `sizes` is each page's size in order, which is what a PDF reader reports and
 *  what this has no way of finding out for itself. `file` is the PDF's path
 *  relative to the note, which is what a JSON Canvas file node holds and what
 *  Obsidian follows. */
export function pagesFromPdf(
  file: string,
  sizes: readonly { width: number; height: number }[],
): Canvas {
  const pages = sizes.map((size, at) => pdfPage(file, at + 1, size.width, size.height))
  return settled({ ...emptyCanvas(), nodes: pages.length ? pages : [newPage()] })
}

/** Which page a point on the plane is on, or null for a point in a gutter.
 *
 *  What a press asks before it does anything else: ink, a card and a picture all
 *  belong to a page, and a press between two pages belongs to neither. */
export function pageAt(
  pages: readonly PageNode[],
  point: { x: number; y: number },
): PageNode | null {
  for (const page of pages) {
    if (
      point.x >= page.x &&
      point.x <= page.x + page.width &&
      point.y >= page.y &&
      point.y <= page.y + page.height
    ) {
      return page
    }
  }

  return null
}

/** Which page is being looked at, given where the top of the view is and how tall
 *  it is: the one covering the middle of the view, which is what a page counter
 *  should say while a scroll is half way between two.
 *
 *  Counts from one, and nought for a note with no pages. */
export function pageShowing(pages: readonly PageNode[], top: number, height: number): number {
  if (!pages.length) return 0

  const middle = top + height / 2
  for (const [at, page] of pages.entries()) {
    if (middle < page.y + page.height + GUTTER / 2) return at + 1
  }

  return pages.length
}
