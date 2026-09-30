/** The ink on the plane as square tiles of pixels, kept between repaints.
 *
 *  What the lower ink layer shows is put together out of these, the way a map is:
 *  a repaint is the tiles copied onto the layer where the camera now puts them. So
 *  a pan over a plane of ten thousand strokes fills nothing at all. Before these,
 *  every repaint filled every stroke in view: about four hundred milliseconds a
 *  frame on a plane of ten thousand seen whole, growing as the plane arrived,
 *  because the plane was one path and a path is filled whole or not at all.
 *
 *  An edit repaints only the pixels it changed. A stroke drawn, rubbed out or moved
 *  marks the rectangle it covers on each tile it crosses, and the rectangle is
 *  cleared and filled again with the strokes that reach into it, clipped to it. On
 *  whole pixels that is exactly what painting the tile afresh would leave there -
 *  two passes of a highlighter still darken once - and it costs the strokes near the
 *  edit rather than the strokes on the tile: a tile of a plane seen whole holds a
 *  couple of thousand.
 *
 *  Figma paints its documents in tiles, and for the same reason: a picture that is
 *  zoomed and panned far more often than it is changed is cheaper kept as pixels
 *  than drawn again. What this takes from maps is the rest - the tiles in view
 *  first, from the middle out, and the old picture under the new one while the new
 *  one is arriving, so a zoom sharpens rather than blinks.
 *
 *  One scale at a time. A tile is the plane at exactly the scale it is shown at, so
 *  the ink is as sharp at rest as it was drawn; a zoom that settles somewhere new
 *  paints that scale afresh, a frame's budget at a time, over the old picture drawn
 *  larger or smaller. Tiles nobody has looked at for a while are let go, so the
 *  pixels kept are a couple of screens' worth whatever the size of the plane. */

import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'
import { InkGrid } from './ink-grid'
import {
  fillInk,
  firstSeen,
  inkKind,
  origin,
  outlined,
  type Paintable,
  paintPicked,
  type Palette,
  pathOf,
  plain,
  seen,
  type View,
  wipe,
} from './paint'

/** How wide a tile is, in device pixels. Small enough that the pixels kept off
 *  screen are a ring round it rather than another screen; big enough that a screen
 *  is a hundred tiles to copy and not a thousand. */
export const TILE = 256

/** How much one frame does before it leaves the rest for the next, counted in
 *  strokes filled: about twenty milliseconds of it on the machine this was measured
 *  on, with the frame's own drawing still to come. A tile with more than this on it
 *  is still painted whole, on a frame of its own. A count rather than a deadline
 *  because what this is worth is asserted by counting it; see tiles.test.ts. */
export const FILLED_A_FRAME = 2048

/** What working out one stroke's outline costs, in strokes filled: a tenth of a
 *  millisecond against a hundredth, measured over a plane of ten thousand opening.
 *  A plane opened for the first time has no outline worked out, and ten thousand of
 *  them were a second in one task before a single card was on screen - so they are
 *  worked out a slice of the same budget at a time, and a tile waits until
 *  everything on it has one. Out of one budget rather than two, because two let a
 *  frame spend both: sixty to ninety milliseconds, where either alone is twenty. */
export const OUTLINE_WEIGHT = 8

/** How many tiles are kept, as a multiple of the tiles the layer shows: the screen
 *  and about as much again around it, so panning back is a copy and not a fill. */
const KEPT = 2

/** How many separate rectangles a tile keeps to repair before they are one: a rub
 *  marks one a move, and past a handful the strokes under their bounds are fewer
 *  fills than the strokes under each. */
const MOST_PATCHES = 8

/** Something a tile is painted on and copied off. */
export interface Surface {
  image: CanvasImageSource
  context: Paintable
}

export type MakeSurface = (size: number) => Surface | null

/** A canvas of its own for a tile, or none where there is no document to make one
 *  in. */
function makeSurface(size: number): Surface | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  return context ? { image: canvas, context } : null
}

/** A rectangle of a tile, in its own whole device pixels: the left and top edges
 *  in it, the right and bottom ones not. */
interface Patch {
  left: number
  top: number
  right: number
  bottom: number
}

