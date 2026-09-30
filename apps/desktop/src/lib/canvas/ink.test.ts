import { describe, expect, test } from 'vitest'
import type { InkPoint, InkStroke } from './format'
import { INK_TOOLS } from './format'
import { bounds, type Point } from './geometry'
import type { PenTraits } from './contacts'
import {
  assisted,
  erased,
  forceOf,
  INK_STYLES,
  inkOpacity,
  inkPath,
  insidePolygon,
  leadPoint,
  nearStroke,
  outlineOf,
  penFelt,
  simplified,
  smoothed,
  strokeBox,
  strokesInLasso,
  tidied,
  tidyShape,
  tiltOf,
  traceInk,
  transformed,
} from './ink'

function point(x: number, y: number, pressure = 0.5, t = 0): InkPoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, t }
}

function stroke(points: InkPoint[], over: Partial<InkStroke> = {}): InkStroke {
  return { id: 's', tool: 'pen', color: '#000000', size: 4, points, ...over }
}

/** A line of points along the x axis, one unit apart. */
function line(count: number, y = 0): InkPoint[] {
  return Array.from({ length: count }, (_one, index) => point(index, y, 0.5, index * 4))
}

describe('the outline of a stroke', () => {
  test('is a ring around the points, for every tool there is', () => {
    for (const tool of INK_TOOLS) {
      const ring = outlineOf(stroke(line(12), { tool }))
      expect(ring.length, tool).toBeGreaterThan(3)

      const box = strokeBox(stroke(line(12), { tool }))
      for (const one of ring) {
        expect(one.x, tool).toBeGreaterThanOrEqual(box.x - 1)
        expect(one.x, tool).toBeLessThanOrEqual(box.x + box.width + 1)
      }
    }
  })

  /** A flat nib is broad across the stroke and vanishes along it, which is what
   *  a chisel-tipped pen does and what perfect-freehand's round nib cannot. */
  test('is a ribbon for the flat nib and a body for the round ones', () => {
    expect(INK_STYLES.calligraphy.nib).not.toBeNull()
    expect(INK_STYLES.pen.nib).toBeNull()

    const flat = outlineOf(stroke(line(8), { tool: 'calligraphy' }))
    // One point out one way and one back the other, for every sample.
    expect(flat).toHaveLength(16)
  })

  test('every tool says how it behaves rather than the renderer guessing', () => {
    for (const tool of INK_TOOLS) {
      const style = INK_STYLES[tool]
      expect(style.opacity, tool).toBeGreaterThan(0)
      expect(style.opacity, tool).toBeLessThanOrEqual(1)
      expect(style.size, tool).toBeGreaterThan(0)
    }

    // The two that darken what they cross rather than covering it.
    expect(INK_STYLES.highlighter.multiply).toBe(true)
    expect(INK_STYLES.pencil.grain).toBe(true)
  })
})

/** A pen put down and lifted in one place. Every one of them leaves the mark its
 *  own nib would leave, because a tap that leaves nothing reads as a tap the
 *  plane did not notice. */
describe('the dot a tap leaves', () => {
  const tap = (tool: InkStroke['tool']) => stroke([point(0, 0)], { tool, size: 6 })

  test('is a ring with an inside, for every tool there is', () => {
    for (const tool of INK_TOOLS) {
      const ring = outlineOf(tap(tool))
      expect(ring.length, tool).toBeGreaterThanOrEqual(3)
      expect(inkPath(ring), tool).not.toBe('')
    }
  })

  /** Big enough to see. The three tapered pens used to come out a hundredth of a
   *  unit across, which is a mark nobody can find, and the blade came out with no
   *  area at all. */
  test('is about as wide as the nib, for every tool there is', () => {
    for (const tool of INK_TOOLS) {
      const ring = outlineOf(tap(tool))
      const xs = ring.map((one) => one.x)
      const ys = ring.map((one) => one.y)
      const across = Math.max(...xs) - Math.min(...xs)
      const down = Math.max(...ys) - Math.min(...ys)

      expect(Math.max(across, down), tool).toBeGreaterThan(1)
      expect(Math.max(across, down), tool).toBeLessThan(6 * 4)
    }
  })

  test('sits where the pen was put down', () => {
    for (const tool of INK_TOOLS) {
      const box = strokeBox(stroke([point(40, 25)], { tool, size: 6 }))
      expect(box.x + box.width / 2, tool).toBeCloseTo(40, 5)
      expect(box.y + box.height / 2, tool).toBeCloseTo(25, 5)
    }
  })

  /** A blade leaves a dash rather than a disc: broad across the nib, thin along
   *  it, which is what a chisel tip does. */
  test('is a dash under a flat nib', () => {
    const ring = outlineOf(tap('calligraphy'))
    expect(ring).toHaveLength(4)

    // Measured along the nib and across it rather than along the screen: the
    // blade is held at an angle, so a box round it says nothing about its shape.
    const angle = ((INK_STYLES.calligraphy.nib ?? 0) * Math.PI) / 180
    const along = ring.map((one) => one.x * Math.cos(angle) + one.y * Math.sin(angle))
    const across = ring.map((one) => one.y * Math.cos(angle) - one.x * Math.sin(angle))
    const broad = Math.max(...along) - Math.min(...along)
    const deep = Math.max(...across) - Math.min(...across)

    expect(deep).toBeGreaterThan(0)
    expect(deep).toBeLessThan(broad / 2)
  })

  test('survives being tidied on the way to the file', () => {
    for (const tool of INK_TOOLS) {
      expect(tidied(tap(tool)).points, tool).toHaveLength(1)
    }
  })

  test('is where a tap on it lands', () => {
    const dot = tap('pen')
    expect(nearStroke(dot, { x: 1, y: 1 }, 1)).toBe(true)
    expect(nearStroke(dot, { x: 40, y: 40 }, 1)).toBe(false)
  })
})

