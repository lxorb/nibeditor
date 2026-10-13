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

  // lxorb, issue #238: glass came out light over dark sites. Read off the sites
  // themselves on 2026-10-13, through web_tint.rs's own script.
  test('is what it paints where its theme colour is a grey of the other lightness', () => {
    // YouTube, dark: a near-white bar named over a black page.
    const youtube = {
      theme: 'rgba(255, 255, 255, 0.98)',
      top: ['#000000', '#ffffff', '#000000'],
      pictured: false,
    }
    expect(groundSaid(youtube)).toEqual([0, 0, 0])
    // react.dev, light: its dark mode's bar named over a white page.
    const react = { theme: '#23272f', top: ['#ffffff', '#ffffff', '#ffffff'], pictured: false }
    expect(groundSaid(react)).toEqual([255, 255, 255])
  })

  test('keeps a grey theme colour of the same lightness, and any colour with a hue', () => {
    // GitHub, dark: a dark bar over a darker page.
    const github = { theme: '#1e2327', top: ['#0d1117', '#0d1117', '#0d1117'], pictured: false }
    expect(groundSaid(github)).toEqual([30, 35, 39])
    // A brand's blue stands even over a white page.
    const discord = { theme: '#161cbb', top: ['#ffffff', '#ffffff', '#ffffff'], pictured: false }
    expect(groundSaid(discord)).toEqual([22, 28, 187])
  })

  test('keeps its theme colour where the top is a picture and cannot say otherwise', () => {
    const linear = { theme: '#08090a', top: ['', '', ''], pictured: true }
    expect(groundSaid(linear)).toEqual([8, 9, 10])
    // Proton, the owner's example: its violet over its gradient, and over its white page
    // in the light, since a colour with a hue is the site's own.
    const proton = { theme: '#1b1340', top: ['', '', ''], pictured: true }
    expect(groundSaid(proton)).toEqual([27, 19, 64])
    expect(
      groundSaid({ ...proton, top: ['#ffffff', '#ffffff', '#ffffff'], pictured: false }),
    ).toEqual([27, 19, 64])
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

  test('is what a picture too busy for one colour comes to, as dark as it is', () => {
    const busy = pixels(
      ...many(30, [200, 0, 0]),
      ...many(30, [0, 200, 0]),
      ...many(40, [0, 0, 200]),
    )
    expect(stripGround(busy)).toEqual([60, 60, 80])
    // A dark hero image under a header: dark, not left to the site's mark.
    const hero = pixels(
      ...many(25, [10, 10, 12]),
      ...many(25, [40, 20, 20]),
      ...many(25, [20, 30, 40]),
      ...many(25, [90, 60, 40]),
    )
    const ground = stripGround(hero)
    expect(ground).not.toBeNull()
    expect(Math.max(...(ground ?? [255]))).toBeLessThan(60)
  })

  test('is nothing with nothing to count', () => {
    expect(stripGround(pixels(...many(4, [255, 255, 255, 0])))).toBeNull()
  })
})
