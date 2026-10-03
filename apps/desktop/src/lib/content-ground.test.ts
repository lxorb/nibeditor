import { describe, expect, test } from 'vitest'
import {
  alphaFor,
  BODY,
  layered,
  linkOf,
  type PaperInks,
  paperFloor,
  TERMINAL_CONTRAST,
} from './content-ground'
import { AA, luminance, over, ratio, type Rgb, type Span } from './legibility'

/** The paper's own inks on each side, as glass and the wallpaper write them. */
const INKS: Record<'dark' | 'light', PaperInks> = {
  dark: {
    bg: [14, 16, 19],
    text: [232, 237, 244],
    muted: [182, 190, 201],
    link: linkOf([124, 107, 245], [255, 255, 255]),
  },
  light: {
    bg: [251, 252, 253],
    text: [19, 22, 27],
    muted: [76, 85, 99],
    link: linkOf([91, 75, 224], [5, 7, 10]),
  },
}

/** What can be under a note: the worst there is, and some ordinary grounds. */
const SPANS: Record<string, Span> = {
  white: { least: [255, 255, 255], most: [255, 255, 255] },
  black: { least: [0, 0, 0], most: [0, 0, 0] },
  'black and white': { least: [0, 0, 0], most: [255, 255, 255] },
  'a dark Mica': { least: [0, 0, 0], most: [58, 58, 58] },
  'a light Mica': { least: [192, 192, 192], most: [255, 255, 255] },
  'a sunset': { least: [60, 10, 20], most: [255, 140, 60] },
}

/** The ground the paper makes at an alpha over each corner of a span. */
function grounds(inks: PaperInks, alpha: number, span: Span): Rgb[] {
  return [span.least, span.most].map((under) => over(inks.bg, alpha, under))
}

describe('the paper a note is read on', () => {
  for (const [side, inks] of Object.entries(INKS)) {
    for (const [name, span] of Object.entries(SPANS)) {
      test(`${side} over ${name}: body text at AAA and the quiet ink and a link at AA`, () => {
        const floor = paperFloor(inks, span)
        expect(floor).toBeGreaterThanOrEqual(0)
        expect(floor).toBeLessThanOrEqual(1)
        for (const level of ['clear', 'tinted', 'opaque'] as const) {
          for (const ground of grounds(inks, alphaFor(level, floor), span)) {
            expect(ratio(inks.text, ground), level).toBeGreaterThanOrEqual(BODY)
            expect(ratio(inks.muted, ground), level).toBeGreaterThanOrEqual(AA)
            expect(ratio(inks.link, ground), level).toBeGreaterThanOrEqual(AA)
          }
        }
      })
    }
  }

  test('needs none where what is under it is the paper itself', () => {
    expect(paperFloor(INKS.dark, { least: INKS.dark.bg, most: INKS.dark.bg })).toBe(0)
  })

  test('is all of it over a desk that holds both black and white', () => {
    expect(paperFloor(INKS.dark, SPANS['black and white']!)).toBeGreaterThan(0.8)
    expect(paperFloor(INKS.light, SPANS['black and white']!)).toBeGreaterThan(0.8)
  })
})

describe('the three levels', () => {
  test('are the paper, the floor and halfway, never under the floor', () => {
    expect(alphaFor('opaque', 0.3)).toBe(1)
    expect(alphaFor('clear', 0.3)).toBe(0.3)
    expect(alphaFor('tinted', 0.3)).toBe(0.65)
    expect(alphaFor('tinted', 0)).toBe(0.5)
    expect(alphaFor('tinted', 1)).toBe(1)
  })
})

describe('the terminal', () => {
  test('lays over the paper only the rest of the way to its own floor', () => {
    expect(layered(0.6, 0.6)).toBe(0)
    expect(layered(1, 0.5)).toBe(1)
    expect(layered(0.75, 0.5)).toBe(0.5)
    expect(layered(0.4, 1)).toBe(1)
    // Two layers at p and l are one at p + (1 - p) l, which is never under the floor.
    for (const [total, under] of [
      [0.83, 0.41],
      [0.9, 0.12],
      [0.5, 0.49],
    ] as const) {
      const laid = layered(total, under)
      expect(under + (1 - under) * laid).toBeGreaterThanOrEqual(total)
    }
  })

  test('keeps every colour xterm.js writes at AA, once it has pulled them to its own aim', () => {
    for (const [side, inks] of Object.entries(INKS)) {
      for (const [name, span] of Object.entries(SPANS)) {
        const floor = paperFloor(inks, span, true)
        const paper = luminance(inks.bg)
        // The colour xterm.js leaves closest to the paper: exactly its aim from it.
        const nearest =
          paper < 0.5
            ? (paper + 0.05) * TERMINAL_CONTRAST - 0.05
            : (paper + 0.05) / TERMINAL_CONTRAST - 0.05
        for (const ground of grounds(inks, floor, span)) {
          const under = luminance(ground)
          const [light, dark] = [nearest, under].sort((a, b) => b - a) as [number, number]
          expect((light + 0.05) / (dark + 0.05), `${side} over ${name}`).toBeGreaterThanOrEqual(AA)
        }
      }
    }
  })
})
