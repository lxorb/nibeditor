import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'

/** What a repaint of the ink costs, counted, and what the tiles end up showing.
 *
 *  A plane of ten thousand strokes seen whole was one path, and every repaint
 *  filled all of it: four hundred milliseconds a frame, growing as the plane
 *  arrived, whether the repaint was for a pan, a zoom or one stroke drawn. So what
 *  is counted here is strokes filled, and what it has to say is that a pan fills
 *  none, an edit fills the strokes around it, and a plane arriving fills a frame's
 *  budget at a time. A count rather than a clock, for the reason the counter's own
 *  comment gives.
 *
 *  And because an edit repaints part of a tile rather than all of it, what a tile
 *  shows is not any one fill: it is whatever was last painted at each of its
 *  pixels. So the contexts here keep a model of that - every clear and every fill,
 *  with the rectangle it was clipped to and the strokes in it - and `check` holds
 *  every tile, pixel by pixel, to the strokes that really cover it. */

/** A path that counts what is traced into it and draws nothing: this runs under
 *  node, where there is no canvas and no `Path2D`. */
class CountingPath {
  static traced = 0

  moveTo() {
    CountingPath.traced += 1
  }

  quadraticCurveTo() {
    return undefined
  }

  closePath() {
    return undefined
  }

  addPath() {
    return undefined
  }
}

/** The strokes of the fill being made, handed from the paint to the context that
 *  receives it: the context sees a path, and a path does not say what is in it. */
const filling = vi.hoisted(() => ({ strokes: [] as InkStroke[] }))

vi.mock('./paint', async (original) => {
  const paint = await original<typeof import('./paint')>()
  return {
    ...paint,
    fillInk: (...args: Parameters<typeof paint.fillInk>) => {
      const [ctx, strokes, palette, rank] = args
      filling.strokes = [...strokes]
      paint.fillInk(ctx, filling.strokes, palette, rank)
    },
  }
})

beforeAll(() => {
  vi.stubGlobal('Path2D', CountingPath)
})

const { FILE_WEIGHT, FILLED_A_FRAME, InkTiles, OUTLINE_WEIGHT, TILE } = await import('./tiles')
const { InkGrid } = await import('./ink-grid')
const { strokesFilled } = await import('./paint')

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** One thing done to a context's pixels, in its own device pixels. */
type Mark =
  | { kind: 'clear'; rect: Rect }
  | { kind: 'fill'; rect: Rect; strokes: InkStroke[]; scale: number; x: number; y: number }

/** A 2d context that accepts everything and remembers what it did to its pixels, the
 *  colours it filled in, and what was copied onto it. */
function context() {
  const marks: Mark[] = []
  const colours: string[] = []
  const copies: { image: unknown; x: number; y: number; scale: number }[] = []
  const transform = { a: 1, e: 0, f: 0 }
  let outline: Rect | null = null
  let clip: Rect | null = null
  // What the layer and a tile are copied as: something to tell apart by identity,
  // since nothing here draws pixels.
  const self = {} as unknown as HTMLCanvasElement
  const all = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }

  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    canvas: self,
    setTransform: (a: number, _b: number, _c: number, _d: number, e: number, f: number) => {
      Object.assign(transform, { a, e, f })
    },
    clearRect: (x: number, y: number, wide: number, tall: number) => {
      marks.push({ kind: 'clear', rect: { left: x, top: y, right: x + wide, bottom: y + tall } })
    },
    createPattern: () => null,
    save: () => undefined,
    restore: () => {
      clip = null
    },
    beginPath: () => {
      outline = null
    },
    rect: (x: number, y: number, wide: number, tall: number) => {
      outline = { left: x, top: y, right: x + wide, bottom: y + tall }
    },
    clip: () => {
      clip = outline
    },
    fill: () => {
      colours.push(ctx.fillStyle)
      if (!filling.strokes.length) return
      marks.push({
        kind: 'fill',
        rect: clip ?? all,
        strokes: filling.strokes,
        scale: transform.a,
        x: transform.e,
        y: transform.f,
      })
      // The other kinds in the same fill are the same strokes as far as which
      // pixels they reach.
      filling.strokes = []
    },
    stroke: () => undefined,
    drawImage: (image: unknown, x: number, y: number) => {
      copies.push({ image, x, y, scale: transform.a })
    },
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, marks, colours, copies, self }
}

/** Tiles painted on contexts of the same kind, one each, remembered in the order
 *  they were made. */
