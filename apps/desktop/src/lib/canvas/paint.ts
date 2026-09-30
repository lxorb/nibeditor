/** Ink, painted.
 *
 *  Two layers, and the split is the whole trick. The strokes already on the
 *  plane are drawn on the lower one, which is put together out of tiles of pixels
 *  kept between repaints (see tiles.ts); the stroke under the pen is drawn on the
 *  upper one, which is cleared and redrawn on every pointer event and holds exactly
 *  one stroke. So the cost of a pen event is one stroke's outline, whether the
 *  plane carries five strokes or five thousand, and the first pixel lands in the
 *  same frame as the event rather than after a repaint of everything.
 *
 *  A stroke's outline is worked out once and kept as a `Path2D` in plane
 *  coordinates, so panning and zooming are a transform on the context and not a
 *  recalculation of anything. The cache is keyed on the stroke object itself:
 *  every edit hands back new objects for what it touched and the very same ones
 *  for what it did not, so the cache invalidates itself and never goes stale.
 *
 *  What is here is the paint itself - an outline, a kind of ink, a fill - for the
 *  tiles, for the stroke under the pen and for a thumbnail alike, so there is one
 *  picture of a stroke wherever it is drawn. */

import type { Camera } from '../camera'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { INK_STYLES, inkOpacity, outlineOf, strokeBox, traceInk } from './ink'

/** Either kind of 2d context: the one on the page and the one a tile is drawn on. */
export type Paintable = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Outlines already worked out. Weak, so a stroke that has been erased takes its
 *  path with it without anybody sweeping up. */
const paths = new WeakMap<InkStroke, Path2D>()

/** The path a stroke paints as, in plane coordinates. */
export function pathOf(stroke: InkStroke, finished = true): Path2D {
  const held = finished ? paths.get(stroke) : undefined
  if (held) return held

  const path = new Path2D()
  traceInk(outlineOf(stroke, finished), path)

  if (finished) paths.set(stroke, path)
  return path
}

/** Whether a stroke's outline has been worked out already, which is the half of
 *  painting it that costs: a tile holding strokes nobody has outlined yet is a tile
 *  that waits for them. See `OUTLINE_WEIGHT` in tiles.ts. */
export function outlined(stroke: InkStroke): boolean {
  return paths.has(stroke)
}

/** A speckled fill, one per colour, so a pencil leaves a grain rather than a
 *  solid body. Built once at a fixed size and repeated: a pattern is one fill
 *  however long the stroke is. */
const grains = new Map<string, CanvasPattern | null>()

const GRAIN = 64

function grainOf(ctx: Paintable, colour: string): CanvasPattern | null {
  const held = grains.get(colour)
  if (held !== undefined) return held

  const tile = document.createElement('canvas')
  tile.width = GRAIN
  tile.height = GRAIN
  const paint = tile.getContext('2d')

  if (!paint) {
    grains.set(colour, null)
    return null
  }

  paint.fillStyle = colour
  // A field of dots at uneven weights, which is what graphite on paper is: the
  // tooth of the paper takes the lead in some places and not in others. Dense
  // enough to read as a line rather than as a dotted one, and never solid.
  for (let one = 0; one < GRAIN * GRAIN * 0.62; one++) {
    paint.globalAlpha = 0.35 + Math.random() * 0.65
    paint.fillRect(Math.random() * GRAIN, Math.random() * GRAIN, 1, 1)
  }

  const pattern = ctx.createPattern(tile, 'repeat')
  grains.set(colour, pattern)
  return pattern
}

/** What a canvas colour is on screen. The six presets are tokens, so the theme
 *  says what they are; anything else is a colour already. */
export type Palette = Record<string, string>

/** What a stroke's colour is on screen and in a picture: the theme's answer for a
 *  name the palette holds, and the colour itself for anything else.
 *
 *  Asked of the palette's own keys and never of what every object inherits, so a
 *  file that wrote `"toString"` where a colour goes is a colour nothing can draw
 *  rather than a function turned into a string. */