/** An arc, sampled as densely as asked, which is the shape that used to go hard
 *  the moment it landed: a curve has no corners, so any corner in it is one the
 *  drawing put there. */
function arc(count: number, radius = 60): InkPoint[] {
  return Array.from({ length: count }, (_one, index) => {
    const angle = (index / (count - 1)) * Math.PI
    return {
      x: Math.cos(angle) * radius,
      y: -Math.sin(angle) * radius,
      pressure: 0.5 + 0.25 * Math.sin(angle * 3),
      tiltX: 0,
      tiltY: 0,
      t: index * 6,
    }
  })
}

/** A ring drawn to a path and sampled back as points, so two paths can be
 *  compared as the shapes they are rather than as the commands they are made of. */
function drawn(ring: Point[], per = 6): Point[] {
  const out: Point[] = []
  let at: Point = { x: 0, y: 0 }

  traceInk(ring, {
    moveTo: (x, y) => {
      at = { x, y }
      out.push(at)
    },
    quadraticCurveTo: (cx, cy, x, y) => {
      const from = at
      for (let one = 1; one <= per; one++) {
        const share = one / per
        const rest = 1 - share
        out.push({
          x: rest * rest * from.x + 2 * rest * share * cx + share * share * x,
          y: rest * rest * from.y + 2 * rest * share * cy + share * share * y,
        })
      }
      at = { x, y }
    },
    closePath: () => undefined,
  })

  return out
}

/** How far the points of one shape sit from the nearest point of another, as a
 *  mean and a worst. */
function apart(one: Point[], other: Point[]): { mean: number; worst: number } {
  let sum = 0
  let worst = 0

  for (const here of one) {
    let near = Infinity
    for (const there of other) {
      near = Math.min(near, Math.hypot(here.x - there.x, here.y - there.y))
    }
    sum += near
    worst = Math.max(worst, near)
  }

  return { mean: sum / Math.max(1, one.length), worst }
}

describe('drawing an outline', () => {
  test('is a quadratic through every point of the ring, from middle to middle', () => {
    const said: string[] = []
    traceInk(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      {
        moveTo: (x, y) => said.push(`M ${x} ${y}`),
        quadraticCurveTo: (cx, cy, x, y) => said.push(`Q ${cx} ${cy} ${x} ${y}`),
        closePath: () => said.push('Z'),
      },
    )

    expect(said).toEqual(['M 5 5', 'Q 0 0 5 0', 'Q 10 0 10 5', 'Q 10 10 5 5', 'Z'])
  })

  test('a ring with no room inside it is not drawn at all', () => {
    const said: string[] = []
    const sink = {
      moveTo: () => said.push('M'),
      quadraticCurveTo: () => said.push('Q'),
      closePath: () => said.push('Z'),
    }

    traceInk([], sink)
    traceInk(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      sink,
    )

    expect(said).toEqual([])
  })

  /** The bug this replaced: a stroke was drawn as straight lines between the
   *  points of its outline, which is invisible under the nib, where there are
   *  hundreds of them, and unmistakable the moment it lands with a fraction of
   *  them left. A curve of no corners must be drawn with none. */
  test('leaves no corner in a curve however few points it has left', () => {
    const one = stroke(arc(400), { size: 6 })
    const few = tidied(one)
    expect(few.points.length).toBeLessThan(one.points.length / 2)

    const turns = corners(drawn(outlineOf(few)))
    expect(turns).toBeLessThan(0.2)
  })
})

/** The sharpest turn anywhere along a shape, in radians, ignoring the two ends
 *  of the stroke where a cap really does turn back on itself. */