function surfaces() {
  const made: ReturnType<typeof context>[] = []
  const make = () => {
    const one = context()
    made.push(one)
    return { image: one.self, context: one.ctx }
  }

  return { made, make }
}

/** Whether a stroke reaches a pixel of a context placed at `scale`, `x`, `y`: its
 *  box, out to the pixel its edge is softened into. */
function reaches(stroke: InkStroke, px: number, py: number, scale: number, x: number, y: number) {
  const box = strokeBox(stroke)
  const middle = { x: px + 0.5, y: py + 0.5 }
  return (
    middle.x >= box.x * scale + x - 1 &&
    middle.x <= (box.x + box.width) * scale + x + 1 &&
    middle.y >= box.y * scale + y - 1 &&
    middle.y <= (box.y + box.height) * scale + y + 1
  )
}

const inside = (rect: Rect, px: number, py: number) =>
  px >= rect.left && px < rect.right && py >= rect.top && py < rect.bottom

/** What a context's pixel shows: the strokes painted there since it was last
 *  cleared there, as the marks say. */
function shown(marks: readonly Mark[], px: number, py: number): string[] {
  const out = new Set<string>()
  for (let at = marks.length - 1; at >= 0; at--) {
    const mark = marks[at]
    if (!mark || !inside(mark.rect, px, py)) continue
    if (mark.kind === 'clear') break
    for (const stroke of mark.strokes) {
      if (reaches(stroke, px, py, mark.scale, mark.x, mark.y)) out.add(stroke.id)
    }
  }

  return [...out].sort()
}

/** Every tile holds, at every pixel sampled, exactly the strokes that reach it -
 *  and every tile of `at` that any stroke reaches has pixels of its own. Sampled on a
 *  grid, at the middle of every stroke on the tile, and at the middle of every
 *  stroke in `gone`, which is where a stroke rubbed out would still show. */
function check(
  made: ReturnType<typeof surfaces>['made'],
  strokes: readonly InkStroke[],
  at: ReturnType<typeof view>,
  gone: readonly InkStroke[] = [],
) {
  const scale = at.camera.scale * at.ratio
  const held = new Map<string, Mark[]>()

  for (const one of made) {
    // What this context is now: the tile its latest fill was placed for, and the
    // marks since it was last wiped whole.
    let wiped = 0
    one.marks.forEach((mark, at) => {
      const { left, top, right, bottom } = mark.rect
      if (mark.kind === 'clear' && left <= 0 && top <= 0 && right >= TILE && bottom >= TILE) {
        wiped = at
      }
    })

    const since = one.marks.slice(wiped)
    const last = since.filter((mark) => mark.kind === 'fill').at(-1)
    if (last?.kind !== 'fill') continue
    held.set(`${-last.x / TILE},${-last.y / TILE}`, since)
  }

  const middle = (stroke: InkStroke, across: number, down: number) => {
    const box = strokeBox(stroke)
    return [
      Math.floor((box.x + box.width / 2) * scale - across * TILE),
      Math.floor((box.y + box.height / 2) * scale - down * TILE),
    ] as const
  }

  for (const tile of expected(strokes, at).keys()) {
    const marks = held.get(tile)
    expect(marks, `tile ${tile} has no pixels`).toBeDefined()
    if (!marks) continue

    const [across = 0, down = 0] = tile.split(',').map(Number)
    const x = -across * TILE
    const y = -down * TILE
    const near = strokes.filter((one) => reachesTile(one, scale, x, y))

    const samples: (readonly [number, number])[] = []
    for (let py = 0; py < TILE; py += 16)
      for (let px = 0; px < TILE; px += 16) samples.push([px, py])
    for (const one of [...near, ...gone]) samples.push(middle(one, across, down))

    for (const [px, py] of samples) {
      if (px < 0 || py < 0 || px >= TILE || py >= TILE) continue
      const truth = near
        .filter((one) => reaches(one, px, py, scale, x, y))
        .map((one) => one.id)
        .sort()
      expect(shown(marks, px, py), `tile ${tile} at ${px},${py}`).toEqual(truth)
    }
  }
}

/** Whether a stroke reaches any pixel of the tile placed at `x`, `y`. */
function reachesTile(stroke: InkStroke, scale: number, x: number, y: number) {
  const box = strokeBox(stroke)
  return (
    box.x * scale + x - 1 < TILE &&
    (box.x + box.width) * scale + x + 1 > 0 &&
    box.y * scale + y - 1 < TILE &&
    (box.y + box.height) * scale + y + 1 > 0
  )
}

