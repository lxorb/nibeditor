import { describe, expect, test } from 'vitest'
import { blurred, boxesFor, fitted, LARGEST, measured, sharpBelow, sideFor, toned } from './pixels'

/** A picture `width` by `height`, every pixel what `paint` says, opaque. */
function picture(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      pixels.set([...paint(x, y), 255], at)
    }
  }
  return pixels
}

function at(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const from = (y * width + x) * 4
  return [...pixels.slice(from, from + 4)]
}

describe('how small the picture is kept', () => {
  test('is a pixel per half-blur of the screen', () => {
    expect(sideFor(28, 2560)).toBe(183)
    expect(sideFor(56, 2560)).toBe(91)
  })

  test('and never past the largest or under the smallest', () => {
    expect(sideFor(1, 3840)).toBe(LARGEST)
    expect(sideFor(60, 800)).toBe(64)
  })

  test('keeps the picture’s shape and never grows it', () => {
    expect(fitted(4000, 3000, 400)).toEqual([400, 300])
    expect(fitted(3000, 4000, 400)).toEqual([300, 400])
    expect(fitted(120, 80, 400)).toEqual([120, 80])
  })
})

describe('the blur', () => {
  test('is three boxes that add up to the Gaussian asked for', () => {
    for (const sigma of [0.8, 2, 5.5, 12]) {
      const boxes = boxesFor(sigma)
      // A box of width w has variance (w² - 1) / 12; three in a row add theirs.
      const variance = boxes.reduce((sum, width) => sum + (width * width - 1) / 12, 0)
      expect(Math.sqrt(variance), String(sigma)).toBeCloseTo(sigma, 0)
      for (const width of boxes) expect(width % 2).toBe(1)
    }
  })

  test('leaves a picture of one colour that colour, edges and all', () => {
    const flat = picture(20, 12, () => [40, 120, 200])
    const out = blurred(flat, 20, 12, 3)

    expect(at(out, 20, 0, 0)).toEqual([40, 120, 200, 255])
    expect(at(out, 20, 19, 11)).toEqual([40, 120, 200, 255])
    expect(at(out, 20, 10, 6)).toEqual([40, 120, 200, 255])
  })

  test('spreads a point evenly every way and keeps how much light there was', () => {
    const size = 31
    const point = picture(size, size, (x, y) =>
      x === 15 && y === 15 ? [255, 255, 255] : [0, 0, 0],
    )
    const out = blurred(point, size, size, 2)

    expect(at(out, size, 15, 15)[0]).toBeLessThan(255)
    expect(at(out, size, 13, 15)[0]).toBe(at(out, size, 17, 15)[0])
    expect(at(out, size, 15, 13)[0]).toBe(at(out, size, 15, 17)[0])
    let light = 0
    for (let index = 0; index < out.length; index += 4) light += out[index]!
    // Rounded to a byte at each of six passes, so near rather than exact.
    expect(Math.abs(light - 255)).toBeLessThan(60)
  })

  test('makes a picture opaque and leaves what it was given alone', () => {
    const holed = new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 0])
    const out = blurred(holed, 2, 1, 1)

    expect(out[3]).toBe(255)
    expect(holed[3]).toBe(0)
  })

  test('is no blur at all at nothing', () => {
    const one = picture(3, 3, (x) => [x * 100, 0, 0])
    expect([...blurred(one, 3, 3, 0)]).toEqual([...one])
  })
})

describe('what the picture holds', () => {
  test('is the least and the most of each channel, and the average', () => {
    const two = picture(2, 1, (x) => (x === 0 ? [0, 100, 255] : [200, 50, 55]))
    const { least, most, mean } = measured(two)

    expect(least).toEqual([0, 50, 55])
    expect(most).toEqual([200, 100, 255])
    expect(mean).toEqual([100, 75, 155])
  })
})

describe('the tone baked into a picture', () => {
  const sunset = () => picture(2, 1, (x) => (x ? [240, 120, 40] : [20, 60, 200]))

  test('is the picture as it is at full saturation and no tint', () => {
    const pixels = sunset()
    toned(pixels, { saturation: 1, tint: 0, colour: [255, 0, 0] })
    expect(at(pixels, 2, 0, 0)).toEqual([20, 60, 200, 255])
  })

  test('greys it with no saturation, by the weights CSS greys with', () => {
    const pixels = sunset()
    toned(pixels, { saturation: 0, tint: 0, colour: [0, 0, 0] })
    const [r, g, b] = at(pixels, 2, 1, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r).toBe(Math.round(0.213 * 240 + 0.715 * 120 + 0.072 * 40))
  })

  test('is the tint itself with all of it, and a mix with some', () => {
    const pixels = sunset()
    toned(pixels, { saturation: 1, tint: 1, colour: [124, 107, 245] })
    expect(at(pixels, 2, 0, 0)).toEqual([124, 107, 245, 255])

    const half = sunset()
    toned(half, { saturation: 1, tint: 0.5, colour: [0, 0, 0] })
    expect(at(half, 2, 1, 0)).toEqual([120, 60, 20, 255])
  })
})

describe('a picture sharp enough to want the screen’s own size', () => {
  test('is one blurred by less than the kept size can hold', () => {
    expect(sharpBelow(2560)).toBeCloseTo(10.67, 1)
    expect(sideFor(sharpBelow(2560) + 0.5, 2560)).toBeLessThan(LARGEST)
    expect(sideFor(sharpBelow(2560) - 0.5, 2560)).toBe(LARGEST)
  })
})
