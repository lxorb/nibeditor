import { describe, expect, test } from 'vitest'
import {
  AA,
  hexOf,
  inkFor,
  luminance,
  over,
  ratio,
  type Rgb,
  rgbOf,
  scrimFloor,
} from './legibility'

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

describe('reading a colour', () => {
  test('takes every shape a stylesheet and a computed style hand over', () => {
    expect(rgbOf('#fff')).toEqual([255, 255, 255])
    expect(rgbOf('#7C6BF5')).toEqual([124, 107, 245])
    expect(rgbOf('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(rgbOf('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3])
    expect(rgbOf('rgb(255 255 255 / 0.04)')).toEqual([255, 255, 255])
  })

  test('and nothing else', () => {
    for (const said of ['', 'red', '#ff', 'rgb(1, 2)', 'color(srgb 1 1 1)', 'rgb(a, b, c)']) {
      expect(rgbOf(said), said).toBeNull()
    }
  })

  test('writes it back as a hex a property takes', () => {
    expect(hexOf([124, 107, 245])).toBe('#7c6bf5')
    expect(hexOf([0.4, 254.6, 16])).toBe('#00ff10')
  })
})

describe('WCAG’s sums', () => {
  test('are black at nothing and white at one', () => {
    expect(luminance(BLACK)).toBe(0)
    expect(luminance(WHITE)).toBeCloseTo(1, 10)
  })

  test('put black on white at twenty-one to one, either way round', () => {
    expect(ratio(BLACK, WHITE)).toBeCloseTo(21, 10)
    expect(ratio(WHITE, BLACK)).toBeCloseTo(21, 10)
    expect(ratio(WHITE, WHITE)).toBe(1)
  })

  test('agree with the numbers tokens.css was measured at', () => {
    // The dark side's muted on its own page: the comment there says over 4.5.
    expect(ratio(rgbOf('#878f9d')!, rgbOf('#0e1013')!)).toBeGreaterThan(AA)
    // And the light side's accent ink on its accent.
    expect(ratio(WHITE, rgbOf('#5b4be0')!)).toBeGreaterThan(AA)
  })

  test('lay one colour over another channel by channel', () => {
    expect(over(WHITE, 0.5, BLACK)).toEqual([127.5, 127.5, 127.5])
    expect(over(WHITE, 0, BLACK)).toEqual(BLACK)
    expect(over(WHITE, 1, BLACK)).toEqual(WHITE)
  })
})

describe('the ink that reads', () => {
  const INKS: Rgb[] = [rgbOf('#0b0d10')!, WHITE]

  test('is dark on a light ground and light on a dark one', () => {
    expect(inkFor(WHITE, INKS)).toEqual(INKS[0])
    expect(inkFor(rgbOf('#f7d23c')!, INKS)).toEqual(INKS[0])
    expect(inkFor(BLACK, INKS)).toEqual(WHITE)
    expect(inkFor(rgbOf('#1a2980')!, INKS)).toEqual(WHITE)
  })

  test('is the closer of the two where neither clears the floor', () => {
    const greys: Rgb[] = [
      [110, 110, 110],
      [140, 140, 140],
    ]
    expect(inkFor([125, 125, 125], greys)).toEqual(
      ratio(greys[0]!, [125, 125, 125]) > ratio(greys[1]!, [125, 125, 125]) ? greys[0] : greys[1],
    )
  })
})

describe('the least scrim', () => {
  const INK = rgbOf('#b6bec9')!
  const SCRIM = rgbOf('#151a21')!

  /** Whether the ink clears the floor over a colour under that much scrim. */
  const reads = (alpha: number, under: Rgb) => ratio(INK, over(SCRIM, alpha, under)) >= AA

  test('is nothing where the picture already reads', () => {
    expect(scrimFloor(INK, SCRIM, { least: BLACK, most: [20, 20, 20] })).toBe(0)
  })

  test('is the hundredth that reads over white, and the one below it does not', () => {
    const floor = scrimFloor(INK, SCRIM, { least: BLACK, most: WHITE })

    expect(floor).toBeGreaterThan(0)
    expect(floor).toBeLessThan(1)
    expect(reads(floor, WHITE)).toBe(true)
    expect(reads(floor - 0.01, WHITE)).toBe(false)
  })

  test('reads over every colour between the two corners, not only over them', () => {
    const span = { least: [10, 40, 0] as Rgb, most: [250, 200, 255] as Rgb }
    const floor = scrimFloor(INK, SCRIM, span)

    for (let r = 10; r <= 250; r += 40) {
      for (let g = 40; g <= 200; g += 40) {
        for (let b = 0; b <= 255; b += 51)
          expect(reads(floor, [r, g, b]), `${r} ${g} ${b}`).toBe(true)
      }
    }
  })

  test('counts what a row lays over it, which only ever lifts toward the ink', () => {
    const span = { least: BLACK, most: WHITE }
    const plain = scrimFloor(INK, SCRIM, span)
    const lifted = scrimFloor(INK, SCRIM, span, [{ colour: rgbOf('#e8edf4')!, alpha: 0.08 }])

    expect(lifted).toBeGreaterThanOrEqual(plain)
  })

  test('is the whole scrim where even that would not read, which is a wrong theme', () => {
    expect(scrimFloor(INK, [180, 186, 196], { least: BLACK, most: WHITE })).toBe(1)
  })

  test('never lets a picture through that is lighter than the words on one side and darker on the other', () => {
    // A grey ink sitting between the corners: each corner clears it, from opposite sides.
    const ink: Rgb = [118, 118, 118]
    const span = { least: BLACK, most: WHITE }
    const floor = scrimFloor(ink, BLACK, span, [], 1.5)

    for (let level = 0; level <= 255; level += 5) {
      expect(
        ratio(ink, over(BLACK, floor, [level, level, level])),
        String(level),
      ).toBeGreaterThanOrEqual(1.5)
    }
  })
})