/** A plane of strokes laid out in a grid, each a short line, all in one ink. */
function plane(count: number, across = 100, spacing = 120): InkStroke[] {
  const strokes: InkStroke[] = []

  for (let one = 0; one < count; one++) {
    const x = (one % across) * spacing
    const y = Math.floor(one / across) * spacing
    const points = []
    for (let step = 0; step < 6; step++) {
      points.push({
        x: x + step * 8,
        y: y + step * 2,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 10,
      })
    }

    strokes.push({ id: `s${one}`, tool: 'pen', color: 'ink', size: 3, points })
  }

  return strokes
}

/** A stroke of `tool` from `x, y`, going right. */
function drawn(id: string, x: number, y: number, tool: InkStroke['tool'] = 'pen'): InkStroke {
  return {
    id,
    tool,
    color: 'ink',
    size: 3,
    points: [0, 1, 2, 3].map((step) => ({
      x: x + step * 10,
      y,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: step * 10,
    })),
  }
}

/** A layer of 800 by 600 over the plane, at one device pixel per CSS pixel. */
const view = (x: number, y: number, scale = 1) => ({
  camera: { x, y, scale },
  width: 800,
  height: 600,
  ratio: 1,
})

/** The whole plane of ten thousand in view, the way a canvas opened for the first
 *  time frames itself: a tile of it holds nearly two thousand strokes. */
const whole = view(6000, 6000, 0.05)

const palette = {}

/** Repaints until nothing is owed, and what each one filled. */
function settle(paint: () => boolean, most = 400): number[] {
  const each: number[] = []
  for (let frame = 0; frame < most; frame++) {
    const before = strokesFilled()
    const owed = paint()
    each.push(strokesFilled() - before)
    if (!owed) return each
  }

  throw new Error('the ink never finished arriving')
}

const sum = (list: readonly number[]) => list.reduce((all, one) => all + one, 0)

/** Which strokes meet each tile the layer shows, worked out the long way. */
function expected(strokes: readonly InkStroke[], at: ReturnType<typeof view>): Map<string, number> {
  const scale = at.camera.scale * at.ratio
  const side = TILE / scale
  const spare = 1 / scale
  const seen = {
    x: at.camera.x - at.width / 2 / at.camera.scale,
    y: at.camera.y - at.height / 2 / at.camera.scale,
    width: at.width / at.camera.scale,
    height: at.height / at.camera.scale,
  }

  const meets = (one: Box, other: Box) =>
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height

  const out = new Map<string, number>()
  for (
    let across = Math.floor((seen.x * scale) / TILE);
    across * side < seen.x + seen.width;
    across++
  ) {
    for (
      let down = Math.floor((seen.y * scale) / TILE);
      down * side < seen.y + seen.height;
      down++
    ) {
      const box = {
        x: across * side - spare,
        y: down * side - spare,
        width: side + 2 * spare,
        height: side + 2 * spare,
      }
      const count = strokes.filter((one) => meets(strokeBox(one), box)).length
      if (count) out.set(`${across},${down}`, count)
    }
  }

  return out
}

describe('a plane seen whole, arriving', () => {
  test('fills a frame of budget at a time, and every tile is filled once', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    const frames: number[] = []
    const outlines: number[] = []
    const filings: number[] = []
    const filing = vi.spyOn(InkGrid.prototype, 'add')
    for (let owed = true; owed;) {
      const filled = strokesFilled()
      const traced = CountingPath.traced
      const filed = filing.mock.calls.length
      owed = tiles.paint(layer.ctx, strokes, whole, palette)
      frames.push(strokesFilled() - filled)
      outlines.push(CountingPath.traced - traced)
      filings.push(filing.mock.calls.length - filed)
      if (frames.length > 400) throw new Error('the ink never finished arriving')
    }
    filing.mockRestore()

    // More than one frame, and none of them over the budget, filing, outlines and
    // fills together: this is the four hundred milliseconds a frame that the plane
    // used to be, and the thirty the first frame spent filing before it began.
    expect(frames.length).toBeGreaterThan(1)
    frames.forEach((filled, at) => {
      const outlined = (outlines[at] ?? 0) * OUTLINE_WEIGHT
      expect(filled + outlined + (filings[at] ?? 0) * FILE_WEIGHT).toBeLessThanOrEqual(
        FILLED_A_FRAME,
      )
    })

    // Every stroke filed once, outlined once, and every tile filled once.
    expect(sum(filings)).toBe(strokes.length)
    expect(sum(outlines)).toBe(strokes.length)
    expect(sum(frames)).toBe(sum([...expected(strokes, whole).values()]))
  })

  test('every tile of a plane seen whole shows what is on it, and nothing else', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))
    check(made, strokes, whole)
  })

  test('a plane that fits in a frame arrives in one', () => {
    const strokes = plane(200, 20)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    expect(settle(() => tiles.paint(layer.ctx, strokes, view(1000, 1000), palette))).toHaveLength(1)
  })
})

