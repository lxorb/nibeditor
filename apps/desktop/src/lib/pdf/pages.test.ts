import { describe, expect, test } from 'vitest'
import {
  GAP,
  heightOf,
  heldZoom,
  nearby,
  nextZoom,
  pageAt,
  PDF_TO_CSS,
  sheetFor,
  stack,
  type Size,
  topOfPage,
} from './pages'

/** US Letter in PDF points, which is what a page's size arrives as. */
const LETTER: Size = { width: 612, height: 792 }
/** At zoom 1 a page is the size it would be printed. */
const HEIGHT = Math.floor(792 * PDF_TO_CSS)
const WIDTH = Math.floor(612 * PDF_TO_CSS)

function pages(count: number, sizes: Record<number, Size> = {}) {
  return Array.from({ length: count }, (_unused, index) => sizes[index])
}

describe('laying the pages out', () => {
  test('one under another, with a gap and a margin', () => {
    const boxes = stack(pages(3), LETTER, 1)

    expect(boxes).toHaveLength(3)
    expect(boxes[0]).toEqual({ top: GAP, width: WIDTH, height: HEIGHT })
    expect(boxes[1]?.top).toBe(GAP + HEIGHT + GAP)
    expect(boxes[2]?.top).toBe(GAP + 2 * (HEIGHT + GAP))
  })

  test('at the zoom asked for', () => {
    const [box] = stack(pages(1), LETTER, 2)
    expect(box?.height).toBe(Math.floor(792 * PDF_TO_CSS * 2))
  })

  test('a page that has been measured at its own size, the rest at the first', () => {
    const boxes = stack(pages(3, { 1: { width: 200, height: 400 } }), LETTER, 1)

    expect(boxes[0]?.height).toBe(HEIGHT)
    expect(boxes[1]?.height).toBe(Math.floor(400 * PDF_TO_CSS))
    expect(boxes[2]?.height).toBe(HEIGHT)
    // And the ones after it move up by the difference.
    expect(boxes[2]?.top).toBe(GAP + HEIGHT + GAP + Math.floor(400 * PDF_TO_CSS) + GAP)
  })

  test('never to nothing, so a page always has a box to draw in', () => {
    const [box] = stack([{ width: 0, height: 0 }], LETTER, 1)
    expect(box).toEqual({ top: GAP, width: 1, height: 1 })
  })

  test('the column runs to the last page and its margin', () => {
    expect(heightOf(stack(pages(2), LETTER, 1))).toBe(GAP + 2 * (HEIGHT + GAP))
    expect(heightOf([])).toBe(0)
  })
})

describe('which pages are worth drawing', () => {
  const boxes = stack(pages(10), LETTER, 1)
  const view = 600

  test('the ones on screen, and one either side', () => {
    expect(nearby(boxes, 0, view)).toEqual({ from: 0, to: 2 })
  })

  test('a page part of which shows counts as showing', () => {
    // Scrolled so that the very bottom of page one is still in the box.
    const at = GAP + HEIGHT - 5
    expect(nearby(boxes, at, view).from).toBe(0)
  })

  test('past the top and the bottom of the list', () => {
    const whole = heightOf(boxes)
    expect(nearby(boxes, whole - view, view).to).toBe(10)
    expect(nearby(boxes, -200, view)).toEqual({ from: 0, to: 2 })
  })

  test('a window of the size asked for', () => {
    expect(nearby(boxes, GAP + 3 * (HEIGHT + GAP), view, 2)).toEqual({ from: 1, to: 6 })
    expect(nearby(boxes, GAP + 3 * (HEIGHT + GAP), view, 0)).toEqual({ from: 3, to: 4 })
  })

  test('nothing at all before a document has been read', () => {
    expect(nearby([], 0, view)).toEqual({ from: 0, to: 0 })
  })

  test('and it never grows with the document', () => {
    const long = stack(pages(3000), LETTER, 1)
    const window = nearby(long, heightOf(long) / 2, view)

    expect(window.to - window.from).toBeLessThanOrEqual(4)
  })
})

describe('which page the reader is on', () => {
  const boxes = stack(pages(5), LETTER, 1)

  test('the first one, at the top', () => {
    expect(pageAt(boxes, 0, 600)).toBe(1)
  })

  test('whichever there is more of, where two of them show', () => {
    // A hair past the middle of the seam between pages two and three.
    const seam = GAP + 2 * (HEIGHT + GAP)
    expect(pageAt(boxes, seam - 100, 600)).toBe(3)
    expect(pageAt(boxes, seam - 500, 600)).toBe(2)
  })

  test('no page at all in a document with none', () => {
    expect(pageAt([], 0, 600)).toBe(0)
  })
})

describe('scrolling to a page', () => {
  const boxes = stack(pages(4), LETTER, 1)

  test('puts it at the top, with its margin above it', () => {
    expect(topOfPage(boxes, 1)).toBe(0)
    expect(topOfPage(boxes, 2)).toBe(GAP + HEIGHT)
  })

  test('a page the document does not have is the nearest one it does', () => {
    expect(topOfPage(boxes, 99)).toBe(topOfPage(boxes, 4))
    expect(topOfPage(boxes, 0)).toBe(0)
    expect(topOfPage([], 3)).toBe(0)
  })
})

describe('stepping the zoom', () => {
  test('to the next one along', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1, -1)).toBe(0.8)
  })

  test('past where a wheel left it, so a step always moves', () => {
    expect(nextZoom(1.1, 1)).toBe(1.25)
    expect(nextZoom(1.1, -1)).toBe(1)
  })

  test('and stops at either end', () => {
    expect(nextZoom(4, 1)).toBe(4)
    expect(nextZoom(0.5, -1)).toBe(0.5)
  })

  test('held to what a page may be drawn at', () => {
    expect(heldZoom(1)).toBe(1)
    expect(heldZoom(40)).toBe(4)
    expect(heldZoom(0.01)).toBe(0.5)
  })
})

describe('the canvas a page is drawn on', () => {
  const PAGE = { width: 800, height: 1000 }

  test('holds every device pixel of the screen it is on', () => {
    expect(sheetFor(PAGE, 16 * 1024 * 1024, 2)).toEqual({
      width: 1600,
      height: 2000,
      drawn: { transform: [2, 0, 0, 2, 0, 0] },
    })
  })

  test('asks pdf.js for no transform at one to one', () => {
    expect(sheetFor(PAGE, 16 * 1024 * 1024, 1)).toEqual({ width: 800, height: 1000, drawn: {} })
  })

  test('draws a little softer past its ceiling rather than asking for more', () => {
    const fit = sheetFor(PAGE, PAGE.width * PAGE.height * 1.5 ** 2, 3)

    expect(fit).toEqual({ width: 1200, height: 1500, drawn: { transform: [1.5, 0, 0, 1.5, 0, 0] } })
  })

  test('though never below one device pixel to the CSS pixel', () => {
    expect(sheetFor(PAGE, 1000, 2)).toEqual({ width: 800, height: 1000, drawn: {} })
  })
})