interface Tile {
  across: number
  down: number
  /** Nothing for a tile with no ink on it, which needs no pixels at all. */
  surface: Surface | null
  /** Painted under a theme or an order of inks that no longer holds, and due to be
   *  painted again whole. Worth showing until then. */
  stale: boolean
  /** Where it shows something that is no longer so: a stroke taken away, or put
   *  down, since it was painted. */
  patches: Patch[]
  /** Strokes put down since it was painted. Laid over it on a frame that cannot
   *  repair it yet, so a stroke is on the layer the moment it is drawn. */
  adds: InkStroke[]
  /** The repaint it was last on the layer in, for letting the oldest go. */
  used: number
}

/** Where the picture on the layer was painted from: the scale, the origin in whole
 *  device pixels, and the layer's size. */
interface Painted {
  scale: number
  x: number
  y: number
  width: number
  height: number
}

/** Which tile: how many tiles across and down from the plane's origin. */
interface Spot {
  across: number
  down: number
}

/** A tile's two numbers as one key, the way ink-grid.ts files its cells. */
const SPAN = 2 ** 21
const HALF = 2 ** 20

function keyOf(across: number, down: number): number {
  return (across + HALF) * SPAN + (down + HALF)
}

/** Whether `now` is `was` with something added on the end - the same strokes, by
 *  identity, and then more. Which is what drawing one is, and what a room
 *  delivering one is. A walk of references, which is nothing beside the sets a
 *  change of any other kind is worked out with. */
function grewFrom(was: readonly InkStroke[], now: readonly InkStroke[]): boolean {
  if (now.length < was.length) return false
  for (let one = 0; one < was.length; one++) if (was[one] !== now[one]) return false

  return true
}

/** Whether the kinds of ink both orders know are in the same order in each: the
 *  kinds are painted in that order, so a tile painted under one and a tile painted
 *  under the other would put a highlighter under a pen on one side of their edge and
 *  over it on the other. */
function sameOrder(was: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>): boolean {
  let last = -1
  for (const kind of now.keys()) {
    const at = was.get(kind)
    if (at === undefined) continue
    if (at < last) return false
    last = at
  }

  return true
}

/** Whether two palettes say the same colours, whichever objects they are.
 *
 *  Read by what they say rather than by which object they are, because a surface
 *  reads its palette off the theme again whenever the root element's class or style
 *  moves - which the pointer hiding under a key and coming back on the next move
 *  does - and every one of those is a new object with the same colours in it. Taken
 *  as a new theme, each one painted every tile again. */
function samePalette(one: Palette, other: Palette | null): boolean {
  if (!other) return false
  if (one === other) return true

  const keys = Object.keys(one)
  return (
    keys.length === Object.keys(other).length &&
    keys.every((key) => Object.hasOwn(other, key) && one[key] === other[key])
  )
}

/** All of a tile, as a patch. */
const WHOLE: Patch = { left: 0, top: 0, right: TILE, bottom: TILE }

/** One patch that covers them all. */
function bounds(patches: readonly Patch[]): Patch {
  return {
    left: Math.min(...patches.map((one) => one.left)),
    top: Math.min(...patches.map((one) => one.top)),
    right: Math.max(...patches.map((one) => one.right)),
    bottom: Math.max(...patches.map((one) => one.bottom)),
  }
}

export class InkTiles {
  readonly #make: MakeSurface
  /** Surfaces of tiles let go, kept for the next tiles rather than made again. */
  readonly #spare: Surface[] = []

  #strokes: readonly InkStroke[] = []
  readonly #grid = new InkGrid()
  #order = new Map<string, number>()
  #palette: Palette | null = null

  /** Device pixels per plane unit, which is what the tiles are painted at. */
  #scale = 0
  readonly #tiles = new Map<number, Tile>()
  #repaints = 0
  #painted: Painted | null = null

  constructor(make: MakeSurface = makeSurface) {
    this.#make = make
  }