describe('moving over a plane already painted', () => {
  test('a pan back and forth over painted plane fills nothing', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(3000, 3000), palette))
    settle(() => tiles.paint(layer.ctx, strokes, view(3300, 3100), palette))

    // Forty settles of a hand going to and fro, which used to be forty fills of
    // everything in view.
    const before = strokesFilled()
    for (let frame = 0; frame < 40; frame++) {
      const at = frame % 2 ? view(3000, 3000) : view(3300, 3100)
      expect(tiles.paint(layer.ctx, strokes, at, palette)).toBe(false)
    }

    expect(strokesFilled() - before).toBe(0)
  })

  test('a pan onto new plane fills only the tiles it uncovered', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const from = view(3000, 3000)
    const to = view(3600, 3000)

    settle(() => tiles.paint(layer.ctx, strokes, from, palette))
    const filled = sum(settle(() => tiles.paint(layer.ctx, strokes, to, palette)))

    const before = expected(strokes, from)
    const uncovered = sum(
      [...expected(strokes, to)].filter(([tile]) => !before.has(tile)).map(([, count]) => count),
    )

    expect(filled).toBeGreaterThan(0)
    expect(filled).toBe(uncovered)
  })

  test('shows the tiles it has, at whole pixels, where the camera puts them', () => {
    const strokes = plane(400, 20)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(1000.3, 1000.7), palette))
    layer.copies.length = 0
    tiles.paint(layer.ctx, strokes, view(1000.3, 1000.7), palette)

    expect(layer.copies.length).toBe(expected(strokes, view(1000.3, 1000.7)).size)
    for (const copy of layer.copies) {
      expect(Number.isInteger(copy.x)).toBe(true)
      expect(Number.isInteger(copy.y)).toBe(true)
    }
  })

  test('the same colours read off the theme again paint nothing again', () => {
    // A surface reads its palette again whenever the root element's class or style
    // moves: a new object with the same colours in it, every time.
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const at = view(3000, 3000)
    settle(() => tiles.paint(layer.ctx, strokes, at, { ink: 'black', yellow: 'gold' }))

    const before = strokesFilled()
    for (let move = 0; move < 20; move++) {
      expect(tiles.paint(layer.ctx, strokes, at, { ink: 'black', yellow: 'gold' })).toBe(false)
    }

    expect(strokesFilled() - before).toBe(0)
  })
})

