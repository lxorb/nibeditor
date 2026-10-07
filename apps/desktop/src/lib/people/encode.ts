/** A picture made into a face: decoded the right way up, cropped to the square the sheet
 *  shows, drawn at the two sizes a face is kept at, and encoded small, with nothing in
 *  the bytes but pixels.
 *
 *  Nothing a camera wrote goes with it. Decoding to a canvas and encoding the canvas
 *  keeps the pixels and drops everything else: where it was taken, on what, when. The
 *  bytes are still looked through before they leave (`carriesMetadata`), because the
 *  only promise worth making about somebody's location is one that is checked. WebP
 *  where the engine can write it; WebKit's canvas cannot, so there it is a JPEG, which
 *  the service takes as well. See docs/chats.md 4.9. */

import { key } from '../i18n.svelte'
import { sourceSquare, turned, type Crop } from './crop'

/** The two sizes: every row a person is in, and their card. */
const SMALL = 96
const LARGE = 512
/** What either may weigh at most; the service holds it to the same. */
const MOST_BYTES = 100 * 1024
/** As much of a picture as is kept to crop from: a face never needs a 6,000 pixel photo,
 *  and a canvas that size is a hundred megabytes. */
const LONGEST = 2048

export interface Encoded {
  bytes: ArrayBuffer
  type: 'image/webp' | 'image/jpeg'
}

/** A file somebody chose, dropped, pasted or took, decoded the right way up. */
export function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/** The picture turned a quarter `turns` times and made no larger than `LONGEST`: what
 *  the sheet shows and crops from. */
export function prepared(picture: ImageBitmap, turns: number): HTMLCanvasElement {
  const shrink = Math.min(1, LONGEST / Math.max(picture.width, picture.height))
  const width = Math.round(picture.width * shrink)
  const height = Math.round(picture.height * shrink)
  const [outWidth, outHeight] = turned(width, height, turns)

  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.translate(outWidth / 2, outHeight / 2)
  context.rotate((turns % 4) * (Math.PI / 2))
  context.drawImage(picture, -width / 2, -height / 2, width, height)
  return canvas
}

/** Both sizes of the face the window shows. */
export async function faceFrom(
  picture: HTMLCanvasElement,
  crop: Crop,
  view: number,
): Promise<{ s: Encoded; l: Encoded }> {
  const square = sourceSquare(crop, picture.width, picture.height, view)
  const [s, l] = await Promise.all(
    [SMALL, LARGE].map((size) => encodedSmall(drawn(picture, square, size))),
  )
  if (!s || !l) throw new Error('no picture')
  return { s, l }
}

function drawn(
  picture: HTMLCanvasElement,
  square: { left: number; top: number; side: number },
  size: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(picture, square.left, square.top, square.side, square.side, 0, 0, size, size)
  return canvas
}

/** The canvas as the smallest good picture under the ceiling: WebP, or JPEG where the
 *  engine cannot write WebP, a step of quality down at a time. */
async function encodedSmall(canvas: HTMLCanvasElement): Promise<Encoded> {
  for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
    const webp = await blobOf(canvas, 'image/webp', quality)
    const kept = webp?.type === 'image/webp' ? webp : await blobOf(canvas, 'image/jpeg', quality)
    if (!kept) break
    const bytes = await kept.arrayBuffer()
    if (bytes.byteLength > MOST_BYTES) continue
    if (carriesMetadata(new Uint8Array(bytes))) throw new Error('a picture kept its metadata')
    return { bytes, type: kept.type === 'image/webp' ? 'image/webp' : 'image/jpeg' }
  }
  throw new Error(key('that picture is too big'))
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((done) => {
    canvas.toBlob(done, type, quality)
  })
}

/** Whether a WebP or JPEG carries anything but pixels: EXIF or XMP in a WebP's chunks,
 *  an APP1 segment (EXIF, XMP) in a JPEG's. Anything else is not a face this app made. */
export function carriesMetadata(bytes: Uint8Array): boolean {
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length))

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const name = ascii(at, 4)
      if (name === 'EXIF' || name === 'XMP ') return true
      const size =
        (bytes[at + 4] ?? 0) |
        ((bytes[at + 5] ?? 0) << 8) |
        ((bytes[at + 6] ?? 0) << 16) |
        ((bytes[at + 7] ?? 0) << 24)
      at += 8 + size + (size % 2)
    }
    return false
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
      const marker = bytes[at + 1] ?? 0
      // Start of scan: what follows is the picture itself.
      if (marker === 0xda) return false
      if (marker === 0xe1) return true
      at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
    }
    return false
  }

  return true
}
