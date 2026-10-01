/** The picture as numbers: how small it may be kept, the blur, and what it holds.
 *
 *  Pure, over the RGBA bytes a canvas hands back, so all of it is tested without a
 *  canvas; see pixels.test.ts. The canvas half - decoding and encoding - is
 *  render.ts. */

import type { Rgb, Span } from '../legibility'

/** The longest side a blurred picture is ever kept at. Past this a picture under
 *  the least blur the dial offers has more detail than the blur leaves in it. */
export const LARGEST = 480
/** And the least: a picture under the most blur on a small screen is a few colour
 *  fields, and below this the fields themselves start to show their edges. */
const SMALLEST = 64

/** How long the longest side of the kept picture should be, for a blur of `blur`
 *  pixels on a screen whose longest side is `screen` pixels.
 *
 *  A blur of that many pixels leaves nothing finer than about half of it, so a
 *  picture with one pixel per half-blur of screen holds everything there is to see,
 *  and the screen's own scaling of it up is invisible. The more blur, the smaller
 *  the picture, which is also the less there is to keep and to read at launch. */
export function sideFor(blur: number, screen: number): number {
  const wanted = Math.round((2 * screen) / Math.max(1, blur))
  return Math.min(LARGEST, Math.max(SMALLEST, wanted))
}

/** The size a picture of `width` by `height` is drawn at so that its longest side is
 *  `side`, never larger than it is. */
export function fitted(width: number, height: number, side: number): [number, number] {
  const scale = Math.min(1, side / Math.max(width, height, 1))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/** The widths of three boxes whose blur, one after another, is a Gaussian of `sigma`:
 *  the usual way to blur a picture in three passes that each cost the same whatever
 *  the radius. Odd, so each box has a middle. */
export function boxesFor(sigma: number): [number, number, number] {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) lower--
  const upper = lower + 2
  const many = Math.round(
    (12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4),
  )

  return [0, 1, 2].map((at) => (at < many ? lower : upper)) as [number, number, number]
}

/** One box along every row (or, with `columns`, every column), from `from` into `to`.
 *  The edge pixel stands in for whatever is past the edge, so the border of the
 *  picture is not darkened by a blur that reached into nothing. */
function box(
  from: Uint8ClampedArray,
  to: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  columns: boolean,
): void {
  const lines = columns ? width : height
  const length = columns ? height : width
  const stride = columns ? width * 4 : 4
  const span = radius * 2 + 1

  for (let line = 0; line < lines; line++) {
    const start = columns ? line * 4 : line * width * 4
    const at = (index: number) => start + Math.min(length - 1, Math.max(0, index)) * stride

    for (let channel = 0; channel < 3; channel++) {
      let sum = 0
      for (let index = -radius; index <= radius; index++) sum += from[at(index) + channel] ?? 0

      for (let index = 0; index < length; index++) {
        to[start + index * stride + channel] = sum / span
        sum +=
          (from[at(index + radius + 1) + channel] ?? 0) - (from[at(index - radius) + channel] ?? 0)
      }
    }

    for (let index = 0; index < length; index++) to[start + index * stride + 3] = 255
  }
}

/** The picture blurred by a Gaussian of `sigma` pixels, opaque, in a new array. */
export function blurred(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = Uint8ClampedArray.from(pixels)
  if (sigma <= 0) return out

  // Along the rows into the scratch and down the columns back, three times over.
  const scratch = new Uint8ClampedArray(pixels.length)
  for (const size of boxesFor(sigma)) {
    const radius = (size - 1) / 2
    box(out, scratch, width, height, radius, false)
    box(scratch, out, width, height, radius, true)
  }

  return out
}

/** What the picture holds: the least and the most of each channel (see `Span` in
 *  legibility.ts), and the average, which is the colour it reads as from across the
 *  room. */
export function measured(pixels: Uint8ClampedArray): Span & { mean: Rgb } {
  const least: [number, number, number] = [255, 255, 255]
  const most: [number, number, number] = [0, 0, 0]
  const sum: [number, number, number] = [0, 0, 0]
  const count = Math.max(1, Math.floor(pixels.length / 4))

  for (let at = 0; at < pixels.length; at += 4) {
    for (const channel of [0, 1, 2] as const) {
      const value = pixels[at + channel] ?? 0
      least[channel] = Math.min(least[channel], value)
      most[channel] = Math.max(most[channel], value)
      sum[channel] += value
    }
  }

  return { least, most, mean: [sum[0] / count, sum[1] / count, sum[2] / count] }
}