describe('writing on a plane already painted', () => {
  test('a stroke drawn on a plane seen whole fills the strokes around it, not its tiles', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    // Right across the edge between two tiles, each holding nearly two thousand.
    const grown = [...strokes, drawn('new', TILE / 0.05 - 20, 3000)]
    const before = strokesFilled()
    expect(tiles.paint(layer.ctx, grown, whole, palette)).toBe(false)

    // A handful, where it was every stroke in view - and then every stroke on the
    // two tiles it crossed.
    expect(strokesFilled() - before).toBeGreaterThan(0)
    expect(strokesFilled() - before).toBeLessThan(40)
    check(made, grown, whole)
  })

  test('a highlighter drawn over the ink is repaired with it, so each tile is one fill of both', () => {
    const strokes = plane(2_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    const at = view(2000, 1000, 0.25)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const mark = { ...drawn('mark', 1000, 500, 'highlighter'), size: 18 }
    const grown = [...strokes, mark]
    settle(() => tiles.paint(layer.ctx, grown, at, palette))

    check(made, grown, at)
  })

  test('a stroke rubbed out on a plane seen whole leaves every other stroke where it was', () => {
    // The plane used to be one path gathered a slice a frame, and a list that
    // changed rather than grew was gathered again from nothing: one stroke rubbed
    // out left 256 of ten thousand on the layer, and the rest came back over forty
    // frames.
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    const gone = strokes.filter((one) => one.id === 's1543')
    const left = strokes.filter((one) => one.id !== 's1543')
    const before = strokesFilled()
    expect(tiles.paint(layer.ctx, left, whole, palette)).toBe(false)

    expect(strokesFilled() - before).toBeLessThan(40)
    check(made, left, whole, gone)
  })

  test('a rub across a plane seen whole costs the strokes it crosses, move by move', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    // Sixty moves of an eraser along a row, each taking the strokes it reaches.
    let now = strokes
    const each: number[] = []
    for (let move = 0; move < 60; move++) {
      const row = now.filter((one) => one.id !== `s${1500 + move}`)
      const before = strokesFilled()
      tiles.paint(layer.ctx, row, whole, palette)
      each.push(strokesFilled() - before)
      now = row
    }

    for (const filled of each) expect(filled).toBeLessThan(40)
    settle(() => tiles.paint(layer.ctx, now, whole, palette))
    check(made, now, whole, strokes.slice(1500, 1560))
  })

  test('a lasso that moves many strokes repairs where they were and where they went', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    const at = view(3000, 1500, 0.25)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const picked = new Set(strokes.slice(1000, 1400).map((one) => one.id))
    const moved = strokes.map((one) =>
      picked.has(one.id)
        ? {
            ...one,
            points: one.points.map((point) => ({ ...point, x: point.x + 700, y: point.y + 300 })),
          }
        : one,
    )

    const frames = settle(() => tiles.paint(layer.ctx, moved, at, palette))
    for (const filled of frames) expect(filled).toBeLessThanOrEqual(FILLED_A_FRAME)
    check(
      made,
      moved,
      at,
      strokes.filter((one) => picked.has(one.id)),
    )
  })

  test('the kinds are painted in the order the plane first has them, in every tile', () => {
    // A highlighter first and then a pen in one tile, and the other way round in the
    // next: both tiles fill the highlighter first, because the plane has it first.
    const strokes = [
      drawn('mark', 10, 10, 'highlighter'),
      drawn('word', 12, 12),
      drawn('later word', 300, 10),
      drawn('later mark', 302, 12, 'highlighter'),
    ].map((one) => (one.tool === 'highlighter' ? { ...one, color: 'yellow' } : one))
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(200, 100), { yellow: 'Y', ink: 'I' }))

    expect(made.map((one) => one.colours.join(''))).toEqual(['YI', 'YI'])
  })
})

describe('a zoom, a theme, and what is kept', () => {
  test('a zoom paints the new scale a frame at a time over the old picture, drawn to size', () => {
    const strokes = plane(3_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()
    settle(() => tiles.paint(layer.ctx, strokes, whole, palette))

    layer.copies.length = 0
    const closer = view(6000, 6000, 0.08)
    const before = strokesFilled()
    const owed = tiles.paint(layer.ctx, strokes, closer, palette)

    // Not all of it at once...
    expect(owed).toBe(true)
    expect(strokesFilled() - before).toBeLessThanOrEqual(FILLED_A_FRAME)
    // ...with the picture that was there drawn under what is missing, larger.
    const old = layer.copies.find((copy) => copy.image === layer.self)
    expect(old?.scale).toBeCloseTo(0.08 / 0.05)

    const frames = settle(() => tiles.paint(layer.ctx, strokes, closer, palette))
    for (const filled of frames) expect(filled).toBeLessThanOrEqual(FILLED_A_FRAME)
    check(made, strokes, closer)
  })

  test('a new theme paints every tile again, showing the old ones until it has', () => {
    const strokes = plane(10_000)
    const tiles = new InkTiles(surfaces().make)
    const layer = context()
    const at = view(3000, 3000)
    settle(() => tiles.paint(layer.ctx, strokes, at, palette))

    const filled = sum(settle(() => tiles.paint(layer.ctx, strokes, at, { ink: 'white' })))

    expect(filled).toBe(sum([...expected(strokes, at).values()]))
  })

  test('a tile with nothing on it has no pixels', () => {
    // Four strokes far apart on a plane of empty tiles.
    const strokes = plane(4, 2, 2000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    settle(() => tiles.paint(layer.ctx, strokes, view(1000, 1000, 0.25), palette))

    expect(made).toHaveLength(expected(strokes, view(1000, 1000, 0.25)).size)
  })

  test('keeps a couple of screens of tiles however far the plane is panned', () => {
    const strokes = plane(10_000)
    const { made, make } = surfaces()
    const tiles = new InkTiles(make)
    const layer = context()

    for (let step = 0; step < 30; step++) {
      settle(() => tiles.paint(layer.ctx, strokes, view(400 + step * 400, 3000), palette))
    }

    // Twelve tiles to a screen of this size; the rest are made again from the ones
    // let go rather than for good.
    const screen = expected(strokes, view(3000, 3000)).size
    expect(made.length).toBeLessThanOrEqual(screen * 3 + 64)
  })
})