export function inkColour(colour: string, palette: Palette): string {
  return Object.hasOwn(palette, colour) ? (palette[colour] ?? colour) : colour
}

export interface View {
  camera: Camera
  width: number
  height: number
  /** Device pixels per CSS pixel. */
  ratio: number
}

/** Where the plane's origin lands on a layer, in whole device pixels.
 *
 *  Whole, because the tiles are: a tile is drawn onto the layer at a whole pixel so
 *  that it is copied rather than resampled, and a copy is the same pixels the tile
 *  holds while a resample is those pixels half a pixel blurred. The stroke under
 *  the pen is placed by the same rounding, so it does not move by that half pixel
 *  as it lands. */
export function origin(view: View): { x: number; y: number } {
  const { camera, width, height, ratio } = view
  return {
    x: Math.round((width / 2 - camera.x * camera.scale) * ratio),
    y: Math.round((height / 2 - camera.y * camera.scale) * ratio),
  }
}

/** Puts the plane's coordinates on the context, so everything drawn after is
 *  drawn in the units the file is written in. */
function place(ctx: Paintable, view: View) {
  const scale = view.camera.scale * view.ratio
  const at = origin(view)
  ctx.setTransform(scale, 0, 0, scale, at.x, at.y)
}

/** The part of the plane on screen, in plane units. */
export function seen(view: View): Box {
  const { camera, width, height } = view
  return {
    x: camera.x - width / 2 / camera.scale,
    y: camera.y - height / 2 / camera.scale,
    width: width / camera.scale,
    height: height / camera.scale,
  }
}

function meets(box: Box, other: Box): boolean {
  return (
    box.x < other.x + other.width &&
    other.x < box.x + box.width &&
    box.y < other.y + other.height &&
    other.y < box.y + box.height
  )
}

/** The context set to draw in one kind of ink: how translucent it is, how it
 *  sits on what is under it, and whether it has a grain. */
function inkStyle(ctx: Paintable, stroke: InkStroke, palette: Palette) {
  const style = INK_STYLES[stroke.tool]
  const colour = inkColour(stroke.color, palette)

  ctx.globalAlpha = inkOpacity(stroke)
  ctx.globalCompositeOperation = style.multiply ? 'multiply' : 'source-over'

  if (style.grain) {
    const grain = grainOf(ctx, colour)
    // The pattern is in the plane's units, because the context is when it is
    // filled, so it is pinned to the plane rather than to the screen: a grain that
    // swam about while panning would read as fog. Every tile is placed on the same
    // plane, so the grain runs on across their edges.
    ctx.fillStyle = grain ?? colour
  } else {
    ctx.fillStyle = colour
  }
}

/** The context back to drawing plainly, which is what the next thing drawn on it
 *  assumes. */
export function plain(ctx: Paintable) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

/** A layer wiped back to nothing.
 *
 *  Said out loud rather than left to whatever the layer was made with, and from
 *  a known state, because the ink before it may have been laid down through a
 *  blend. On a backing that kept no alpha this would leave opaque black instead
 *  of nothing, which is the trouble `backing.ts` goes to in order never to hand
 *  one over. */
export function wipe(ctx: Paintable, width: number, height: number) {
  plain(ctx)
  ctx.clearRect(0, 0, width, height)
}

/** Which strokes can share one fill: the same tool, the same colour and the same
 *  alpha. The alpha is part of it: two strokes at different opacities cannot share
 *  a fill without one of them coming out at the other's. */
const kinds = new WeakMap<InkStroke, string>()

export function inkKind(stroke: InkStroke): string {
  const held = kinds.get(stroke)
  if (held !== undefined) return held

  const kind = `${stroke.tool}
${stroke.color}
${inkOpacity(stroke)}`
  kinds.set(stroke, kind)
  return kind
}

let filled = 0

/** How many strokes have been filled, ever - a running total, read as a
 *  difference either side of whatever is being asked about.
 *
 *  Counted rather than timed, for the reason fuzzy.ts gives beside its own
 *  counters: a clock says what the machine was doing and a count says what the
 *  code did. A stroke on a tile is one; the same stroke on the tile beside it is
 *  another, because it is painted there as well. That a pan over a plane of ten
 *  thousand strokes fills none of them is the whole of tiles.ts, and it is asserted
 *  in tiles.test.ts. */
