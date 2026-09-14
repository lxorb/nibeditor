import { describe, expect, test } from 'vitest'
import {
  type Camera,
  CLOSEST,
  clampScale,
  framing,
  FURTHEST,
  graphPoint,
  nodeAt,
  NOTCH,
  SMALLEST_DOT,
  wheelZoom,
  zoomed,
} from './camera'

const WIDTH = 400
const HEIGHT = 300

const at = (...values: number[]) => new Float64Array(values)

/** The transform the paint uses, so a test can say where a node is drawn without
 *  the canvas being there. */
function screenPoint(camera: Camera, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.scale + WIDTH / 2,
    y: (y - camera.y) * camera.scale + HEIGHT / 2,
  }
}

describe('where the graph is looked at from', () => {
  test('the middle of the view is the point the camera is on', () => {
    const camera: Camera = { x: 40, y: -20, scale: 2 }

    expect(graphPoint(camera, WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2)).toEqual({ x: 40, y: -20 })
  })

  test('a screen point and a graph point say the same thing both ways round', () => {
    const camera: Camera = { x: 12, y: 8, scale: 1.7 }
    const point = graphPoint(camera, WIDTH, HEIGHT, 310, 60)
    const back = screenPoint(camera, point.x, point.y)

    expect(back.x).toBeCloseTo(310)
    expect(back.y).toBeCloseTo(60)
  })

  test('framing puts every node on screen, with room around it', () => {
    const x = at(-500, 500, 0)
    const y = at(-300, 300, 0)
    const camera = framing(x, y, 3, WIDTH, HEIGHT, 24)

    for (let one = 0; one < 3; one++) {
      const point = screenPoint(camera, x[one] ?? 0, y[one] ?? 0)
      expect(point.x).toBeGreaterThanOrEqual(23)
      expect(point.x).toBeLessThanOrEqual(WIDTH - 23)
      expect(point.y).toBeGreaterThanOrEqual(23)
      expect(point.y).toBeLessThanOrEqual(HEIGHT - 23)
    }
  })

  test('framing centres on the middle of what there is', () => {
    const camera = framing(at(100, 200), at(-40, 40), 2, WIDTH, HEIGHT, 24)

    expect(camera.x).toBe(150)
    expect(camera.y).toBe(0)
  })

  test('framing does not blow a small graph up to fill the view', () => {
    expect(framing(at(-5, 5), at(-5, 5), 2, WIDTH, HEIGHT, 24).scale).toBe(1)
  })

  test('framing nothing is a camera that still works', () => {
    expect(framing(at(), at(), 0, WIDTH, HEIGHT, 24)).toEqual({ x: 0, y: 0, scale: 1 })
  })

  test('the view goes only so far in and so far out', () => {
    expect(clampScale(1000)).toBe(CLOSEST)
    expect(clampScale(0)).toBe(FURTHEST)
    expect(clampScale(1.5)).toBe(1.5)
  })
})

describe('scrolling to zoom', () => {
  test('keeps whatever was under the pointer under it', () => {
    const camera: Camera = { x: 0, y: 0, scale: 1 }
    const under = graphPoint(camera, WIDTH, HEIGHT, 340, 40)

    const closer = zoomed(camera, WIDTH, HEIGHT, 340, 40, 1.4)
    const still = screenPoint(closer, under.x, under.y)

    expect(closer.scale).toBeCloseTo(1.4)
    expect(still.x).toBeCloseTo(340)
    expect(still.y).toBeCloseTo(40)
  })

  test('and does the same on the way back out', () => {
    const camera: Camera = { x: 30, y: -70, scale: 2.2 }
    const under = graphPoint(camera, WIDTH, HEIGHT, 90, 260)

    const further = zoomed(camera, WIDTH, HEIGHT, 90, 260, 0.5)
    const still = screenPoint(further, under.x, under.y)

    expect(still.x).toBeCloseTo(90)
    expect(still.y).toBeCloseTo(260)
  })

  test('never past the ends', () => {
    const camera: Camera = { x: 0, y: 0, scale: CLOSEST }

    expect(zoomed(camera, WIDTH, HEIGHT, 0, 0, 10).scale).toBe(CLOSEST)
  })
})

