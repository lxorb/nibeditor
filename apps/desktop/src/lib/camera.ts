/** Where a plane is being looked at from, and what is under the pointer.
 *
 *  One transform, in one place: the paint, the pointer and the hit test all read
 *  it, so a click cannot land somewhere other than where the thing is drawn. The
 *  camera says which point of the plane is at the middle of the view and how many
 *  pixels a unit of the plane is worth.
 *
 *  Two surfaces read it. The graph draws itself on a 2d context and applies the
 *  camera per node; the canvas puts its nodes in the page and applies it once, as
 *  one css transform. Neither knows anything about the other, and the arithmetic
 *  they agree on is here. */

export interface Camera {
  /** The point of the plane the middle of the view is on. */
  x: number
  y: number
  /** Pixels per unit of the plane. */
  scale: number
}

/** How far in and out the view goes. Far enough out that a space of thousands of
 *  notes fits, far enough in to read one name at a comfortable size. */
export const CLOSEST = 4
export const FURTHEST = 0.04

/** How small a node may get on screen however far out the view is, so a distant
 *  note is still a dot rather than nothing. */
export const SMALLEST_DOT = 1.1

export function clampScale(scale: number): number {
  return Math.min(CLOSEST, Math.max(FURTHEST, scale))
}

/** One notch of a zoom: what a button on the bar steps by, and what one notch of a
 *  wheel held with Ctrl comes to.
 *
 *  One number, here, because a reader who zooms with the buttons and then with the
 *  wheel is zooming the same paper: the bar's own comment already said the two
 *  agree, and they did not - the buttons stepped by a fifth, the plane's wheel by
 *  two fifths and a page note's by a quarter. */
export const NOTCH = 1.2

/** What a wheel does to the scale.
 *
 *  Ctrl and the wheel is a zoom on every platform, and so is a trackpad pinch,
 *  which arrives as exactly that. A notch of a real wheel is a hundred pixels of
 *  delta, so that is what `NOTCH` is spelled against; a trackpad sends dozens of
 *  small ones and they multiply up to the same thing over the same distance, which
 *  is the whole reason this is an exponential rather than a step. */
export function wheelZoom(deltaY: number): number {
  return Math.exp((-deltaY / 100) * Math.log(NOTCH))
}

/** The point of the plane a screen point is over. */
export function graphPoint(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - width / 2) / camera.scale + camera.x,
    y: (screenY - height / 2) / camera.scale + camera.y,
  }
}

/** A camera that puts a rectangle of the plane in view with `padding` pixels to
 *  spare. Something small enough to fit at its natural size is not blown up to
 *  fill the view: it would read as a balloon.
 *
 *  Takes the rectangle rather than the things in it, so the two surfaces can each
 *  work out their own extent: a graph node is a point, a canvas node is a box. */
export function framingBox(
  box: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  padding: number,
): Camera {
  if (width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  const across = Math.max(box.width, 1)
  const down = Math.max(box.height, 1)
  const room = Math.min(
    (width - 2 * padding) / across,
    (height - 2 * padding) / down,
    // One pixel per unit is as close as framing goes; getting closer is the
    // reader's business.
    1,
  )

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    scale: clampScale(room),
  }
}

/** A camera that frames every point with `padding` pixels to spare.
 *
 *  `shown` leaves out the points that are not being drawn - a graph narrowed by a
 *  filter frames what it is showing rather than the space it came out of - and an
 *  empty answer falls back to framing the lot, since a view with nothing in it has
 *  nothing to be about. */
export function framing(
  x: Float64Array,
  y: Float64Array,
  count: number,
  width: number,
  height: number,
  padding: number,
  shown?: Uint8Array,
): Camera {
  if (count === 0 || width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  let least = Infinity
  let most = -Infinity
  let lowest = Infinity
  let highest = -Infinity
  let found = 0

  for (let one = 0; one < count; one++) {
    if (shown && !shown[one]) continue

    found++
    const px = x[one] ?? 0
    const py = y[one] ?? 0
    if (px < least) least = px
    if (px > most) most = px
    if (py < lowest) lowest = py
    if (py > highest) highest = py
  }

  if (found === 0)
    return shown ? framing(x, y, count, width, height, padding) : { x: 0, y: 0, scale: 1 }

  return framingBox(
    { x: least, y: lowest, width: most - least, height: highest - lowest },
    width,
    height,
    padding,
  )
}

/** The camera after a scroll at a point, which keeps whatever was under the
 *  pointer under it. */
export function zoomed(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  by: number,
): Camera {
  const scale = clampScale(camera.scale * by)
  const under = graphPoint(camera, width, height, screenX, screenY)

  return {
    x: under.x - (screenX - width / 2) / scale,
    y: under.y - (screenY - height / 2) / scale,
    scale,
  }
}

/** Which node a screen point is on, or -1 for none. The nearest one whose drawn
 *  circle the point falls in, with `slack` pixels of forgiveness so a small dot
 *  can still be hit by a hand rather than a machine. */
export function nodeAt(
  x: Float64Array,
  y: Float64Array,
  radii: Float64Array,
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  slack = 3,
): number {
  const count = Math.min(x.length, y.length, radii.length)
  let found = -1
  let nearest = Infinity

  for (let one = 0; one < count; one++) {
    const dx = ((x[one] ?? 0) - camera.x) * camera.scale + width / 2 - screenX
    const dy = ((y[one] ?? 0) - camera.y) * camera.scale + height / 2 - screenY
    const away = Math.sqrt(dx * dx + dy * dy)
    const reach = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * camera.scale) + slack

    if (away > reach || away > nearest) continue
    nearest = away
    found = one
  }

  return found
}