function corners(shape: Point[]): number {
  let sharpest = 0

  for (let one = 2; one < shape.length; one++) {
    const before = shape[one - 2]
    const at = shape[one - 1]
    const after = shape[one]
    if (!before || !at || !after) continue

    const into = Math.atan2(at.y - before.y, at.x - before.x)
    const outOf = Math.atan2(after.y - at.y, after.x - at.x)
    let turn = Math.abs(outOf - into)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    // A cap doubles back; only the body of the stroke is being measured.
    if (turn > 2) continue

    sharpest = Math.max(sharpest, turn)
  }

  return sharpest
}

describe('a stroke written down against the stroke that was drawn', () => {
  /** What the reader sees is the outline, so that is what has to survive being
   *  written down: the same curve, within a fraction of a plane unit, for every
   *  pen on the bar.
   *
   *  Every tool at three sizes, outlined and rasterised twice each: the heaviest test
   *  in the file, most of a second alone and past the project's thirty under a whole
   *  gate on a busy machine. So it carries a budget of its own - a wall a slow honest
   *  run must not hit, not a claim about how long it takes. */
  test('paints within a fraction of a unit of it, for every tool', () => {
    for (const tool of INK_TOOLS) {
      for (const size of [3, 8, 18]) {
        const live = stroke(arc(400, 20 * size), { tool, size })
        const gap = apart(drawn(outlineOf(tidied(live))), drawn(outlineOf(live, false)))

        expect(gap.mean, `${tool} ${size}`).toBeLessThan(0.5)
        expect(gap.worst, `${tool} ${size}`).toBeLessThan(2)
      }
    }
  }, 120_000)

  /** The outliner smooths the points it is handed one at a time, so the same
   *  curve used to come out a different shape depending on how many samples the
   *  digitiser happened to report: a hand moving slowly drew a fatter, laggier
   *  line than the same hand moving fast. */
  test('does not depend on how densely the pen was sampled', () => {
    const slow = stroke(arc(600), { size: 6 })
    const fast = stroke(arc(60), { size: 6 })
    const gap = apart(drawn(outlineOf(fast)), drawn(outlineOf(slow)))

    expect(gap.mean).toBeLessThan(0.5)
  })
})

describe('the box a stroke covers', () => {
  test('holds every point, with room for the nib', () => {
    const box = strokeBox(stroke([point(0, 0), point(100, 50)], { size: 10 }))

    expect(box).toEqual({ x: -10, y: -10, width: 120, height: 70 })
  })

  test('round several is the box round the lot', () => {
    const both = bounds(
      [
        stroke([point(0, 0), point(10, 10)], { size: 0 }),
        stroke([point(50, -20), point(60, 0)], { size: 0 }),
      ].map(strokeBox),
    )

    expect(both).toEqual({ x: 0, y: -20, width: 60, height: 30 })
  })
})

describe('smoothing a stroke', () => {
  /** A digitiser reports far more points than a line needs, and the ones it
   *  drops are the ones that say nothing. */
  test('drops the middle of a straight run and keeps both ends', () => {
    const kept = simplified(line(50), 0.5)

    expect(kept).toHaveLength(2)
    expect(kept[0]).toMatchObject({ x: 0 })
    expect(kept.at(-1)).toMatchObject({ x: 49 })
  })

  test('keeps a corner', () => {
    const corner = [...line(10), ...Array.from({ length: 10 }, (_one, i) => point(9, i + 1))]
    const kept = simplified(corner, 0.5)

    expect(kept).toHaveLength(3)
    expect(kept[1]).toMatchObject({ x: 9, y: 0 })
  })

  test('carries the pressure and the tilt of the points it keeps', () => {
    const kept = simplified([point(0, 0, 0.2, 0), point(1, 0, 0.9, 4), point(2, 0, 0.4, 8)], 0.5)

    expect(kept.map((one) => one.pressure)).toEqual([0.2, 0.4])
  })

  test('a stroke of two points is already as short as it goes', () => {
    expect(simplified([point(0, 0), point(1, 1)], 0.5)).toHaveLength(2)
  })

  /** A pen that thins with pressure draws the swell in the middle of a straight
   *  run, and a point dropped from the middle of a swell is the line visibly
   *  losing its width. */
  test('keeps a point the pen leant on, even in the middle of a straight run', () => {
    const leant = [point(0, 0, 0.2), point(1, 0, 0.9), point(2, 0, 0.2)]

    expect(simplified(leant, 0.5)).toHaveLength(2)
    expect(simplified(leant, 0.5, 4)).toHaveLength(3)
  })

  test('tidying uses the nib as the measure, so a fat pen is smoothed harder', () => {
    const wobbly = Array.from({ length: 40 }, (_one, i) => point(i, i % 2 === 0 ? 0 : 0.3))

    expect(tidied(stroke(wobbly, { size: 1 })).points.length).toBeGreaterThan(
      tidied(stroke(wobbly, { size: 20 })).points.length,
    )
  })
})