/** One notch, everywhere.
 *
 *  The bar's own comment said the buttons and the wheel agree, and they did not:
 *  the buttons stepped by a fifth, the plane's wheel by two fifths and a page
 *  note's by a quarter, so a reader who zoomed with one and then the other felt
 *  three different surfaces. `wheelZoom` is what both of them ask now. */
describe('one notch of a zoom', () => {
  test('is the same for a wheel notch as for a button', () => {
    expect(wheelZoom(-100)).toBeCloseTo(NOTCH, 10)
    expect(wheelZoom(100)).toBeCloseTo(1 / NOTCH, 10)
  })

  test('and nothing at all for a wheel that did not move', () => {
    expect(wheelZoom(0)).toBe(1)
  })

  /** A trackpad sends dozens of small deltas where a wheel sends one notch, which
   *  is the whole reason this is an exponential: the same distance travelled comes
   *  to the same zoom however it arrived. */
  test('so a trackpad’s many small ones multiply up to the same thing', () => {
    let scale = 1
    for (let step = 0; step < 20; step++) scale *= wheelZoom(-5)

    expect(scale).toBeCloseTo(NOTCH, 10)
  })

  test('up is bigger, the way round every platform reads it', () => {
    expect(wheelZoom(-100)).toBeGreaterThan(1)
    expect(wheelZoom(100)).toBeLessThan(1)
  })
})

describe('what is under the pointer', () => {
  // Three nodes: two well apart, and one right beside the first.
  const x = at(0, 100, 4)
  const y = at(0, 0, 0)
  const radii = at(6, 6, 6)
  const camera: Camera = { x: 0, y: 0, scale: 1 }

  const hit = (screenX: number, screenY: number, slack = 3) =>
    nodeAt(x, y, radii, camera, WIDTH, HEIGHT, screenX, screenY, slack)

  test('the node the point is on', () => {
    expect(hit(WIDTH / 2 + 100, HEIGHT / 2)).toBe(1)
  })

  test('nothing, where there is nothing', () => {
    expect(hit(WIDTH / 2 + 50, HEIGHT / 2)).toBe(-1)
  })

  test('the nearer of two that overlap', () => {
    // A point three to the right of the first node is nearer it than the one at
    // four, and both circles cover it.
    expect(hit(WIDTH / 2 + 1, HEIGHT / 2)).toBe(0)
    expect(hit(WIDTH / 2 + 6, HEIGHT / 2)).toBe(2)
  })

  test('a little past the edge still counts, so a hand can hit a dot', () => {
    expect(hit(WIDTH / 2 + 108, HEIGHT / 2)).toBe(1)
    expect(hit(WIDTH / 2 + 120, HEIGHT / 2)).toBe(-1)
  })

  test('a node is a smaller target the further out the view is', () => {
    const far: Camera = { x: 0, y: 0, scale: 0.1 }
    // The second node is drawn ten units from the first at this scale, and its
    // circle is under a pixel across, so a point between them hits neither.
    expect(nodeAt(x, y, radii, far, WIDTH, HEIGHT, WIDTH / 2 + 5, HEIGHT / 2, 0)).toBe(-1)
    expect(nodeAt(x, y, radii, far, WIDTH, HEIGHT, WIDTH / 2 + 10, HEIGHT / 2, 0)).toBe(1)
  })

  test('a dot never shrinks below something a pointer can find', () => {
    const far: Camera = { x: 0, y: 0, scale: 0.0001 }

    expect(
      nodeAt(at(0), at(0), at(6), far, WIDTH, HEIGHT, WIDTH / 2 + SMALLEST_DOT, HEIGHT / 2, 0),
    ).toBe(0)
  })

  test('the camera moving moves what is under the pointer', () => {
    const shifted: Camera = { x: 100, y: 0, scale: 1 }

    expect(nodeAt(x, y, radii, shifted, WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2)).toBe(1)
  })

  test('nothing at all, in an empty graph', () => {
    expect(nodeAt(at(), at(), at(), camera, WIDTH, HEIGHT, 10, 10)).toBe(-1)
  })
})
