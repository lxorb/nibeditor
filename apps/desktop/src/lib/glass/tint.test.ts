import { glassCss } from '@nib/themes/glass'
import { describe, expect, test } from 'vitest'
import { AA, type Rgb, over, ratio, rgbOf } from '../legibility'
import { paletteOf } from '../wallpaper/floors'
import {
  barFor,
  frameFor,
  type Material,
  MARK_TONE,
  PAGE_WASH,
  type Scheme,
  type Sides,
  spanUnder,
} from './tint'

const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
const dark = paletteOf(glassCss, 'dark', names)
const light = paletteOf(glassCss, 'light', names)
if (!dark || !light) throw new Error('glass.css no longer states both sides')
const sides: Sides = { dark, light }

const PAPER: Record<Scheme, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
const SCHEMES: Scheme[] = ['dark', 'light']
const MATERIALS: Material[] = ['mica', 'acrylic', null]

function rgb(hex: string): Rgb {
  const found = rgbOf(hex)
  if (!found) throw new Error(`not a colour: ${hex}`)
  return found
}

/** The four sites Emil's brief names, and a few more of the shapes the web comes in. */
const SITES: Record<string, Rgb> = {
  'white Google': [255, 255, 255],
  'black YouTube': [15, 15, 15],
  red: [255, 0, 0],
  yellow: [255, 235, 59],
  'Material red': [211, 47, 47],
  'GitHub dark': [13, 17, 23],
  'Twitter blue': [29, 155, 240],
  'mid grey': [128, 128, 128],
  'teal header': [0, 128, 128],
}

/** Whether one side's quietest word reads on a ground, alone and under a row's lift. */
function reads(scheme: Scheme, ground: Rgb): boolean {
  const side = sides[scheme]
  const grounds = [
    ground,
    over(side.text, 0.1, ground),
    over(side.layer.colour, side.layer.alpha, ground),
  ]
  return grounds.every((one) => ratio(side.ink, one) >= AA)
}

describe("a page's bar", () => {
  test('is the page itself where its words read on it, which is most pages', () => {
    for (const app of SCHEMES) {
      expect(barFor(SITES['white Google']!, app, sides)).toEqual({
        colour: '#ffffff',
        scheme: 'light',
      })
      expect(barFor(SITES['black YouTube']!, app, sides)).toEqual({
        colour: '#0f0f0f',
        scheme: 'dark',
      })
      expect(barFor(SITES.yellow!, app, sides)).toEqual({
        colour: '#ffeb3b',
        scheme: 'light',
      })
    }
  })

  test('is moved the least way that makes it read where the page is too loud to', () => {
    const bar = barFor(SITES.red!, 'dark', sides)
    expect(bar.colour).not.toBe('#ff0000')
    expect(reads(bar.scheme, rgb(bar.colour))).toBe(true)
    // Still red: the colour moved toward one side's chrome, not to it.
    const [r, g, b] = rgb(bar.colour)
    expect(r).toBeGreaterThan(g + 40)
    expect(r).toBeGreaterThan(b + 40)
  })

  test("keeps every word at AA on every site, under either of the reader's schemes", () => {
    for (const [name, page] of Object.entries(SITES)) {
      for (const app of SCHEMES) {
        const bar = barFor(page, app, sides)
        expect(reads(bar.scheme, rgb(bar.colour)), `${name} under ${app}`).toBe(true)
      }
    }
  })
})

describe('the frame', () => {
  test('is mostly the page, over the material', () => {
    const frame = frameFor(
      { colour: SITES['white Google']!, page: true },
      'dark',
      'mica',
      sides,
      PAPER.dark,
    )
    expect(frame.tint).toBe('#ffffff')
    expect(frame.scheme).toBe('light')
    expect(frame.wash).toBeGreaterThanOrEqual(PAGE_WASH)
  })

  test('keeps every word at AA over every colour the material can be, for every site', () => {
    for (const [name, page] of Object.entries(SITES)) {
      for (const app of SCHEMES) {
        for (const material of MATERIALS) {
          const frame = frameFor({ colour: page, page: true }, app, material, sides, PAPER[app])
          const span = spanUnder(material, app, PAPER[app])
          for (const under of [span.least, span.most]) {
            const ground = over(rgb(frame.tint), frame.wash, under)
            expect(reads(frame.scheme, ground), `${name}, ${app}, ${String(material)}`).toBe(true)
          }
        }
      }
    }
  })

  test("is a tone of a note's mark, always in the reader's own scheme", () => {
    const green: Rgb = [0, 160, 90]
    const frame = frameFor({ colour: green, page: false }, 'dark', 'mica', sides, PAPER.dark)
    // A tone of it: greener than the chrome, and no more of it than MARK_TONE.
    const [r, g] = rgb(frame.tint)
    expect(g).toBeGreaterThan(sides.dark.scrim[1] + 8)
    expect(g).toBeGreaterThan(r + 8)
    expect(g).toBeLessThanOrEqual(Math.round(over(green, MARK_TONE, sides.dark.scrim)[1]))

    for (const mark of [
      [124, 107, 245],
      [255, 255, 0],
      [0, 0, 0],
    ] as Rgb[]) {
      for (const app of SCHEMES) {
        expect(frameFor({ colour: mark, page: false }, app, 'mica', sides, PAPER[app]).scheme).toBe(
          app,
        )
      }
    }
  })

  test('keeps every word at AA over a mark of any colour', () => {
    const marks: Rgb[] = [
      [255, 0, 0],
      [255, 255, 0],
      [0, 0, 0],
      [255, 255, 255],
      [0, 200, 120],
      [124, 107, 245],
    ]
    for (const mark of marks) {
      for (const app of SCHEMES) {
        for (const material of MATERIALS) {
          const frame = frameFor({ colour: mark, page: false }, app, material, sides, PAPER[app])
          const span = spanUnder(material, app, PAPER[app])
          for (const under of [span.least, span.most]) {
            const ground = over(rgb(frame.tint), frame.wash, under)
            expect(
              reads(frame.scheme, ground),
              `${mark.join(',')}, ${app}, ${String(material)}`,
            ).toBe(true)
          }
        }
      }
    }
  })
})