describe('what a point is near', () => {
  const one = stroke([point(0, 0), point(100, 0)], { size: 4 })

  test('counts the nib, so a fat line is hit where it looks like it is', () => {
    expect(nearStroke(one, { x: 50, y: 1 }, 0)).toBe(true)
    expect(nearStroke(one, { x: 50, y: 20 }, 0)).toBe(false)
    expect(nearStroke(one, { x: 50, y: 20 }, 20)).toBe(true)
  })

  test('is nothing at all a long way off, without walking the whole line', () => {
    expect(nearStroke(one, { x: 5000, y: 5000 }, 5)).toBe(false)
  })
})

describe('the eraser', () => {
  const one = stroke(line(21), { size: 0 })

  test('leaves the stroke exactly as it was when it met nothing', () => {
    expect(erased(one, { x: 500, y: 500 }, 2)).toEqual([one])
    expect(erased(one, { x: 500, y: 500 }, 2)[0]).toBe(one)
  })

  /** The whole point of a partial eraser: rubbing through the middle of a line
   *  leaves the two ends, which is what a stroke eraser deliberately does not
   *  do. */
  test('rubbed through the middle leaves the two ends', () => {
    const pieces = erased(one, { x: 10, y: 0 }, 2)

    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.points.at(-1)?.x).toBe(7)
    expect(pieces[1]?.points[0]?.x).toBe(13)
  })

  test('the first piece keeps the name, so a sync has nothing to argue over', () => {
    expect(erased(one, { x: 10, y: 0 }, 2)[0]?.id).toBe('s')
    expect(erased(one, { x: 10, y: 0 }, 2)[1]?.id).not.toBe('s')
  })

  test('counts each piece from its own beginning', () => {
    const [, second] = erased(one, { x: 10, y: 0 }, 2)
    expect(second?.points[0]?.t).toBe(0)
  })

  test('rubbed off one end shortens the line and leaves one piece', () => {
    expect(erased(one, { x: 0, y: 0 }, 3)).toHaveLength(1)
    expect(erased(one, { x: 0, y: 0 }, 3)[0]?.points[0]?.x).toBe(4)
  })

  test('rubbed over the whole of it leaves nothing', () => {
    expect(erased(one, { x: 10, y: 0 }, 100)).toEqual([])
  })

  /** Two strokes on one plane cannot share a name. An edge names its ends by id,
   *  a merge decides what to keep by id, and reading a file back keeps the first
   *  of a pair - so a second `s-1` is a piece of the drawing that disappears the
   *  next time the canvas is opened. */
  test('names a new piece something no other piece is called', () => {
    const [, second] = erased(one, { x: 10, y: 0 }, 2)
    const again = erased(one, { x: 10, y: 0 }, 2)[1]

    expect(second?.id).not.toBe(again?.id)
    expect(second?.id).not.toBe('s')
  })

  test('a speck with nothing to draw between is not ink', () => {
    // Two points left either side would each be one point on their own.
    expect(
      erased(stroke([point(0, 0), point(10, 0), point(20, 0)], { size: 0 }), { x: 10, y: 0 }, 2),
    ).toEqual([])
  })
})

describe('the lasso', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  test('knows what is inside a loop', () => {
    expect(insidePolygon(square, { x: 50, y: 50 })).toBe(true)
    expect(insidePolygon(square, { x: 150, y: 50 })).toBe(false)
  })

  /** Half a word dragged away from the other half is the one thing a lasso must
   *  never do. */
  test('catches only a stroke it went right round', () => {
    const inside = stroke([point(10, 10), point(20, 20)], { id: 'in' })
    const half = stroke([point(90, 50), point(140, 50)], { id: 'half' })
    const outside = stroke([point(200, 200), point(210, 210)], { id: 'out' })

    expect(strokesInLasso([inside, half, outside], square)).toEqual(['in'])
  })

  test('a loop of two points has caught nothing', () => {
    expect(strokesInLasso([stroke(line(3))], square.slice(0, 2))).toEqual([])
  })
})

