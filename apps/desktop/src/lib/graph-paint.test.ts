import { describe, expect, test, vi } from 'vitest'
import type { NoteGraph } from './graph'
import { paint } from './graph-paint'

/** What the Lines dial actually asks the card for.
 *
 *  Nothing here is a picture: what is asserted is the width of a stroke and how many
 *  of them there are, which is the one thing about the drawing that decides whether
 *  a space of ten thousand links pans at sixty frames a second. A stroke wider than
 *  one of the screen's own pixels leaves Skia's hairline path and is tessellated into
 *  geometry - 20 ms a frame against 3.6 seconds, measured in test/e2e/graph.py - so
 *  the thick step is the same hairline drawn three times a pixel apart instead. See
 *  `LINES` in graph-paint.ts. */

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
}

function context(): { strokes: Stroke[]; context: CanvasRenderingContext2D } {
  const strokes: Stroke[] = []
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
    fill: () => undefined,
    fillText: () => undefined,
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
    stroke: () => strokes.push({ wide: fake.lineWidth, colour: String(fake.strokeStyle), dx, dy }),
  }

  return { strokes, context: fake as unknown as CanvasRenderingContext2D }
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

/** Every stroke the drawing asked for, at one line width and one device ratio. */
function all(lines: number, ratio: number, over: Record<string, unknown> = {}): Stroke[] {
  const { strokes, context: fake } = context()

  paint(fake, {
    graph: GRAPH,
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
    ratio,
    ...over,
  })

  return strokes
}

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
