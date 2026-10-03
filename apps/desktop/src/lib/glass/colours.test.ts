import { describe, expect, test } from 'vitest'
import { agreed, dominant, groundSaid, solid, stripGround } from './colours'

/** A picture as a canvas hands it over, from a list of pixels. */
function pixels(...each: [number, number, number, number?][]): number[] {
  return each.flatMap(([r, g, b, a = 255]) => [r, g, b, a])
}

function many(
  count: number,
  pixel: [number, number, number, number?],
): [number, number, number, number?][] {
  return Array.from({ length: count }, () => pixel)
}

describe('a colour a page names', () => {
  test('is read in every spelling a canvas or a stylesheet hands back', () => {
    expect(solid('#ff0000')).toEqual([255, 0, 0])
    expect(solid('#f00')).toEqual([255, 0, 0])
    expect(solid('rgb(12, 34, 56)')).toEqual([12, 34, 56])
    expect(solid('rgb(12 34 56 / 95%)')).toEqual([12, 34, 56])
    expect(solid('rgba(12, 34, 56, 0.95)')).toEqual([12, 34, 56])
  })

  test('is nothing when it is see-through or not a colour', () => {
    expect(solid('rgba(12, 34, 56, 0.5)')).toBeNull()
    expect(solid('rgba(0, 0, 0, 0)')).toBeNull()
    expect(solid('rgb(0 0 0 / 40%)')).toBeNull()
    expect(solid('')).toBeNull()
    expect(solid('tomato')).toBeNull()
  })
})

describe('the top edge', () => {
  test('is the colour most points agree on, the middle first', () => {
    expect(
      agreed([
        [255, 255, 255],
        [250, 250, 250],
        [0, 0, 0],
      ]),
    ).toEqual([250, 250, 250])
    expect(
      agreed([
        [0, 0, 0],
        [255, 255, 255],
        [0, 0, 0],
      ]),
    ).toEqual([0, 0, 0])
  })

  test('says nothing where every point is different', () => {
    expect(
      agreed([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ]),
    ).toBeNull()
    expect(agreed([null, null, [0, 0, 0]])).toBeNull()
    expect(agreed([])).toBeNull()
  })
})

describe('what a page says it stands on', () => {
  test('is its theme colour first, whatever its top is', () => {
    const said = { theme: '#d32f2f', top: ['#ffffff', '#ffffff', '#ffffff'], pictured: false }
    expect(groundSaid(said)).toEqual([211, 47, 47])
  })

  test('is its top edge where it names none', () => {
    expect(
      groundSaid({ theme: '', top: ['#0f0f0f', '#0f0f0f', '#212121'], pictured: false }),
    ).toEqual([15, 15, 15])
  })

  test('is left to its picture where the top is one', () => {
    expect(groundSaid({ theme: '', top: ['#ffffff', '', '#ffffff'], pictured: true })).toBeNull()
  })

  test('takes a see-through theme colour as no word at all', () => {
    const said = {
      theme: 'rgba(255, 0, 0, 0.3)',
      top: ['#ffeb3b', '#ffeb3b', '#ffeb3b'],
      pictured: false,
    }
    expect(groundSaid(said)).toEqual([255, 235, 59])
  })
})

describe('a mark', () => {
  test('is its colour and not the white round it', () => {
    const logo = pixels(...many(60, [255, 255, 255]), ...many(20, [220, 30, 40]))
    const found = dominant(logo)
    expect(found).not.toBeNull()
    expect(found?.[0]).toBeGreaterThan(200)
    expect(found?.[1]).toBeLessThan(60)
  })

  test('is its most common grey where it has no colour', () => {
    expect(dominant(pixels(...many(10, [20, 20, 20]), ...many(3, [255, 255, 255])))).toEqual([
      20, 20, 20,
    ])
  })

  test('ignores what is see-through round its shape', () => {
    expect(dominant(pixels(...many(50, [0, 200, 0, 0]), ...many(5, [0, 0, 200])))).toEqual([
      0, 0, 200,
    ])
    expect(dominant(pixels(...many(4, [255, 0, 0, 10])))).toBeNull()
  })
})

describe("a page's still along its top", () => {
  test('is the colour most of it is', () => {
    expect(stripGround(pixels(...many(80, [255, 255, 255]), ...many(20, [30, 30, 30])))).toEqual([
      255, 255, 255,
    ])
  })

  test('is nothing for a picture too busy to have a ground', () => {
    const busy = pixels(
      ...many(30, [200, 0, 0]),
      ...many(30, [0, 200, 0]),
      ...many(40, [0, 0, 200]),
    )
    expect(stripGround(busy)).toBeNull()
  })
})