describe('moving and scaling ink', () => {
  const one = stroke([point(0, 0), point(10, 0)], { size: 4 })

  test('carries every point by the same offset', () => {
    const moved = transformed(one, { dx: 5, dy: -3, sx: 1, sy: 1, turn: 0, about: { x: 0, y: 0 } })

    expect(moved.points.map((p) => [p.x, p.y])).toEqual([
      [5, -3],
      [15, -3],
    ])
    expect(moved.size).toBe(4)
  })

  /** Writing pulled to twice the size is writing that was written twice as big,
   *  nib and all. */
  test('grows the nib with the drawing', () => {
    const bigger = transformed(one, { dx: 0, dy: 0, sx: 2, sy: 2, turn: 0, about: { x: 0, y: 0 } })

    expect(bigger.size).toBe(8)
    expect(bigger.points.at(-1)?.x).toBe(20)
  })

  test('takes the smaller of two scales for the nib, since a nib is round', () => {
    const squashed = transformed(one, {
      dx: 0,
      dy: 0,
      sx: 3,
      sy: 1,
      turn: 0,
      about: { x: 0, y: 0 },
    })
    expect(squashed.size).toBe(4)
  })

  test('turns about a point', () => {
    const turned = transformed(one, {
      dx: 0,
      dy: 0,
      sx: 1,
      sy: 1,
      turn: Math.PI / 2,
      about: { x: 0, y: 0 },
    })

    expect(turned.points.at(-1)?.x).toBeCloseTo(0)
    expect(turned.points.at(-1)?.y).toBeCloseTo(10)
  })

  test('keeps the pressure and the tilt, which belong to the pen not the plane', () => {
    const moved = transformed(stroke([point(0, 0, 0.9), point(1, 1, 0.2)]), {
      dx: 100,
      dy: 0,
      sx: 2,
      sy: 2,
      turn: 0,
      about: { x: 0, y: 0 },
    })

    expect(moved.points.map((p) => p.pressure)).toEqual([0.9, 0.2])
  })
})

describe('what a held pen meant to draw', () => {
  test('a nearly straight stroke is a line', () => {
    const nearly = Array.from({ length: 20 }, (_one, i) => point(i * 5, i % 3 === 0 ? 0.4 : -0.4))
    expect(assisted(stroke(nearly, { size: 2 }))).toBe('line')
  })

  test('a wandering stroke is left alone', () => {
    const wandering = Array.from({ length: 20 }, (_one, i) => point(i * 5, Math.sin(i) * 30))
    expect(assisted(stroke(wandering, { size: 2 }))).toBeNull()
  })

  test('a closed round stroke is an ellipse', () => {
    const ring = Array.from({ length: 40 }, (_one, i) => {
      const a = (i / 39) * Math.PI * 2
      return point(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50)
    })

    expect(assisted(stroke(ring, { size: 2 }))).toBe('ellipse')
  })

  test('a closed cornered stroke is a rectangle', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]
    const box: InkPoint[] = []
    for (let side = 1; side < corners.length; side++) {
      const from = corners[side - 1]!
      const to = corners[side]!
      for (let step = 0; step < 10; step++) {
        box.push(
          point(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10),
        )
      }
    }

    expect(assisted(stroke(box, { size: 2 }))).toBe('rectangle')
  })

  test('a scribble too short to mean anything is left alone', () => {
    expect(assisted(stroke(line(4), { size: 20 }))).toBeNull()
  })

  test('the tidied shape has the same ink and an even pressure', () => {
    const nearly = Array.from({ length: 20 }, (_one, i) => point(i * 5, i % 3 === 0 ? 0.4 : -0.4))
    const one = stroke(nearly, { size: 2, color: '#ff0000', tool: 'marker' })
    const tidy = tidyShape(one, 'line')

    expect(tidy.points).toHaveLength(2)
    expect(tidy.color).toBe('#ff0000')
    expect(tidy.tool).toBe('marker')
    expect(new Set(tidy.points.map((p) => p.pressure)).size).toBe(1)
  })

  test('a tidied ring is a ring', () => {
    const ring = Array.from({ length: 40 }, (_one, i) => {
      const a = (i / 39) * Math.PI * 2
      return point(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50)
    })

    const tidy = tidyShape(stroke(ring, { size: 2 }), 'ellipse')
    const middle = { x: 100, y: 100 }
    const radii = tidy.points.map((p) => Math.hypot(p.x - middle.x, p.y - middle.y))

    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1)
  })
})

describe('how much of the colour a stroke lands', () => {
  test('is what the stroke says, when it says', () => {
    expect(inkOpacity(stroke(line(4), { opacity: 0.42 }))).toBe(0.42)
  })

  test('is what the pen is by itself, when the stroke says nothing', () => {
    for (const tool of INK_TOOLS) {
      expect(inkOpacity(stroke(line(4), { tool })), tool).toBe(INK_STYLES[tool].opacity)
    }
  })

  /** The whole point of storing it: a highlighter is translucent by nature, and a
   *  hand that wanted a solid one has to be able to say so. */
  test('lets a highlighter be turned right up and a biro right down', () => {
    expect(inkOpacity(stroke(line(4), { tool: 'highlighter', opacity: 1 }))).toBe(1)
    expect(inkOpacity(stroke(line(4), { tool: 'pen', opacity: 0.1 }))).toBe(0.1)
  })
})

