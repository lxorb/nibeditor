import { describe, expect, test, vi } from 'vitest'
import type { NoteGraph } from './graph'
import { paint } from './graph-paint'

/** What the Lines dial actually asks the card for.
 *
 *  Nothing here is a picture: what is asserted is the width of a stroke and how many
 *  of them there are, which is the one thing about the drawing that decides whether
 *  a space of ten thousand links pans at sixty frames a second. A stroke wider than
 *  one of the screen's own pixels leaves Skia's hairline path and is tessellated into
 *  geometry - 23 ms a frame against 4.0 seconds, measured in test/e2e/graph.py - so
 *  the thick step is the same hairline drawn three times a pixel apart instead, and
 *  what it costs is three passes rather than a tessellation. See `LINES` in
 *  graph-paint.ts, which states both numbers. */

/** The path, which only has to remember that something was written into it. */
class FakePath {
  readonly steps: string[] = []
  moveTo() {
    this.steps.push('moveTo')
  }
  lineTo() {
    this.steps.push('lineTo')
  }
  arc() {
    this.steps.push('arc')
  }
  rect() {
    this.steps.push('rect')
  }
  closePath() {
    this.steps.push('closePath')
  }
}

vi.stubGlobal('Path2D', FakePath)

/** One stroke, as the context was asked for it: how wide, in what colour, and how
 *  far the brush had been moved when it landed. */
interface Stroke {
  wide: number
  colour: string
  dx: number
  dy: number
  /** The shapes in the path it stroked, so an empty path reads as the nothing it
   *  is: the drawing hands the card one path per kind whether that kind is in the
   *  picture or not. */
  shapes: string[]
}

/** One fill, as the context was asked for it: in what colour, and what shapes were
 *  in the path it filled. */
interface Fill {
  colour: string
  shapes: string[]
}

/** One name drawn: what it said, and how far up the fade it was. */
interface Label {
  text: string
  alpha: number
}

function context(): {
  strokes: Stroke[]
  fills: Fill[]
  labels: Label[]
  context: CanvasRenderingContext2D
} {
  const strokes: Stroke[] = []
  const fills: Fill[] = []
  const labels: Label[] = []
  let dx = 0
  let dy = 0
  const saved: [number, number][] = []

  const fake = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    clearRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: (path?: Path2D) =>
      fills.push({
        colour: fake.fillStyle,
        shapes: path ? [...(path as unknown as FakePath).steps] : [],
      }),
    fillText: (text: string) =>
      labels.push({ text, alpha: Math.round(fake.globalAlpha * 1000) / 1000 }),
    save: () => saved.push([dx, dy]),
    restore: () => {
      const back = saved.pop() ?? [0, 0]
      dx = back[0]
      dy = back[1]
    },
    translate: (x: number, y: number) => {
      dx += x
      dy += y
    },
    stroke: (path?: Path2D) =>
      strokes.push({
        wide: fake.lineWidth,
        colour: fake.strokeStyle,
        dx,
        dy,
        shapes: path ? [...(path as unknown as FakePath).steps] : [],
      }),
  }

  return { strokes, fills, labels, context: fake as unknown as CanvasRenderingContext2D }
}

/** Two notes and the link between them, which is all a width needs. */
const GRAPH: NoteGraph = {
  nodes: [
    { id: 'A.md', name: 'A', path: 'A.md', degree: 1, tags: [] },
    { id: 'B.md', name: 'B', path: 'B.md', degree: 1, tags: [] },
  ],
  edges: [{ a: 0, b: 1, both: false }],
}

const EDGE = '#111'
const LIT_EDGE = '#222'

/** Everything the drawing asked for, at one line width and one device ratio. */
function painted(
  lines: number,
  ratio: number,
  over: Record<string, unknown> = {},
): { strokes: Stroke[]; fills: Fill[]; labels: Label[] } {
  const { strokes, fills, labels, context: fake } = context()

  paint(fake, {
    graph: (over.graph as NoteGraph | undefined) ?? GRAPH,
    x: Float64Array.from([-20, 20]),
    y: Float64Array.from([0, 0]),
    radii: Float64Array.from([4, 4]),
    camera: { x: 0, y: 0, scale: 1 },
    width: 400,
    height: 300,
    colours: {
      edge: EDGE,
      litEdge: LIT_EDGE,
      node: '#333',
      hollow: '#444',
      current: '#555',
      label: '#666',
      font: 'system-ui',
      groups: [],
    },
    current: -1,
    hovered: -1,
    lit: new Uint8Array(2),
    shown: Uint8Array.from([1, 1]),
    tint: Int8Array.from([-1, -1]),
    arrows: false,
    lines,
    fade: 1,
    ratio,
    ...over,
  })

  return { strokes, fills, labels }
}

const all = (lines: number, ratio: number, over: Record<string, unknown> = {}): Stroke[] =>
  painted(lines, ratio, over).strokes

/** The strokes of the links themselves, told apart from the node rings by the colour
 *  they are drawn in: the drawing hands the card one path per kind. */
function drawn(lines: number, ratio: number, over: Record<string, unknown> = {}): Stroke[] {
  return all(lines, ratio, over).filter((one) => one.colour === EDGE)
}

