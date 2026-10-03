import { describe, expect, test } from 'vitest'
import { cutOf, type Layer } from './covers'

const PAGE = { x: 300, y: 100, width: 900, height: 600 }

function float(x: number, y: number, width: number, height: number, radius = 8): Layer {
  return { box: { x, y, width, height }, radius, scrim: false }
}

const SCRIM: Layer = { box: { x: 0, y: 0, width: 1200, height: 800 }, radius: 0, scrim: true }

describe('what of a page the app is over', () => {
  test('nothing open is nothing over it', () => {
    expect(cutOf(PAGE, [])).toBeNull()
  })

  test('a menu over the file list leaves the page alone', () => {
    expect(cutOf(PAGE, [float(20, 200, 220, 300)])).toBeNull()
  })

  test("a tab's card over the strip and not the page leaves it alone", () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 70)])).toBeNull()
  })

  test('a card hanging over the page is cut out of it, in the page’s own coordinates', () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 216)])).toEqual({
      all: false,
      hollows: [{ x: 20, y: -70, width: 256, height: 216, radius: 8 }],
    })
  })

  test('each layer over the page is its own hollow', () => {
    const cut = cutOf(PAGE, [
      float(400, 120, 200, 300),
      float(620, 140, 180, 200),
      float(0, 0, 10, 10),
    ])
    expect(cut?.all).toBe(false)
    expect(cut?.hollows).toHaveLength(2)
  })

  test('a scrim covers all of the page, and the sheet on it is still its own hollow', () => {
    const cut = cutOf(PAGE, [SCRIM, float(400, 150, 500, 400, 12)])
    expect(cut?.all).toBe(true)
    expect(cut?.hollows).toEqual([{ x: 100, y: 50, width: 500, height: 400, radius: 12 }])
  })

  test('a layer with no size yet is not over anything', () => {
    expect(cutOf(PAGE, [float(400, 120, 0, 0)])).toBeNull()
  })

  test('a layer only touching the edge of the page is not over it', () => {
    expect(cutOf(PAGE, [float(100, 100, 200, 100)])).toBeNull()
  })
})
