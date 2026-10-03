/** The canvas half of the wallpaper: a picture in, the app's copy of it and the pictures
 *  the window wears out.
 *
 *  Done when a picture is chosen and again when a dial that is baked into it moves - the
 *  blur, the saturation, the tint - never on a frame: what the window shows is a still
 *  picture laid under the chrome as a background, and nothing filters anything as the
 *  app is used. Vivaldi's blurred toolbars are a live `backdrop-filter` and its forum is
 *  full of them stuttering; this is the opposite trade. The sums are pixels.ts.
 *
 *  Two pictures for a light blur. The kept one is at most `LARGEST` pixels across, which
 *  is everything there is to see once the blur is a few pixels or more, and is what the
 *  first frame of a launch wears. Under that (`sharpBelow`) the window also wears a copy
 *  at the screen's own size, made from the app's copy once the app is up and laid over
 *  the small one: a sharp picture, at the cost of one picture's making per change. */

import { hexOf, type Rgb, rgbOf, type Span } from '../legibility'
import type { Held } from './held'
import { blurred, fitted, measured, sideFor, toned, type Toning } from './pixels'

/** The longest side of the copy that is kept: a large screen's own, so a picture with
 *  no blur at all is still sharp, and no more. */
const COPY = 3200

/** Something a canvas can draw, with its size. */
export interface Drawable {
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
 *  platform smooths, and blurred by `filter` on the way in where one is given. Opaque:
 *  a picture with holes in it is drawn over black, which is what a window behind it
 *  would be. */
function drawn(source: Drawable, width: number, height: number, blur = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('this window cannot draw a picture')

  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (blur > 0) {
    // Drawn past the edges by three blurs, so the blur has picture to reach into
    // there rather than the black underneath.
    const margin = Math.ceil(blur * 3)
    context.filter = `blur(${blur.toFixed(2)}px)`
    context.drawImage(source.image, -margin, -margin, width + margin * 2, height + margin * 2)
    context.filter = 'none'
  } else {
    context.drawImage(source.image, 0, 0, width, height)
  }
  return { canvas, context }
}

/** The app's copy: a large screen's size at most, as a JPEG, which a picture seen
 *  behind a scrim loses nothing to. */
export async function copyOf(source: Drawable): Promise<Blob> {
  const [width, height] = fitted(source.width, source.height, COPY)
  const { canvas } = drawn(source, width, height)
  return blobOf(canvas, 'image/jpeg', 0.9)
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the picture could not be copied'))),
      type,
      quality,
    )
  })
}

/** The tone a dial asks for, with its colour as channels. */
export interface Tone {
  saturation: number
  tint: number
  colour: string
}

function toningOf(tone: Tone): Toning {
  return {
    saturation: tone.saturation,
    tint: tone.tint,
    colour: rgbOf(tone.colour) ?? ([0, 0, 0] as Rgb),
  }
}

/** The tone as one word, so a picture made at it can tell whether a dial moved. */
export function toneKey(tone: Tone): string {
  // No tint is no colour, so a new accent leaves an untinted picture as it is.
  const colour = tone.tint > 0 ? tone.colour : ''
  return `${tone.saturation.toFixed(2)} ${tone.tint.toFixed(2)} ${colour}`
}

/** What a picture holds, as the record keeps it. */
function heldColours(pixels: Uint8ClampedArray): { span: Span; mean: string } {
  const { least, most, mean } = measured(pixels)
  return { span: { least, most }, mean: hexOf(mean) }
}

/** The kept picture, for a blur of `blur` CSS pixels on a screen whose longest side is
 *  `screen`, toned as asked; and what it holds.
 *
 *  Kept as a PNG: it is stretched several times over to cover the window, and a JPEG's
 *  eight-pixel blocks stretched that far are bands across the frame. Blurred, a few
 *  hundred pixels across, it comes to tens of kilobytes. */
export function made(
  source: Drawable,
  blur: number,
  tone: Tone,
  screen: number,
  focus: [number, number],
  size: [number, number],
): Held {
  const side = sideFor(blur, screen)
  const [width, height] = fitted(source.width, source.height, side)
  const { canvas, context } = drawn(source, width, height)

  // The blur in the picture's own pixels: the dial is in the window's, and the
  // picture's longest side is stretched over the screen's.
  const sigma = (blur * Math.max(width, height)) / Math.max(1, screen)
  const pixels = blurred(context.getImageData(0, 0, width, height).data, width, height, sigma)
  toned(pixels, toningOf(tone))
  context.putImageData(new ImageData(pixels, width, height), 0, 0)

  return {
    picture: canvas.toDataURL('image/png'),
    blur,
    tone: toneKey(tone),
    ...heldColours(pixels),
    size,
    focus,
  }
}

/** The copy at the screen's own size, for a blur too light for the kept picture: as a
 *  picture the window can be handed, and what it holds, which is what the floors are
 *  worked out from - a sharp picture's darkest and lightest pixels are further apart
 *  than its blurred one's. `longest` is how many pixels across it is made, the screen's
 *  while it is kept and fewer while a dial is moving. */
export async function sharp(
  source: Drawable,
  blur: number,
  tone: Tone,
  screen: number,
  longest: number,
): Promise<{ picture: Blob; span: Span; mean: string }> {
  const [width, height] = fitted(source.width, source.height, longest)
  const sigma = (blur * Math.max(width, height)) / Math.max(1, screen)
  const { canvas, context } = drawn(source, width, height, sigma)
  const image = context.getImageData(0, 0, width, height)
  toned(image.data, toningOf(tone))
  context.putImageData(image, 0, 0)

  return { picture: await blobOf(canvas, 'image/jpeg', 0.92), ...heldColours(image.data) }
}
