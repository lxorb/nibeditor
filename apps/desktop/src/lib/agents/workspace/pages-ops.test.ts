/** A page note as an agent reads and changes it: the pages in order, each card's page,
 *  a card put on a page by the page's own corner, and the three page operations the page
 *  menu makes (docs/pages.md). */

import { type Canvas, type CanvasNode } from '@nib/markdown/canvas'
import { emptyPages, pagesOf } from '@nib/markdown/pages'
import { describe, expect, test } from 'vitest'
import { applied } from './canvas-ops'
import { readablePages } from './pages-ops'
import { Refused } from './problem'

function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof Refused) return error.code
    throw error
  }
  return 'applied'
}

/** A note of `count` blank A4 pages, laid out in their column. */
function note(count: number): Canvas {
  let canvas = emptyPages()
  for (let at = 1; at < count; at++) canvas = applied(canvas, [{ op: 'add_page' }]).canvas
  return canvas
}

function card(canvas: Canvas, id: string): CanvasNode | undefined {
  return canvas.nodes.find((one) => one.id === id)
}

describe('reading a page note', () => {
  test('the pages in order, and each card on the page it starts on', () => {
    const three = note(3)
    const [, second] = pagesOf(three)
    const { canvas, made } = applied(three, [{ op: 'add_card', page: 2, text: 'On two' }])

    const read = readablePages(canvas)
    expect(read.pages.map((one) => one.number)).toEqual([1, 2, 3])
    expect(read.pages[1]).toMatchObject({ id: second?.id, paper: 'a4' })
    expect(read.nodes).toEqual([expect.objectContaining({ id: made[0], page: 2 })])
    // A page is in the list of pages, not among the cards.
    expect(read.nodes.some((one) => (one as { type: string }).type === 'page')).toBe(false)
  })
})

describe('changing one', () => {
  test("a card on a page is measured from the page's corner", () => {
    const two = note(2)
    const second = pagesOf(two)[1]
    const { canvas, made } = applied(two, [{ op: 'add_card', page: 2, x: 10, y: 20 }])

    expect(card(canvas, made[0] ?? '')).toMatchObject({
      x: (second?.x ?? 0) + 10,
      y: (second?.y ?? 0) + 20,
    })
  })

  test('with no place said, under what the page holds, inside its margin', () => {
    const one = note(1)
    const first = applied(one, [{ op: 'add_card', page: 1, text: 'a' }])
    const second = applied(first.canvas, [{ op: 'add_card', page: 1, text: 'b' }])

    const a = card(second.canvas, first.made[0] ?? '')
    const b = card(second.canvas, second.made[0] ?? '')
    expect(b?.x).toBe(a?.x)
    expect(b?.y).toBeGreaterThan((a?.y ?? 0) + (a?.height ?? 0))
  })

  test('a card moved onto another page', () => {
    const two = note(2)
    const second = pagesOf(two)[1]
    const placed = applied(two, [{ op: 'add_card', page: 1 }])
    const id = placed.made[0] ?? ''
    const moved = applied(placed.canvas, [{ op: 'move', id, page: 2, x: 5, y: 5 }]).canvas

    expect(card(moved, id)).toMatchObject({ x: (second?.x ?? 0) + 5, y: (second?.y ?? 0) + 5 })
    expect(readablePages(moved).nodes[0]).toMatchObject({ page: 2 })
  })

  test('a page put in after another, moved, and taken out with what is on it', () => {
    const two = note(2)
    const [first, last] = pagesOf(two)
    const put = applied(two, [{ op: 'add_page', after: first?.id }])
    const added = put.made[0]
    expect(pagesOf(put.canvas).map((one) => one.id)).toEqual([first?.id, added, last?.id])

    const moved = applied(put.canvas, [{ op: 'move_page', id: added, to: 3 }]).canvas
    expect(pagesOf(moved).map((one) => one.id)).toEqual([first?.id, last?.id, added])

    const written = applied(moved, [{ op: 'add_card', page: 3, text: 'goes' }])
    const gone = applied(written.canvas, [{ op: 'remove_page', page: 3 }]).canvas
    expect(pagesOf(gone)).toHaveLength(2)
    expect(card(gone, written.made[0] ?? '')).toBeUndefined()

    // `remove` on a page's id is the same as remove_page.
    expect(pagesOf(applied(gone, [{ op: 'remove', id: last?.id }]).canvas)).toHaveLength(1)
  })

  test('never the last page; pages only in a page note; a page that is there', () => {
    const one = note(1)
    const only = pagesOf(one)[0]?.id
    expect(refusal(() => applied(one, [{ op: 'remove_page', id: only }]))).toBe('bad_arguments')
    expect(refusal(() => applied(one, [{ op: 'remove', id: only }]))).toBe('bad_arguments')
    expect(refusal(() => applied(one, [{ op: 'add_card', page: 4 }]))).toBe('not_found')
    expect(refusal(() => applied(one, [{ op: 'move_page', page: 1 }]))).toBe('bad_arguments')

    const plane: Canvas = { ...emptyPages(), nodes: [] }
    expect(refusal(() => applied(plane, [{ op: 'add_page' }]))).toBe('bad_arguments')
    expect(refusal(() => applied(plane, [{ op: 'add_card', page: 1 }]))).toBe('bad_arguments')
  })
})