  /** The ink on `ctx`, which is a layer the size of `view`, and what is picked
   *  ringed on top. Answers whether any of it is still to come, which is a repaint
   *  owed on the next frame. */
  paint(
    ctx: CanvasRenderingContext2D,
    strokes: readonly InkStroke[],
    view: View,
    palette: Palette,
    picked?: ReadonlySet<string>,
  ): boolean {
    this.#repaints++

    const scale = view.camera.scale * view.ratio
    if (scale !== this.#scale) {
      this.#scale = scale
      for (const tile of this.#tiles.values()) this.#release(tile)
      this.#tiles.clear()
    }

    if (!samePalette(palette, this.#palette)) {
      this.#palette = palette
      for (const tile of this.#tiles.values()) tile.stale = true
    }

    if (strokes !== this.#strokes) this.#follow(strokes)

    const wanted = this.#wanted(view)
    const pending = this.#fill(wanted, palette)
    this.#compose(ctx, wanted, view)
    if (picked) paintPicked(ctx, strokes, picked, view, palette)
    this.#letGo(wanted)

    return pending
  }

  /** A patch of a tile as the part of the plane it covers, in plane units, with a
   *  device pixel to spare all round: the edge of an outline is softened into the
   *  pixel beside it, and a stroke that stops just short of the patch can still
   *  colour its edge. */
  #plane(tile: Spot, patch: Patch): Box {
    const scale = this.#scale
    return {
      x: (tile.across * TILE + patch.left - 1) / scale,
      y: (tile.down * TILE + patch.top - 1) / scale,
      width: (patch.right - patch.left + 2) / scale,
      height: (patch.bottom - patch.top + 2) / scale,
    }
  }

  /** What a box on the plane covers of one tile, as a patch, or null for none. The
   *  same pixel to spare, and out to whole pixels. */
  #patch(tile: Spot, box: Box): Patch | null {
    const scale = this.#scale
    const left = Math.max(0, Math.floor(box.x * scale - tile.across * TILE) - 1)
    const top = Math.max(0, Math.floor(box.y * scale - tile.down * TILE) - 1)
    const right = Math.min(TILE, Math.ceil((box.x + box.width) * scale - tile.across * TILE) + 1)
    const bottom = Math.min(TILE, Math.ceil((box.y + box.height) * scale - tile.down * TILE) + 1)

    return right > left && bottom > top ? { left, top, right, bottom } : null
  }

  /** Every tile kept that a box on the plane touches, handed to `visit`. */
  #touched(box: Box, visit: (tile: Tile) => void) {
    const spare = 1 / this.#scale
    const left = Math.floor(((box.x - spare) * this.#scale) / TILE)
    const right = Math.floor(((box.x + box.width + spare) * this.#scale) / TILE)
    const top = Math.floor(((box.y - spare) * this.#scale) / TILE)
    const bottom = Math.floor(((box.y + box.height + spare) * this.#scale) / TILE)

    // A long stroke zoomed far in crosses more tiles than are kept: ask the tiles.
    if ((right - left + 1) * (bottom - top + 1) > this.#tiles.size) {
      for (const tile of this.#tiles.values()) {
        const { across, down } = tile
        if (across >= left && across <= right && down >= top && down <= bottom) visit(tile)
      }
      return
    }

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) {
        const tile = this.#tiles.get(keyOf(across, down))
        if (tile) visit(tile)
      }
    }
  }

  /** The tiles told what changed between the strokes they were painted from and
   *  these: where to repair, and what to lay over meanwhile. */
  #follow(strokes: readonly InkStroke[]) {
    const was = this.#strokes
    this.#strokes = strokes

    const grew = grewFrom(was, strokes)
    let gone: InkStroke[] = []
    let added: InkStroke[]

    if (grew) {
      added = strokes.slice(was.length)
      for (const stroke of added) {
        const kind = inkKind(stroke)
        if (!this.#order.has(kind)) this.#order.set(kind, this.#order.size)
      }
    } else {
      const before = new Set(was)
      const after = new Set(strokes)
      gone = was.filter((stroke) => !after.has(stroke))
      added = strokes.filter((stroke) => !before.has(stroke))

      const order = firstSeen(strokes)
      if (!sameOrder(this.#order, order)) {
        for (const tile of this.#tiles.values()) tile.stale = true
      }
      this.#order = order
    }

    const mark = (stroke: InkStroke, tile: Tile) => {
      const patch = this.#patch(tile, strokeBox(stroke))
      if (!patch) return

      tile.patches.push(patch)
      if (tile.patches.length > MOST_PATCHES) tile.patches = [bounds(tile.patches)]
    }

    for (const stroke of gone) {
      this.#grid.remove(stroke)
      this.#touched(strokeBox(stroke), (tile) => mark(stroke, tile))
    }

    for (const stroke of added) {
      this.#grid.add(stroke)
      this.#touched(strokeBox(stroke), (tile) => {
        mark(stroke, tile)
        tile.adds.push(stroke)
      })
    }
  }

  /** The tiles the layer shows, from the middle of the view outwards: what somebody
   *  is looking at is painted first when there is more to paint than a frame. */
  #wanted(view: View): Spot[] {
    const box = seen(view)
    const scale = this.#scale
    // The tiles the layer's pixels fall in: a tile that starts exactly where the
    // layer ends has none of them.
    const left = Math.floor((box.x * scale) / TILE)
    const right = Math.ceil(((box.x + box.width) * scale) / TILE) - 1
    const top = Math.floor((box.y * scale) / TILE)
    const bottom = Math.ceil(((box.y + box.height) * scale) / TILE) - 1

    const middleAcross = (view.camera.x * scale) / TILE - 0.5
    const middleDown = (view.camera.y * scale) / TILE - 0.5
    const out: (Spot & { far: number })[] = []

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) {
        out.push({ across, down, far: (across - middleAcross) ** 2 + (down - middleDown) ** 2 })
      }
    }

    return out.sort((one, other) => one.far - other.far)
  }

  /** Which to do first: a repair, which is cheap and is an edit somebody is waiting
   *  to see; then a tile with nothing to show at all; then one that is only out of
   *  date. */
  #urgency(spot: Spot): number {
    const tile = this.#tiles.get(keyOf(spot.across, spot.down))
    if (!tile) return 1
    if (tile.patches.length) return 0
    return tile.stale ? 2 : 3
  }

  /** As much of what is missing, out of date or edited as one frame's budget covers.
   *  Answers whether any is left. */
  #fill(wanted: readonly Spot[], palette: Palette): boolean {
    let spent = 0

    // Outlines first, out of the same budget: a stroke nobody has outlined yet is a
    // stroke its tile waits for.
    const ready = (strokes: readonly InkStroke[]) => {
      let unready = 0
      for (const stroke of strokes) {
        if (outlined(stroke)) continue
        if (spent + OUTLINE_WEIGHT <= FILLED_A_FRAME) {
          pathOf(stroke)
          spent += OUTLINE_WEIGHT
        } else {
          unready++
        }
      }

      return unready === 0
    }

    const affords = (cost: number) => !spent || spent + cost <= FILLED_A_FRAME

    const order = [...wanted].sort((one, other) => this.#urgency(one) - this.#urgency(other))

    for (const spot of order) {
      const tile = this.#tiles.get(keyOf(spot.across, spot.down))

      // An edit is repaired where it is even on a tile that is due to be painted
      // again whole: it is what somebody is waiting to see, and it is cheap.
      if (tile?.patches.length) {
        const patches = tile.patches
        const members = patches.map((patch) => this.#grid.near(this.#plane(tile, patch)))
        const cost = members.reduce((sum, one) => sum + one.length, 0)
        if (!ready(members.flat()) || !affords(cost)) continue

        patches.forEach((patch, at) => this.#repair(tile, patch, members[at] ?? [], palette))
        tile.patches = []
        tile.adds = []
        spent += cost
        continue
      }

      if (tile && !tile.stale) continue

      const members = this.#grid.near(this.#plane(spot, WHOLE))
      if (!ready(members) || !affords(members.length)) continue

      this.#paintTile(spot, tile, members, palette)
      spent += members.length
    }

    // Whatever could not be repaired this frame still shows what was drawn on it,
    // laid over; the repair that follows makes it exactly what a fill of everything
    // there would have made.
    let left = false
    for (const spot of wanted) {
      const tile = this.#tiles.get(keyOf(spot.across, spot.down))
      if (!tile) {
        left = true
        continue
      }

      if (tile.adds.length) this.#layOver(tile, palette)
      if (tile.stale || tile.patches.length) left = true
    }

    return left
  }

  /** A tile painted whole, from nothing. */
  #paintTile(spot: Spot, held: Tile | undefined, members: readonly InkStroke[], palette: Palette) {
    const tile: Tile = held ?? {
      across: spot.across,
      down: spot.down,
      surface: null,
      stale: false,
      patches: [],
      adds: [],
      used: this.#repaints,
    }
    this.#tiles.set(keyOf(spot.across, spot.down), tile)
    tile.stale = false
    tile.patches = []
    tile.adds = []

    if (!members.length) {
      // Nothing on it now, so nothing to keep: the pixels go back for another tile.
      this.#release(tile)
      return
    }

    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    wipe(ctx, TILE, TILE)
    this.#onto(ctx, tile)
    fillInk(ctx, members, palette, this.#rank)
    plain(ctx)
  }

  /** One patch of a tile cleared and filled again, and nothing outside it touched. */
  #repair(tile: Tile, patch: Patch, members: readonly InkStroke[], palette: Palette) {
    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    const wide = patch.right - patch.left
    const tall = patch.bottom - patch.top
    plain(ctx)
    ctx.clearRect(patch.left, patch.top, wide, tall)

    if (!members.length) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(patch.left, patch.top, wide, tall)
    ctx.clip()
    this.#onto(ctx, tile)
    fillInk(ctx, members, palette, this.#rank)
    ctx.restore()
    plain(ctx)
  }

  /** The context a tile is painted on, finding it pixels if it has none: a spare
   *  one wiped of the tile it was, or a new one. */
  #surfaceOf(tile: Tile): Paintable | null {
    if (tile.surface) return tile.surface.context

    const spare = this.#spare.pop()
    if (spare) wipe(spare.context, TILE, TILE)
    tile.surface = spare ?? this.#make(TILE)
    return tile.surface?.context ?? null
  }

  /** Where a kind of ink comes in the order the plane paints them. */
  readonly #rank = (kind: string) => this.#order.get(kind) ?? this.#order.size

  /** The tile's corner of the plane on its context, at the tiles' scale. Whole
   *  pixels, so a tile meets the one beside it exactly. */
  #onto(ctx: Paintable, tile: Spot) {
    const scale = this.#scale
    ctx.setTransform(scale, 0, 0, scale, -tile.across * TILE, -tile.down * TILE)
  }

  #layOver(tile: Tile, palette: Palette) {
    const adds = tile.adds
    tile.adds = []

    const ctx = this.#surfaceOf(tile)
    if (!ctx) return

    this.#onto(ctx, tile)
    fillInk(ctx, adds, palette, this.#rank)
    plain(ctx)
  }

  /** The tiles copied onto the layer where the camera puts them now.
   *
   *  Where a tile is not there yet - a zoom that settled on a new scale, a pan onto
   *  plane nobody has painted - the picture the layer held before is drawn there
   *  instead, moved and scaled to where it now belongs. That is what the layer was
   *  showing under its transform while the view moved, so nothing blinks; the tile
   *  replaces it when it arrives. */
  #compose(ctx: CanvasRenderingContext2D, wanted: readonly Spot[], view: View) {
    const at = origin(view)
    const width = view.width * view.ratio
    const height = view.height * view.ratio
    const was = this.#painted

    const missing = wanted.filter(({ across, down }) => !this.#tiles.has(keyOf(across, down)))
    const kept = missing.length > 0 && was?.width === width && was.height === height ? was : null

    if (kept) {
      const scale = this.#scale / kept.scale
      plain(ctx)
      ctx.save()
      ctx.beginPath()
      for (const { across, down } of missing) {
        ctx.rect(across * TILE + at.x, down * TILE + at.y, TILE, TILE)
      }
      ctx.clip()
      ctx.globalCompositeOperation = 'copy'
      ctx.setTransform(scale, 0, 0, scale, at.x - kept.x * scale, at.y - kept.y * scale)
      ctx.drawImage(ctx.canvas, 0, 0)
      ctx.restore()
      plain(ctx)
    } else {
      wipe(ctx, width, height)
    }

    for (const { across, down } of wanted) {
      const tile = this.#tiles.get(keyOf(across, down))
      if (!tile) continue

      tile.used = this.#repaints
      const x = across * TILE + at.x
      const y = down * TILE + at.y
      if (kept) ctx.clearRect(x, y, TILE, TILE)
      if (tile.surface) ctx.drawImage(tile.surface.image, x, y)
    }

    this.#painted = { scale: this.#scale, x: at.x, y: at.y, width, height }
  }

  /** The tiles nobody has looked at for longest, let go once there are more than
   *  `KEPT` screens of them. */
  #letGo(wanted: readonly Spot[]) {
    const most = Math.max(16, wanted.length * KEPT)
    if (this.#tiles.size <= most) return

    const oldest = [...this.#tiles.entries()]
      .filter(([, tile]) => tile.used < this.#repaints)
      .sort(([, one], [, other]) => one.used - other.used)

    for (const [key, tile] of oldest.slice(0, this.#tiles.size - most)) {
      this.#release(tile)
      this.#tiles.delete(key)
    }
  }

  #release(tile: Tile) {
    if (tile.surface && this.#spare.length < 64) this.#spare.push(tile.surface)
    tile.surface = null
  }
}
