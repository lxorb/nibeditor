/** The canvas half of the wallpaper: a picture in, the app's copy of it and the small
 *  blurred picture the window wears out.
 *
 *  Done once when a picture is chosen and again when the Blur dial moves, never on a
 *  frame: what the window shows is a still picture a few hundred pixels across, laid
 *  under the chrome as a background, and nothing filters anything as the app is used.
 *  Vivaldi's blurred toolbars are a live `backdrop-filter` and its forum is full of
 *  them stuttering; this is the opposite trade. The sums are pixels.ts and floors.ts. */

import { hexOf, over, type Rgb } from '../legibility'
import type { Held, Side } from './held'
import { floorFor, type Palette } from './floors'
import { blurred, fitted, LARGEST, measured, sideFor } from './pixels'

/** The longest side of the copy that is kept: twice the most the blurred picture is
 *  ever made at, which is what a good downscale needs and no more. */
const COPY = LARGEST * 2

/** Something a canvas can draw, with its size. */
interface Drawable {
  image: CanvasImageSource
  width: number
  height: number
}

/** A picture's bytes, decoded. The platform's own decoder - which turns a photograph
 *  the right way up from what its camera wrote - and an `<img>` for what that will
 *  not take, which in Chromium is an SVG. */
export async function decode(picture: Blob): Promise<Drawable> {
  try {
    const bitmap = await createImageBitmap(picture)
    return { image: bitmap, width: bitmap.width, height: bitmap.height }
  } catch {
    const address = URL.createObjectURL(picture)
    try {
      const image = new Image()
      image.src = address
      await image.decode()
      return { image, width: image.naturalWidth, height: image.naturalHeight }
    } finally {
      URL.revokeObjectURL(address)
    }
  }
}

/** A canvas holding the picture at `width` by `height`, smoothed as well as the
 *  platform smooths. Opaque: a picture with holes in it is drawn over black, which is
 *  what a window behind it would be. */
function drawn(source: Drawable, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('this window cannot draw a picture')

  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.image, 0, 0, width, height)
  return { canvas, context }
}

/** The app's copy: no larger than any blur needs, as a JPEG, which a picture that is
 *  only ever seen blurred loses nothing to. */
export async function copyOf(source: Drawable): Promise<Blob> {
  const [width, height] = fitted(source.width, source.height, COPY)
  const { canvas } = drawn(source, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the picture could not be copied'))),
      'image/jpeg',
      0.9,
    )
  })
}

/** One side's floor and the colour the window comes to under it. */
function sideOf(palette: Palette, span: Parameters<typeof floorFor>[1], mean: Rgb): Side {
  const floor = floorFor(palette, span)
  return { floor, ground: hexOf(over(palette.scrim, floor, mean)) }
}

/** The blurred picture for a blur of `blur` CSS pixels on a screen whose longest side
 *  is `screen`, and both sides' floors over it.
 *
 *  Kept as a PNG: it is stretched several times over to cover the window, and a
 *  JPEG's eight-pixel blocks stretched that far are bands across the frame. Blurred,
 *  a few hundred pixels across, it comes to tens of kilobytes. */
export function made(
  source: Drawable,
  blur: number,
  screen: number,
  palettes: { dark: Palette; light: Palette },
): Held {
  const side = sideFor(blur, screen)
  const [width, height] = fitted(source.width, source.height, side)
  const { canvas, context } = drawn(source, width, height)

  // The blur in the picture's own pixels: the dial is in the window's, and the
  // picture's longest side is stretched over the screen's.
  const sigma = (blur * Math.max(width, height)) / Math.max(1, screen)
  const pixels = blurred(context.getImageData(0, 0, width, height).data, width, height, sigma)
  context.putImageData(new ImageData(pixels, width, height), 0, 0)

  const { least, most, mean } = measured(pixels)
  return {
    picture: canvas.toDataURL('image/png'),
    blur,
    dark: sideOf(palettes.dark, { least, most }, mean),
    light: sideOf(palettes.light, { least, most }, mean),
  }
}
