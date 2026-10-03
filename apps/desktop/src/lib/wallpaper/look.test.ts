import { wallpaperCss } from '@nib/themes/wallpaper'
import { describe, expect, test } from 'vitest'
import { accentColour } from '../accents'
import { alphaFor, BODY, layered, linkOf } from '../content-ground'
import { AA, over, ratio, type Rgb, rgbOf, SHARP, type Span } from '../legibility'
import { type Palette, paletteOf } from './floors'
import type { Held } from './held'
import {
  aimFor,
  type Colours,
  type Dials,
  floorsOf,
  grained,
  grainOf,
  placement,
  wallpaperRule,
} from './look'

/** The promise the wallpaper's dials make, held at every end of every dial: whatever
 *  the picture, the blur, the grain and the Content row say, the quietest word on the
 *  frame reads at its aim - higher over a sharp picture - and body text on the note at
 *  seven to one. */

const SIDES = ['dark', 'light'] as const
type Side = (typeof SIDES)[number]

function palette(side: Side): Palette {
  const found = paletteOf(wallpaperCss, side)
  if (!found) throw new Error(`wallpaper.css states no ${side} palette`)
  return found
}

const PAPER: Record<Side, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
const STRONG: Record<Side, Rgb> = { dark: [255, 255, 255], light: [5, 7, 10] }

function colours(side: Side): Colours {
  const one = palette(side)
  return {
    palette: one,
    inks: {
      bg: PAPER[side],
      text: one.text,
      muted: one.ink,
      link: linkOf(rgbOf(accentColour('violet', side))!, STRONG[side]),
    },
    field: { least: PAPER[side], most: one.text },
  }
}

const PICTURES: Record<string, Span> = {
  white: { least: [255, 255, 255], most: [255, 255, 255] },
  black: { least: [0, 0, 0], most: [0, 0, 0] },
  'black and white': { least: [0, 0, 0], most: [255, 255, 255] },
  'a bright sky': { least: [124, 196, 255], most: [255, 255, 255] },
  'a night sky': { least: [2, 4, 12], most: [255, 255, 255] },
  'a red sunset': { least: [60, 10, 20], most: [255, 140, 60] },
}

function held(span: Span): Held {
  return {
    picture: 'data:image/png;base64,AAAA',
    blur: 28,
    span,
    mean: '#808080',
    focus: [0.5, 0.5],
  }
}

/** Every stack a word on the frame stands on, as floors.ts lays them. */
function stacks(one: Palette, ground: Rgb): Rgb[] {
  const hover = { colour: over(one.text, 8 / 48, one.scrim), alpha: 0.48 }
  const layered = over(one.layer.colour, one.layer.alpha, ground)
  return [
    ground,
    over(hover.colour, hover.alpha, ground),
    layered,
    over(hover.colour, hover.alpha, layered),
  ]
}

