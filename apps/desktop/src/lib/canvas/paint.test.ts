import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { InkStroke } from './format'

/** The paint itself: an outline, a kind of ink, a fill. What the tiles do with it is
 *  tiles.test.ts; this is what one fill of some strokes is, which the tiles, the pen's
 *  own layer and a thumbnail all share. */

/** A path that counts what is copied into it and draws nothing: this runs under
 *  node, where there is no canvas and no `Path2D`. */
class CountingPath {
  held = 0

  moveTo() {
    return undefined
  }

  quadraticCurveTo() {
    return undefined
  }

  closePath() {
    return undefined
  }

  addPath() {
    this.held += 1
  }
}

/** A context that accepts everything and remembers its fills: how many strokes each
 *  was, in which colour, at which alpha and through which blend. */
function context() {
  const fills: { strokes: number; colour: string; alpha: number; blend: string }[] = []
  const transforms: number[][] = []
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    setTransform: (...values: number[]) => transforms.push(values),
    clearRect: () => undefined,
    createPattern: () => null,
    fill: (path: CountingPath) =>
      fills.push({
        strokes: path.held,
        colour: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        blend: ctx.globalCompositeOperation,
      }),
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, transforms }
}

beforeAll(() => {
  vi.stubGlobal('Path2D', CountingPath)
})

const { fillInk, firstSeen, origin, paintInk, paintLive, strokesFilled } = await import('./paint')

function stroke(id: string, x: number, overrides: Partial<InkStroke> = {}): InkStroke {
  return {
    id,
    tool: 'pen',
    color: 'ink',
    size: 3,
    points: [0, 1, 2].map((step) => ({
      x: x + step * 8,
      y: 100,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: step * 10,
    })),
    ...overrides,
  }
}

const view = (x: number, y: number, scale = 1) => ({
  camera: { x, y, scale },
  width: 800,
  height: 600,
  ratio: 1,
})

describe('one fill of some strokes', () => {
  test('fills once per kind of ink, however many strokes there are', () => {
    const strokes = Array.from({ length: 300 }, (_, one) => stroke(`s${one}`, one * 2))
    strokes[7] = { ...strokes[7]!, tool: 'fountain' }
    strokes[9] = { ...strokes[9]!, color: 'red' }
    const { ctx, fills } = context()

    const before = strokesFilled()
    fillInk(ctx, strokes, {}, () => 0)

    // Three kinds, three fills - and every stroke counted once.
    expect(fills).toHaveLength(3)
    expect(fills.reduce((sum, one) => sum + one.strokes, 0)).toBe(300)
    expect(strokesFilled() - before).toBe(300)
  })

  test('two opacities of one pen are two fills, so neither comes out at the other', () => {
    const { ctx, fills } = context()
    fillInk(ctx, [stroke('a', 0), stroke('b', 10, { opacity: 0.4 })], {}, () => 0)

    expect(fills.map((one) => one.alpha).sort()).toEqual([0.4, 1])
  })

  test('fills the kinds in the order it is given, not the order it meets them', () => {
    const { ctx, fills } = context()
    const order = new Map([
      ['highlighter\nyellow\n0.32', 0],
      ['pen\nink\n1', 1],
    ])

    fillInk(
      ctx,
      [stroke('word', 0), stroke('mark', 0, { tool: 'highlighter', color: 'yellow' })],
      { yellow: 'Y', ink: 'I' },
      (kind) => order.get(kind) ?? order.size,
    )

    expect(fills.map((one) => one.colour)).toEqual(['Y', 'I'])
    expect(fills[0]?.blend).toBe('multiply')
  })

  test('the order kinds first appear in is the plane order', () => {
    const order = firstSeen([
      stroke('a', 0, { color: 'red' }),
      stroke('b', 0),
      stroke('c', 0, { color: 'red' }),
    ])

    expect([...order.keys()]).toEqual(['pen\nred\n1', 'pen\nink\n1'])
  })
})

describe('where the plane lands on a layer', () => {
  test('in whole device pixels, whatever the camera', () => {
    const at = origin({
      camera: { x: 10.37, y: -4.21, scale: 1.3 },
      width: 801,
      height: 599,
      ratio: 1.25,
    })

    expect(Number.isInteger(at.x)).toBe(true)
    expect(Number.isInteger(at.y)).toBe(true)
  })

  test('the stroke under the pen is placed by the same rounding as the tiles', () => {
    const { ctx, transforms } = context()
    const at = view(10.37, -4.21, 1.3)
    paintLive(ctx, stroke('live', 0), at, {})

    const placed = transforms.find((one) => one[0] !== 1)
    expect(placed?.slice(4)).toEqual([origin(at).x, origin(at).y])
  })
})

describe('a thumbnail', () => {
  test('paints what is in view in one go, once per kind', () => {
    const inside = Array.from({ length: 50 }, (_, one) => stroke(`in${one}`, one * 4))
    const outside = Array.from({ length: 50 }, (_, one) => stroke(`out${one}`, 50_000 + one * 4))
    const { ctx, fills } = context()

    paintInk(ctx, [...inside, ...outside], view(100, 100), {})

    expect(fills).toHaveLength(1)
    expect(fills[0]?.strokes).toBe(50)
  })
})
