import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { wallpaperCss } from '@nib/themes/wallpaper'
import { describe, expect, test } from 'vitest'
import { ACCENTS } from '../accents'
import { AA, type Lift, over, ratio, type Rgb, rgbOf, type Span } from '../legibility'
import { floorFor, type Palette, paletteOf } from './floors'

/** The promise wallpaper.css makes, held to the sheet itself: the quietest word on the
 *  chrome clears AA over every picture at its floor, on every stack a word stands on,
 *  and the floors the sheet states for the accent field are enough for that field
 *  whichever accent the reader chose. */

const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

const SIDES = ['dark', 'light'] as const
type Side = (typeof SIDES)[number]

const accents = (side: Side): Rgb[] => ACCENTS.map((one) => rgbOf(one[side])!)

function palette(side: Side): Palette {
  const found = paletteOf(wallpaperCss, side)
  if (!found) throw new Error(`wallpaper.css states no ${side} palette`)
  return found
}

/** Every stack floors.ts promises, laid out again here rather than taken from it. */
function stacks(one: Palette): Lift[][] {
  expect(wallpaperCss).toContain(
    '--item-hover-bg-color: color-mix(in srgb, var(--text) 8%, var(--wallpaper-scrim) 40%);',
  )
  const hover = { colour: over(one.text, 8 / 48, one.scrim), alpha: 0.48 }
  return [[], [hover], [one.layer], [one.layer, hover]]
}

function readsEverywhere(one: Palette, alpha: number, under: Rgb): boolean {
  return stacks(one).every((lifts) => {
    const ground = lifts.reduce(
      (below, lift) => over(lift.colour, lift.alpha, below),
      over(one.scrim, alpha, under),
    )
    return ratio(one.ink, ground) >= AA
  })
}

/** A token as one side of a sheet states it. */
function tokenOf(css: string, side: Side, name: string): Rgb {
  const head = new RegExp(String.raw`\[data-theme='${side}'\]\s*\{`).exec(css)!
  const block = css.slice(head.index, css.indexOf('}', head.index))
  return rgbOf(new RegExp(String.raw`${name}:\s*([^;]+);`).exec(block)![1]!)!
}

describe('the palette', () => {
  test('is read out of the sheet, both sides', () => {
    for (const side of SIDES) {
      const one = palette(side)
      expect(one.layer.alpha).toBeGreaterThan(0)
      expect(one.layer.alpha).toBeLessThan(1)
      // The scrim alone is a ground every word reads on, or no floor could help.
      expect(readsEverywhere(one, 1, BLACK), side).toBe(true)
    }
  })
})

/** Pictures as what they hold: the worst there are, and some ordinary ones. */
const PICTURES: Record<string, Span> = {
  white: { least: WHITE, most: WHITE },
  black: { least: BLACK, most: BLACK },
  'black and white': { least: BLACK, most: WHITE },
  'a red sunset': { least: [60, 10, 20], most: [255, 140, 60] },
  'a yellow field': { least: [180, 160, 0], most: [255, 240, 90] },
  'a night sky': { least: [2, 4, 12], most: [40, 50, 90] },
}

describe('the open note’s row', () => {
  /** A pill of the accent on the scrim's own colour, opaque, whatever is under it. */
  test('reads in its quietest ink on every accent, both sides', () => {
    expect(wallpaperCss).toMatch(
      /--active-file-bg-color:\s*color-mix\(in srgb, var\(--accent\) 16%, var\(--wallpaper-scrim\)\)/,
    )
    for (const side of SIDES) {
      const scrim = tokenOf(wallpaperCss, side, '--wallpaper-scrim')
      const strong = tokenOf(wallpaperCss, side, '--muted-strong')
      for (const accent of accents(side)) {
        expect(
          ratio(strong, over(accent, 0.16, scrim)),
          `${side} ${String(accent)}`,
        ).toBeGreaterThanOrEqual(AA)
      }
    }
  })
})

describe('the floor', () => {
  for (const side of SIDES) {
    for (const [name, span] of Object.entries(PICTURES)) {
      test(`reads on the ${side} side over ${name}, and the hundredth below it does not`, () => {
        const one = palette(side)
        const floor = floorFor(one, span)

        expect(floor).toBeLessThan(1)
        for (const under of [span.least, span.most])
          expect(readsEverywhere(one, floor, under)).toBe(true)
        if (floor > 0) {
          expect(
            [span.least, span.most].every((under) => readsEverywhere(one, floor - 0.01, under)),
          ).toBe(false)
        }
      })
    }
  }

  test('only ever rises under the Dim dial, which is a second scrim over it', () => {
    for (const floor of [0, 0.3, 0.6]) {
      for (const dim of [0, 0.2, 0.9])
        expect(floor + (1 - floor) * dim).toBeGreaterThanOrEqual(floor)
    }
  })
})

describe('the accent field, before a picture is chosen', () => {
  /** What the sheet says the floor is with no picture said on the root. */
  function statedFloor(side: Side): number {
    const found = new RegExp(
      String.raw`--wallpaper-floor:\s*var\(--wallpaper-floor-${side},\s*(\d+)%\)`,
    ).exec(wallpaperCss)
    return Number(found?.[1]) / 100
  }

  /** How much of a colour the field mixes in, as the sheet writes it. */
  const share = (token: string) =>
    Number(new RegExp(String.raw`var\(${token}\) (\d+)%`).exec(wallpaperCss)?.[1]) / 100

  /** Every colour the field can come to with one accent: its two grounds, the accent
   *  over them, and the canvas's blue over any of those. Every point of the field is
   *  a mix of these, so it stays inside the box they make. */
  function fieldOf(side: Side, accent: Rgb): Span {
    const canvas = tokenOf(TOKENS, side, '--canvas-5')
    const grounds = [
      tokenOf(wallpaperCss, side, '--wallpaper-base-1'),
      tokenOf(wallpaperCss, side, '--wallpaper-base-2'),
    ]
    const lit = grounds.map((ground) => over(accent, share('--accent'), ground))
    const colours = [
      ...grounds,
      ...lit,
      ...[...grounds, ...lit].map((one) => over(canvas, share('--canvas-5'), one)),
    ]

    return {
      least: [0, 1, 2].map((at) => Math.min(...colours.map((one) => one[at]!))) as unknown as Rgb,
      most: [0, 1, 2].map((at) => Math.max(...colours.map((one) => one[at]!))) as unknown as Rgb,
    }
  }

  for (const side of SIDES) {
    test(`is covered by the ${side} floor the sheet states, whichever accent`, () => {
      const needed = Math.max(
        ...accents(side).map((accent) => floorFor(palette(side), fieldOf(side, accent))),
      )
      expect(needed).toBeLessThanOrEqual(statedFloor(side))
    })
  }
})
