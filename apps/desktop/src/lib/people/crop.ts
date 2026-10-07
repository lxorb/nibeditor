/** The arithmetic of the avatar sheet: a picture under a round window, dragged and
 *  zoomed, and the square of it that becomes the face.
 *
 *  The window is a square of `view` pixels with the circle inside it. At zoom 1 the
 *  picture's shorter side just fills the window, so there is never an empty corner; the
 *  zoom goes up from there to `MOST_ZOOM`. `offset` is where the picture's middle is,
 *  from the window's middle, in the window's pixels, and is held to what keeps the
 *  window covered. Turning is done to the picture before any of this, so the sizes here
 *  are the turned picture's. Pure, so the sheet's feel is a test. */

export interface Point {
  x: number
  y: number
}

export interface Crop {
  zoom: number
  offset: Point
}

/** Four times in: as far as anybody crops a face out of a group photo. */
export const MOST_ZOOM = 4

/** Window pixels per picture pixel at this zoom. */
export function scaleAt(width: number, height: number, view: number, zoom: number): number {
  return (zoom * view) / Math.min(width, height)
}

export function clampZoom(zoom: number): number {
  return Math.min(MOST_ZOOM, Math.max(1, zoom))
}

/** The offset nearest to `offset` that leaves no part of the window uncovered. */
export function clampOffset(
  offset: Point,
  width: number,
  height: number,
  view: number,
  zoom: number,
): Point {
  const scale = scaleAt(width, height, view, zoom)
  const spareX = Math.max(0, (width * scale - view) / 2)
  const spareY = Math.max(0, (height * scale - view) / 2)
  // Plus nothing, so a picture with no room to move sits at zero rather than at minus
  // zero, which is the same place and not the same number.
  return {
    x: Math.min(spareX, Math.max(-spareX, offset.x)) + 0,
    y: Math.min(spareY, Math.max(-spareY, offset.y)) + 0,
  }
}

/** A new zoom, keeping the point of the picture under `at` (from the window's middle)
 *  where it is: the wheel and a pinch zoom about the pointer, the slider about the
 *  middle. */
export function zoomed(
  crop: Crop,
  to: number,
  at: Point,
  width: number,
  height: number,
  view: number,
): Crop {
  const zoom = clampZoom(to)
  const ratio = zoom / crop.zoom
  const offset = {
    x: at.x - (at.x - crop.offset.x) * ratio,
    y: at.y - (at.y - crop.offset.y) * ratio,
  }
  return { zoom, offset: clampOffset(offset, width, height, view, zoom) }
}

/** The square of the picture, in its own pixels, that the window shows. */
export function sourceSquare(
  crop: Crop,
  width: number,
  height: number,
  view: number,
): { left: number; top: number; side: number } {
  const scale = scaleAt(width, height, view, crop.zoom)
  const side = view / scale
  const middleX = width / 2 - crop.offset.x / scale
  const middleY = height / 2 - crop.offset.y / scale
  return { left: middleX - side / 2, top: middleY - side / 2, side }
}

/** The picture's size once turned a quarter `turns` times. */
export function turned(width: number, height: number, turns: number): [number, number] {
  return turns % 2 === 0 ? [width, height] : [height, width]
}