describe('a ring as a path', () => {
  test('is one closed curve through every point of it', () => {
    const d = inkPath(outlineOf(stroke(line(12))))

    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('Q')
    expect(d.endsWith('Z')).toBe(true)
  })

  test('is nothing at all for a ring that encloses nothing', () => {
    expect(inkPath([])).toBe('')
    expect(
      inkPath([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe('')
  })

  test('is rounded to a tenth of a unit, which is finer than any pen is steady', () => {
    const d = inkPath([
      { x: 1.23456, y: 2 },
      { x: 4, y: 5 },
      { x: 6, y: 7 },
    ])

    expect(d).not.toContain('1.23456')
  })
})

/** The one point of the browser's guess at where the nib is going that is worth
 *  drawing.
 *
 *  Emil's report: "the current stroke that I'm writing kind of flashes a bit further
 *  very quickly and just for a sec". That was `getPredictedEvents` drawn whole - a fan
 *  of points twenty or thirty milliseconds ahead which, on every change of direction,
 *  is still pointing the old way. The guess is worth keeping, because it is what puts
 *  the ink under the nib rather than trailing it; what is not worth keeping is anything
 *  that turns a corner or reaches further ahead than the hand itself is moving. */
describe('the guess at where the nib is going', () => {
  const before = point(0, 0)
  const nib = point(10, 0)

  test('is one point at most, however many the browser offered', () => {
    expect(leadPoint(before, nib, [point(12, 0), point(20, 0), point(40, 0)])).toHaveLength(1)
  })

  test('never reaches further ahead than the hand is moving', () => {
    // The hand went ten units; the browser guessed forty ahead.
    const [led] = leadPoint(before, nib, [point(50, 0)])
    expect(led!.x).toBeLessThanOrEqual(20)
    expect(led!.x).toBeGreaterThan(10)
  })

  /** The flash itself. A hand that has just turned back on itself gets a guess that is
   *  still pointing the old way, and drawing it is the tail flicking past the nib. */
  test('is thrown away when it turns a corner', () => {
    // Back on itself, straight across it, and past the forty-five degrees a letter
    // makes in one sample.
    expect(leadPoint(before, nib, [point(-20, 0)])).toEqual([])
    expect(leadPoint(before, nib, [point(10, 40)])).toEqual([])
    expect(leadPoint(before, nib, [point(12, 8)])).toEqual([])
  })

  test('is kept round the curve of a letter, which is not a corner', () => {
    expect(leadPoint(before, nib, [point(14, 3)])).toHaveLength(1)
  })

  test('is nothing at all when there is nothing to guess from', () => {
    expect(leadPoint(undefined, nib, [point(20, 0)])).toEqual([])
    expect(leadPoint(before, undefined, [point(20, 0)])).toEqual([])
    expect(leadPoint(before, nib, [])).toEqual([])
  })

  test('is nothing for a hand that has stopped, or a guess that goes nowhere', () => {
    expect(leadPoint(nib, nib, [point(20, 0)])).toEqual([])
    expect(leadPoint(before, nib, [point(10, 0)])).toEqual([])
  })

  test('carries everything else the sample said, so the ink is drawn as the pen is', () => {
    const [led] = leadPoint(before, nib, [point(14, 0, 0.9, 42)])
    expect(led).toMatchObject({ pressure: 0.9, t: 42 })
  })
})

/** What the ink reads off a pointer event, for every pen there is.
 *
 *  Three platforms say the same two facts two ways each: how hard the nib is pressed,
 *  and which way it leans. Everything past this point reads one representation, so a
 *  stroke drawn with an Apple Pencil and a stroke drawn with an S Pen are the same six
 *  numbers a point and nothing downstream asks which browser it is. */
describe('how hard the pen was pressed, as the ink reads it', () => {
  test('is what the pen said, on a platform with no curve of its own', () => {
    expect(forceOf(0.42, 1)).toBeCloseTo(0.42, 6)
  })

  /** The one thing a platform changes about the ink: Safari reports a lower fraction of
   *  full scale for the same weight of hand, so the middle of the Pencil's range is
   *  lifted; see GAINS in contacts.ts. */
  test('is lifted by a gain below one, and never past the top of the range', () => {
    expect(forceOf(0.25, 0.8)).toBeGreaterThan(0.25)
    expect(forceOf(1, 0.8)).toBe(1)
  })

  /** A mouse, a finger, and a stylus whose digitiser has no pressure at all. A nib that
   *  thins with pressure and is told nought draws a hairline, and a hairline is not what
   *  a mouse should leave on the page. */
  test('is the middle of the range for anything that reports none', () => {
    expect(forceOf(0, 1)).toBe(0.5)
    expect(forceOf(-1, 1)).toBe(0.5)
    expect(forceOf(Number.NaN, 1)).toBe(0.5)
  })
})

describe('which way the pen is leaning, as the ink reads it', () => {
  test('is the two tilts as written, which is what Chromium reports', () => {
    expect(tiltOf({ pressure: 0.5, tiltX: -34, tiltY: 12 })).toEqual({ tiltX: -34, tiltY: 12 })
  })

  test('is level for a pen that reports neither pair', () => {
    expect(tiltOf({ pressure: 0.5, tiltX: 0, tiltY: 0 })).toEqual({ tiltX: 0, tiltY: 0 })
  })

  /** Safari's pair, which for an Apple Pencil is the only one it has: radians up from
   *  the glass, and radians round it from the screen's x axis. The conversion is the one
   *  in the Pointer Events spec. */
  test('is the spherical pair converted, when that is all there is', () => {
    // Straight up: no lean either way.
    expect(tiltOf({ pressure: 0.5, tiltX: 0, tiltY: 0, altitudeAngle: Math.PI / 2 })).toEqual({
      tiltX: 0,
      tiltY: 0,
    })

    // Halfway over towards the right edge of the screen.
    expect(
      tiltOf({ pressure: 0.5, tiltX: 0, tiltY: 0, altitudeAngle: Math.PI / 4, azimuthAngle: 0 }),
    ).toEqual({ tiltX: 45, tiltY: 0 })

    // And the same lean towards the bottom of it.
    expect(
      tiltOf({
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        altitudeAngle: Math.PI / 4,
        azimuthAngle: Math.PI / 2,
      }),
    ).toEqual({ tiltX: 0, tiltY: 45 })
  })

  /** The spec answers a pen lying flat on the glass with five special cases. Holding the
   *  altitude off nought instead agrees with all five to the degree, which is what these
   *  five corners check. */
  test('is a right angle for a pen lying flat on the glass, whichever way it points', () => {
    const flat = (azimuthAngle: number) =>
      tiltOf({ pressure: 0.5, tiltX: 0, tiltY: 0, altitudeAngle: 0, azimuthAngle })

    expect(flat(0)).toEqual({ tiltX: 90, tiltY: 0 })
    expect(flat(Math.PI / 2)).toEqual({ tiltX: 0, tiltY: 90 })
    expect(flat(Math.PI)).toEqual({ tiltX: -90, tiltY: 0 })
    expect(flat((3 * Math.PI) / 2)).toEqual({ tiltX: 0, tiltY: -90 })
    expect(flat(Math.PI / 4)).toEqual({ tiltX: 90, tiltY: 90 })
  })

  test('prefers the tilts when a browser reports both, which Chromium now does', () => {
    expect(
      tiltOf({
        pressure: 0.5,
        tiltX: -34,
        tiltY: 12,
        altitudeAngle: Math.PI / 4,
        azimuthAngle: Math.PI,
      }),
    ).toEqual({ tiltX: -34, tiltY: 12 })
  })
})

describe('one sample of one pen, whatever platform it came from', () => {
  function traits(over: Partial<PenTraits> = {}): PenTraits {
    return {
      shape: 'windows',
      gain: 1,
      coalesced: true,
      predicted: true,
      lean: 'tilt',
      force: 'reported',
      ...over,
    }
  }

  test('is an S Pen: pressure and two tilts, taken as they came', () => {
    expect(
      penFelt(
        { pointerType: 'pen', button: -1, buttons: 1, pressure: 0.7, tiltX: 8, tiltY: -3 },
        traits({ shape: 'android' }),
      ),
    ).toEqual({ pressure: 0.7, tiltX: 8, tiltY: -3 })
  })

  test('is an Apple Pencil: pressure through the gain, and the lean out of two angles', () => {
    const felt = penFelt(
      {
        pointerType: 'pen',
        button: -1,
        buttons: 1,
        pressure: 0.25,
        tiltX: 0,
        tiltY: 0,
        altitudeAngle: Math.PI / 4,
        azimuthAngle: 0,
      },
      traits({ shape: 'apple', gain: 0.8, lean: 'spherical' }),
    )

    expect(felt.tiltX).toBe(45)
    expect(felt.pressure).toBeGreaterThan(0.25)
  })

  /** A USI pen on a Chromebook, reporting a fixed sliver near nought for every sample of
   *  every stroke. Believed, it draws everything anybody ever draws as a hairline; see
   *  `Stylus` in contacts.ts, which is what works out that it is fixed. */
  test('is a USI pen whose pressure says nothing: drawn at the width of the nib', () => {
    expect(
      penFelt(
        { pointerType: 'pen', button: -1, buttons: 1, pressure: 0.03, tiltX: 0, tiltY: 0 },
        traits({ shape: 'chromeos', force: 'flat' }),
      ),
    ).toEqual({ pressure: 0.5, tiltX: 0, tiltY: 0 })
  })

  test('is a finger or a mouse: the middle of the range, level, and no gain', () => {
    for (const pointerType of ['touch', 'mouse']) {
      expect(
        penFelt(
          { pointerType, button: 0, buttons: 1, pressure: 0, tiltX: 40, tiltY: 40 },
          traits({ shape: 'apple', gain: 0.8 }),
        ),
      ).toEqual({ pressure: 0.5, tiltX: 0, tiltY: 0 })
    }
  })
})

/** The samples with the curve through them drawn, for the browsers that report few of
 *  them.
 *
 *  Safari has never had `getCoalescedEvents`, so a stroke there is whatever fitted into
 *  a frame: the same word an S Pen reports two hundred points of comes back as thirty,
 *  and thirty points joined by straight lines is a word with corners in it. */
describe('a stroke reported coarsely', () => {
  test('is left exactly as it came when the samples are close together', () => {
    const dense = line(20)
    expect(smoothed(dense, 4)).toBe(dense)
  })

  test('has points put in where the hand went further than the nib is wide', () => {
    const coarse = [point(0, 0), point(40, 0), point(80, 20), point(120, 60)]
    const out = smoothed(coarse, 4)

    expect(out.length).toBeGreaterThan(coarse.length)
    // Every sample the pen really reported is still in it: this puts points in between
    // them and never moves one.
    for (const one of coarse) {
      expect(out.some((was) => was.x === one.x && was.y === one.y)).toBe(true)
    }
  })

  test('keeps the ends where the pen put them', () => {
    const coarse = [point(0, 0), point(40, 10), point(80, 0)]
    const out = smoothed(coarse, 3)

    expect(out[0]).toEqual(coarse[0])
    expect(out[out.length - 1]).toEqual(coarse[coarse.length - 1])
  })

  /** The point of a curve rather than a chord: the ink bows the way the hand did, and a
   *  straight run stays straight however many points go into it. */
  test('bows through a turn', () => {
    const out = smoothed([point(0, 0), point(40, 0), point(80, 40), point(80, 80)], 4)
    const put = out.filter((one) => one.x > 40 && one.x < 80)

    expect(put.length).toBeGreaterThan(0)
    // Off the straight line between the two samples it was put between.
    expect(put.some((one) => Math.abs(one.y - (one.x - 40)) > 0.5)).toBe(true)
  })

  test('leaves a straight run straight', () => {
    const out = smoothed([point(0, 0), point(40, 0), point(80, 0), point(120, 0)], 4)
    for (const one of out) expect(Math.abs(one.y)).toBeLessThan(0.001)
  })

  test('carries everything the digitiser said along the curve', () => {
    const out = smoothed([point(0, 0, 0.2, 0), point(40, 0, 0.8, 40), point(80, 40, 0.4, 80)], 4)
    const middle = out.filter((one) => one.x > 0 && one.x < 40)

    expect(middle.length).toBeGreaterThan(0)
    for (const one of middle) {
      expect(one.pressure).toBeGreaterThanOrEqual(0.2)
      expect(one.pressure).toBeLessThanOrEqual(0.8)
      expect(one.t).toBeGreaterThanOrEqual(0)
      expect(one.t).toBeLessThanOrEqual(40)
    }
  })

  /** A centripetal spline cannot loop back on itself between two samples, which is the
   *  whole reason it is the one used: a uniform one does exactly that at a sharp turn,
   *  and a loop in the middle of a letter is worse than the corner it was hiding. */
  test('never runs away at a corner', () => {
    const out = smoothed([point(0, 0), point(60, 0), point(0, 6), point(60, 12)], 4)

    for (let one = 1; one < out.length; one++) {
      const from = out[one - 1]
      const to = out[one]
      expect(Number.isFinite(to?.x) && Number.isFinite(to?.y)).toBe(true)
      if (from && to) expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(70)
    }
  })

  test('says nothing about a tap or a stroke of two points', () => {
    const tap = [point(0, 0)]
    expect(smoothed(tap, 4)).toBe(tap)

    const two = [point(0, 0), point(90, 0)]
    expect(smoothed(two, 4)).toBe(two)
  })

  test('leaves two samples in the same place alone rather than dividing by nothing', () => {
    const out = smoothed([point(0, 0), point(0, 0), point(60, 0), point(60, 0)], 4)
    for (const one of out) expect(Number.isFinite(one.x) && Number.isFinite(one.y)).toBe(true)
  })

  /** The whole point of it: a stroke a browser reported a quarter of the samples of
   *  still paints as the curve the hand drew. */
  test('is what the outline is worked out from, so a coarse stroke paints as a curve', () => {
    const coarse = stroke([point(0, 0), point(60, 0), point(120, 40), point(120, 100)])
    expect(outlineOf(coarse).length).toBeGreaterThan(8)
  })
})
