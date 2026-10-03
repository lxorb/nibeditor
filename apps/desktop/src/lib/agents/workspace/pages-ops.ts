/** What an agent reads of a page note, and the three things it does to its pages.
 *
 *  A page note is a canvas with pages among its objects (docs/pages.md), so a card, a
 *  connection and a stroke are canvas-ops.ts's. What a canvas has no word for is the
 *  column: which page an object is on, and a page put in, taken out or moved in the
 *  order. Those are `@nib/markdown/pages`' own four, the ones the page menu makes, so an
 *  agent's new page has the size and ruling of the one it follows, a page taken out takes
 *  what was written on it, and the last page is never taken away. Pure. */

import { added, moved, onPage, pagesOf, removed as pageRemoved, settled } from '@nib/markdown/pages'
import type { Canvas, CanvasNode, PageNode } from '../../canvas/format'
import { Refused } from './problem'

/** Where an agent's card goes on a page when it says no place: inside the margin a
 *  person leaves, under whatever is on the page already. */
const MARGIN = 40

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The number of the page a thing is on, counting from one, by where its top left
 *  corner is - the same question a stroke is asked, by where the pen went down. Null
 *  for something beside the column. */
function pageNumberOf(pages: readonly PageNode[], box: Box): number | null {
  const at = pages.findIndex((page) => onPage({ points: [{ x: box.x, y: box.y }] }, page))
  return at < 0 ? null : at + 1
}

/** A page note as an agent reads it: the pages in order, and every other object with
 *  the page it is on. Laid out first, the way the surface lays a note out as it opens,
 *  so a file another device wrote reads in the same column the reader sees. */
export function readablePages(canvas: Canvas) {
  const laid = settled(canvas)
  const pages = pagesOf(laid)

  return {
    pages: pages.map((page, at) => ({
      id: page.id,
      number: at + 1,
      paper: page.paper,
      pattern: page.pattern,
      width: page.width,
      height: page.height,
      ...(page.file ? { pdf: { file: page.file, page: page.page } } : {}),
      ink: laid.ink.filter((stroke) => onPage(stroke, page)).length,
    })),
    nodes: laid.nodes
      .filter((node) => node.type !== 'page')
      .map((node) => ({ ...node, page: pageNumberOf(pages, node) })),
    edges: laid.edges,
    ink: laid.ink.length,
  }
}

/** The page an operation names by its number (from one) or its id, in a page note
 *  already laid out. */
export function pageIn(canvas: Canvas, named: unknown): PageNode {
  const pages = pagesOf(canvas)
  const found =
    typeof named === 'number'
      ? pages[Math.round(named) - 1]
      : pages.find((page) => page.id === named)
  if (!found) throw new Refused('not_found', `there is no page ${String(named)}`)

  return found
}

/** Where a card goes on a page: at `x`, `y` measured from the page's corner when the
 *  agent says them, and otherwise inside the margin under what the page holds. */
export function placeOnPage(
  canvas: Canvas,
  page: PageNode,
  x: number | null,
  y: number | null,
): { x: number; y: number } {
  if (x !== null || y !== null) {
    return { x: page.x + (x ?? MARGIN), y: page.y + (y ?? MARGIN) }
  }

  const on = canvas.nodes.filter(
    (node: CanvasNode) => node.type !== 'page' && pageNumberOf([page], node) !== null,
  )
  const lowest = Math.max(page.y + MARGIN, ...on.map((node) => node.y + node.height + MARGIN))
  return { x: page.x + MARGIN, y: Math.min(lowest, page.y + page.height - MARGIN) }
}

/** Whether a canvas holds pages at all, which is what lets the page operations in. */
export function hasPages(canvas: Canvas): boolean {
  return pagesOf(canvas).length > 0
}

/** One of the three page operations, or null for an operation that is not one. */
export function pageOperation(
  canvas: Canvas,
  op: Record<string, unknown>,
): { canvas: Canvas; made?: string } | null {
  switch (op.op) {
    case 'add_page': {
      const after = op.after === undefined ? null : pageIn(canvas, op.after).id
      const put = added(canvas, after)
      return { canvas: put.canvas, made: put.id }
    }

    case 'remove_page': {
      const page = pageIn(canvas, op.id ?? op.page)
      if (pagesOf(canvas).length < 2) {
        throw new Refused('bad_arguments', 'the last page is never taken away')
      }
      return { canvas: pageRemoved(canvas, page.id) }
    }

    case 'move_page': {
      const page = pageIn(canvas, op.id ?? op.page)
      const to = op.to
      if (typeof to !== 'number') throw new Refused('bad_arguments', 'move_page says to')
      return { canvas: moved(canvas, page.id, to - 1) }
    }

    default:
      return null
  }
}