describe('how wide a link is drawn', () => {
  test('is one of the screen’s pixels at the middle step, whatever the ratio', () => {
    expect(drawn(2, 1).map((one) => one.wide)).toEqual([1])
    expect(drawn(2, 2).map((one) => one.wide)).toEqual([0.5])
    expect(drawn(2, 3).map((one) => one.wide)).toEqual([1 / 3])
  })

  test('and thinner than one at the first, which is still a hairline', () => {
    expect(drawn(1, 2).map((one) => one.wide)).toEqual([0.3])
  })

  /** The whole of why the thick step exists in this shape: a stroke wider than a
   *  device pixel is tessellated, and ten thousand tessellated lines are two frames
   *  a second. */
  test('and never wider than one of the screen’s pixels, at any step', () => {
    for (const step of [1, 2, 3]) {
      for (const ratio of [1, 2, 3]) {
        for (const stroke of drawn(step, ratio)) {
          expect(stroke.wide * ratio, `step ${step} at ratio ${ratio}`).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  test('so thick is the same hairline three times, a device pixel apart', () => {
    const strokes = drawn(3, 2)

    expect(strokes.map((one) => one.wide)).toEqual([0.5, 0.5, 0.5])
    expect(strokes.map((one) => [one.dx, one.dy])).toEqual([
      [0, 0],
      [0.5, 0],
      [0, 0.5],
    ])
  })

  test('and the brush is put back, so nothing after it is drawn offset', () => {
    // The ring a node the space has not got wears is the stroke after the links,
    // and it lands where the picture is rather than a pixel over.
    expect(all(3, 2).at(-1)?.dx).toBe(0)
    expect(all(3, 2).at(-1)?.dy).toBe(0)
  })

  test('and one stroke is all the thinner steps ask for', () => {
    expect(drawn(1, 2)).toHaveLength(1)
    expect(drawn(2, 2)).toHaveLength(1)
  })

  test('and a step nothing wrote reads as the middle one', () => {
    expect(drawn(0, 2).map((one) => one.wide)).toEqual([0.5])
    expect(drawn(99, 2)).toHaveLength(3)
  })

  /** The handful around whatever the pointer is on: a dozen lines rather than ten
   *  thousand, so they can afford the shape the card is handed for them. */
  test('the lit links are wider, which they can afford', () => {
    const lit = all(2, 2, { hovered: 0, lit: Uint8Array.from([2, 1]) })

    expect(lit.filter((one) => one.colour === LIT_EDGE).map((one) => one.wide)).toEqual([1])
  })
})

/** A file a note embeds is a square rather than a dot, which is how the picture
 *  already says a thing is not what its neighbours are: a note the space has not got
 *  is a ring. See `attachment` in graph.ts. */
describe('a file a note embeds', () => {
  const EMBEDS: NoteGraph = {
    nodes: [
      { id: 'A.md', name: 'A', path: 'A.md', degree: 1, tags: [] },
      { id: '!shot.png', name: 'shot.png', path: null, degree: 1, tags: [], attachment: true },
    ],
    edges: [{ a: 0, b: 1, both: false }],
  }

  test('is drawn as a square, where a note is drawn as a dot', () => {
    const { fills } = painted(2, 2, { graph: EMBEDS })

    expect(fills.map((one) => one.shapes)).toContainEqual(['rect'])
    expect(fills.map((one) => one.shapes)).toContainEqual(['moveTo', 'arc'])
  })

  test('and never as the ring a note the space has not got wears', () => {
    const { strokes } = painted(2, 2, { graph: EMBEDS })
    const rings = strokes.filter((one) => one.colour === '#444')

    // The path for those is handed over whether anything is in it or not, so what
    // says the square was not one is that it holds no shape at all.
    expect(rings.flatMap((one) => one.shapes)).toEqual([])
  })

  test('while a space with none of them asks for no square at all', () => {
    const { fills } = painted(2, 2)

    expect(fills.map((one) => one.shapes)).not.toContainEqual(['rect'])
  })
})

/** Where the names fade in. A threshold that follows the zoom, with one dial for
 *  where it sits: one is the zoom the picture has always shown them at, so a dial
 *  nobody has touched changes nothing. See `LABELS_FROM` in graph-paint.ts. */
describe('the names', () => {
  const named = (scale: number, fade: number) =>
    painted(2, 2, { camera: { x: 0, y: 0, scale }, fade }).labels

  test('arrive at the zoom they always have when the dial is untouched', () => {
    // 0.55 is where they start and 0.85 is where they are fully there.
    expect(named(0.5, 1)).toEqual([])
    expect(named(0.6, 1).map((one) => one.text)).toEqual(['A', 'B'])
    expect(named(0.9, 1).map((one) => one.alpha)).toEqual([1, 1])
  })

  test('and fade up between the two rather than appearing at once', () => {
    const half = named(0.7, 1)

    expect(half).toHaveLength(2)
    expect(half[0]?.alpha).toBeGreaterThan(0)
    expect(half[0]?.alpha).toBeLessThan(1)
  })

  test('sooner where the dial asks for it', () => {
    // Half the threshold: a zoom that showed none of them now shows them all.
    expect(named(0.5, 0.5).map((one) => one.alpha)).toEqual([1, 1])
    expect(named(0.3, 0.5).map((one) => one.text)).toEqual(['A', 'B'])
    expect(named(0.2, 0.5)).toEqual([])
  })

  test('and later where it asks for that', () => {
    expect(named(0.9, 2)).toEqual([])
    expect(named(1.2, 2).map((one) => one.text)).toEqual(['A', 'B'])
  })

  test('and a dial nothing wrote reads as the zoom they always had', () => {
    expect(named(0.5, 0)).toEqual([])
    expect(named(0.6, 0).map((one) => one.text)).toEqual(['A', 'B'])
  })
})
