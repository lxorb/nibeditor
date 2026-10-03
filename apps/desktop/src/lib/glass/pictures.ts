/** A picture's pixels, small: what colours.ts counts a mark's or a page's colour from.
 *
 *  Drawn once into a canvas a few dozen pixels across, so a favicon, a cover and the
 *  top of a page's still cost the same handful of pixels to count whatever their size.
 *  Asked when something is opened or lands, never as the window is used. A picture the
 *  window may not read - another origin that did not allow it - is no answer rather than
 *  an error: the colour falls back to the next source. */

/** The part of a picture to read: all of it, or a band along its top. */
export interface Part {
  /** How many of the picture's own rows from the top, or the whole height. */
  rows?: number
  /** The size it is counted at. */
  width: number
  height: number
}

/** The picture at `src` drawn at the size `part` asks for, as RGBA bytes; null where it
 *  will not load or may not be read. */
export async function pixelsOf(src: string, part: Part): Promise<Uint8ClampedArray | null> {
  const picture = new Image()
  // Asked for as the asset protocol and a site's own mark allow it to be read; a
  // `data:` address is the window's own whatever this says.
  picture.crossOrigin = 'anonymous'
  picture.decoding = 'async'
  picture.src = src

  try {
    await picture.decode()
  } catch {
    return null
  }

  const width = picture.naturalWidth
  const height = picture.naturalHeight
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = part.width
  canvas.height = part.height
  const paint = canvas.getContext('2d', { willReadFrequently: true })
  if (!paint) return null

  const rows = Math.min(height, part.rows ?? height)
  paint.drawImage(picture, 0, 0, width, rows, 0, 0, part.width, part.height)
  try {
    return paint.getImageData(0, 0, part.width, part.height).data
  } catch {
    // A picture from somewhere that did not say it may be read: the canvas is tainted.
    return null
  }
}