export function strokesFilled(): number {
  return filled
}

/** Strokes filled in as few fills as there are kinds of ink among them.
 *
 *  Strokes drawn in the same tool and the same colour are one shape as far as the
 *  paint is concerned, so they go into one path and are filled once. A page of
 *  five thousand strokes is then forty fills rather than five thousand, and the
 *  state changes between them - the alpha, the blend, the grain - happen forty
 *  times rather than five thousand.
 *
 *  It changes one thing, and for the better: two passes of a highlighter over one
 *  word are one shape and darken once, which is what a highlighter does on paper.
 *
 *  The kinds are filled in the order `rank` gives them, lowest first. A tile asks
 *  with the order the kinds first appear in on the whole plane, so a highlighter
 *  that crosses from one tile into the next sits over the same ink in both. */
export function fillInk(
  ctx: Paintable,
  strokes: Iterable<InkStroke>,
  palette: Palette,
  rank: (kind: string) => number,
) {
  const batches = new Map<string, { stroke: InkStroke; path: Path2D }>()

  for (const stroke of strokes) {
    const kind = inkKind(stroke)
    const batch = batches.get(kind)

    if (batch) batch.path.addPath(pathOf(stroke))
    else {
      const path = new Path2D()
      path.addPath(pathOf(stroke))
      batches.set(kind, { stroke, path })
    }

    filled++
  }

  const order = [...batches].sort(([one], [other]) => rank(one) - rank(other))
  for (const [, batch] of order) {
    inkStyle(ctx, batch.stroke, palette)
    ctx.fill(batch.path, 'nonzero')
  }
}

/** The order kinds of ink first appear in, which is the order a plane paints them
 *  in. Anything not in it goes last. */
export function firstSeen(strokes: readonly InkStroke[]): Map<string, number> {
  const order = new Map<string, number>()
  for (const stroke of strokes) {
    const kind = inkKind(stroke)
    if (!order.has(kind)) order.set(kind, order.size)
  }

  return order
}

/** A halo in the accent round every picked stroke on the layer, so a picked stroke
 *  is still the colour it was written in. Drawn over the tiles rather than into
 *  them: what is picked changes far more often than what is written. */
export function paintPicked(
  ctx: Paintable,
  strokes: readonly InkStroke[],
  picked: ReadonlySet<string>,
  view: View,
  palette: Palette,
) {
  if (!picked.size) return

  const box = seen(view)
  place(ctx, view)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = palette.accent ?? '#4c6ef5'
  ctx.lineWidth = 1.5 / view.camera.scale

  for (const stroke of strokes) {
    if (picked.has(stroke.id) && meets(strokeBox(stroke), box)) ctx.stroke(pathOf(stroke))
  }

  plain(ctx)
}

/** The ink in view, painted whole in one go, for a picture that is drawn once: a
 *  page's thumbnail. The surface itself never paints this way; see tiles.ts. */
export function paintInk(
  ctx: Paintable,
  strokes: readonly InkStroke[],
  view: View,
  palette: Palette,
) {
  wipe(ctx, view.width * view.ratio, view.height * view.ratio)
  place(ctx, view)

  const box = seen(view)
  const order = firstSeen(strokes)
  fillInk(
    ctx,
    strokes.filter((stroke) => meets(strokeBox(stroke), box)),
    palette,
    (kind) => order.get(kind) ?? order.size,
  )

  plain(ctx)
}

/** The one stroke under the pen, on its own layer. Cleared and redrawn on every
 *  event, which is cheap because it is one stroke. */
export function paintLive(ctx: Paintable, stroke: InkStroke | null, view: View, palette: Palette) {
  wipe(ctx, view.width * view.ratio, view.height * view.ratio)
  if (!stroke) return

  place(ctx, view)
  inkStyle(ctx, stroke, palette)
  ctx.fill(pathOf(stroke, false), 'nonzero')
  plain(ctx)
}