describe('every end of every dial', () => {
  for (const side of SIDES) {
    for (const [name, span] of Object.entries(PICTURES)) {
      for (const blur of [0, 8, 60]) {
        for (const grain of [0, 100]) {
          test(`${side}, ${name}, blur ${blur}, grain ${grain}`, () => {
            const sides = colours(side)
            const floors = floorsOf(held(span), side, { blur, grain }, sides, 0.5)
            const under = grained(span, grain)
            const aim = aimFor(blur)

            // The frame: the chrome's scrim at its floor, and the Dim dial at both
            // ends of it on top, which only ever helps.
            for (const dim of [0, 0.9]) {
              const scrim = floors.chrome + (1 - floors.chrome) * dim
              for (const corner of [under.least, under.most]) {
                for (const ground of stacks(
                  sides.palette,
                  over(sides.palette.scrim, scrim, corner),
                )) {
                  expect(ratio(sides.palette.ink, ground)).toBeGreaterThanOrEqual(aim - 0.01)
                }
              }
            }

            // The note, at every level of the Content row.
            for (const level of ['clear', 'tinted', 'opaque'] as const) {
              const paper = alphaFor(level, floors.paper)
              const terminal = layered(alphaFor(level, floors.terminal), paper)
              for (const corner of [under.least, under.most]) {
                const frame = over(sides.palette.scrim, floors.chrome, corner)
                const ground = over(sides.inks.bg, paper, frame)
                expect(ratio(sides.inks.text, ground)).toBeGreaterThanOrEqual(BODY)
                expect(ratio(sides.inks.muted, ground)).toBeGreaterThanOrEqual(AA)
                expect(ratio(sides.inks.link, ground)).toBeGreaterThanOrEqual(AA)
                // The terminal's own layer only ever adds paper.
                expect(paper + (1 - paper) * terminal).toBeGreaterThanOrEqual(paper)
              }
            }
          })
        }
      }
    }
  }

  test('a sharp picture aims higher than a soft one, and AA past a soft blur', () => {
    expect(aimFor(0)).toBe(SHARP)
    expect(aimFor(16)).toBe(AA)
    expect(aimFor(60)).toBe(AA)
    expect(aimFor(8)).toBeGreaterThan(AA)
    const sides = colours('dark')
    const span = PICTURES['a bright sky']!
    const sharp = floorsOf(held(span), 'dark', { blur: 0, grain: 0 }, sides, 0.5)
    const soft = floorsOf(held(span), 'dark', { blur: 40, grain: 0 }, sides, 0.5)
    expect(sharp.chrome).toBeGreaterThan(soft.chrome)
  })

  test('grain widens what the picture holds, and only as far as its noise reaches', () => {
    const span = { least: [100, 100, 100], most: [150, 150, 150] } as Span
    expect(grained(span, 0)).toEqual(span)
    const most = grained(span, 100)
    expect(most.least[0]).toBeLessThan(100)
    expect(most.most[0]).toBeGreaterThan(150)
    expect(grainOf(0)).toBe('none')
    expect(grainOf(50)).toMatch(/^url\("data:image\/svg\+xml,/)
  })

  test('a picture an older build made keeps its own floor and a careful paper', () => {
    const older: Held = {
      picture: 'data:image/png;base64,AAAA',
      blur: 28,
      focus: [0.5, 0.5],
      dark: { floor: 0.52, ground: '#202630' },
      light: { floor: 0.61, ground: '#e9ecf2' },
    }
    const floors = floorsOf(older, 'dark', { blur: 28, grain: 0 }, colours('dark'), 0.5)
    expect(floors.chrome).toBe(0.52)
    expect(floors.paper).toBeGreaterThan(0.5)
  })
})

describe('where the picture is laid', () => {
  const one: Held = { ...held(PICTURES.white!), focus: [0.2, 0.75], size: [800, 600] }

  test('fills at its focal point, fits there, tiles at its own size and centres on it', () => {
    expect(placement(one, 'fill')).toEqual({
      size: 'cover',
      position: '20% 75%',
      repeat: 'no-repeat',
    })
    expect(placement(one, 'fit')).toEqual({
      size: 'contain',
      position: '20% 75%',
      repeat: 'no-repeat',
    })
    expect(placement(one, 'tile')).toEqual({
      size: '800px 600px',
      position: '0 0',
      repeat: 'repeat',
    })
    expect(placement(one, 'centre')).toEqual({
      size: '800px 600px',
      position: 'calc(50% - 160px) calc(50% - 450px)',
      repeat: 'no-repeat',
    })
  })

  test('fills where it does not know its own size', () => {
    expect(placement(held(PICTURES.white!), 'tile').size).toBe('cover')
  })
})

describe('the rule', () => {
  const dials: Dials = { blur: 28, dim: 10, grain: 0, fit: 'fill', empty: true, content: 'tinted' }
  const both = { dark: colours('dark'), light: colours('light') }
  const fields = { dark: 0.53, light: 0.51 }

  test('says the picture, each side’s floors and papers, and the dials', () => {
    const rule = wallpaperRule({ light: held(PICTURES.white!), dark: null }, dials, both, fields)
    expect(rule).toContain('--wallpaper-picture: url("data:image/png;base64,AAAA");')
    for (const side of SIDES) {
      expect(rule).toMatch(new RegExp(`--wallpaper-floor-${side}: \\d+%;`))
      expect(rule).toMatch(new RegExp(`--wallpaper-paper-${side}: \\d+%;`))
      expect(rule).toMatch(new RegExp(`--wallpaper-terminal-${side}: \\d+%;`))
    }
    expect(rule).toContain('--nib-dim: 10%;')
    expect(rule).toContain('--empty-ground: transparent;')
    expect(rule).toContain('--content-inner: transparent;')
    expect(rule).not.toContain(":root[data-theme='dark']")
  })

  test('at Opaque lays the whole paper, and what stands on it paints its own', () => {
    const rule = wallpaperRule(
      { light: held(PICTURES.white!), dark: null },
      { ...dials, content: 'opaque', empty: false },
      both,
      fields,
    )
    expect(rule).toContain('--wallpaper-paper-dark: 100%;')
    expect(rule).toContain('--wallpaper-paper-light: 100%;')
    expect(rule).not.toContain('--content-inner')
    expect(rule).toContain('--empty-ground: var(--content-ground);')
  })

  test('gives the dark side its own picture where it has one', () => {
    const dark = { ...held(PICTURES.black!), picture: 'data:image/png;base64,BBBB' }
    const rule = wallpaperRule({ light: held(PICTURES.white!), dark }, dials, both, fields)
    expect(rule).toContain(":root[data-theme='dark'] {")
    expect(rule.slice(rule.indexOf(":root[data-theme='dark']"))).toContain('BBBB')
  })
})
