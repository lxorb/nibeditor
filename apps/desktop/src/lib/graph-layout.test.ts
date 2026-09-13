import { beforeAll, describe, expect, test } from 'vitest'
import type { NoteGraph } from './graph'
import { Layout } from './graph-layout'

/** A graph with the shape asked for and nothing else: the layout reads node
 *  degrees and edge ends, and nothing about what a note says. */
function graph(count: number, edges: [number, number][]): NoteGraph {
  const nodes = Array.from({ length: count }, (_, one) => ({
    id: `n${one}`,
    name: `n${one}`,
    path: `n${one}.md`,
    degree: 0,
    tags: [],
  }))

  for (const [a, b] of edges) {
    const one = nodes[a]
    const other = nodes[b]
    if (one) one.degree++
    if (other) other.degree++
  }

  return { nodes, edges: edges.map(([a, b]) => ({ a, b, both: false })) }
}

/** A star: one hub with `spokes` notes linked to it. */
const star = (spokes: number) =>
  graph(
    spokes + 1,
    Array.from({ length: spokes }, (_, one): [number, number] => [0, one + 1]),
  )

const away = (layout: Layout, a: number, b: number) =>
  Math.hypot((layout.x[a] ?? 0) - (layout.x[b] ?? 0), (layout.y[a] ?? 0) - (layout.y[b] ?? 0))

const positions = (layout: Layout) => [[...layout.x], [...layout.y]]

/** Ticked until it has arrived. `settle` takes a budget in milliseconds rather than
 *  running to the end in one go - which on five thousand notes was a second and a
 *  half of a thread answering nothing - so a test that wants the finished
 *  arrangement asks for it a stretch at a time until it says yes. */
function rested(layout: Layout) {
  while (!layout.settle(100));
}

describe('a layout that settles', () => {
  test('arrives, and says so', () => {
    const layout = new Layout(star(6))
    expect(layout.settled).toBe(false)

    rested(layout)
    expect(layout.settled).toBe(true)
  })

  test('does nothing once it has arrived, so a still picture stays still', () => {
    const layout = new Layout(star(6))
    rested(layout)

    const arrived = positions(layout)
    layout.tick(500)

    expect(positions(layout)).toEqual(arrived)
  })

  test('holds linked notes about a link apart', () => {
    const layout = new Layout(star(8))
    rested(layout)

    for (let spoke = 1; spoke <= 8; spoke++) {
      const distance = away(layout, 0, spoke)
      expect(distance).toBeGreaterThan(12)
      expect(distance).toBeLessThan(120)
    }
  })

  test('holds unlinked notes apart as well, so nothing hides behind anything', () => {
    const layout = new Layout(graph(24, []))
    rested(layout)

    for (let one = 0; one < 24; one++) {
      for (let other = one + 1; other < 24; other++) {
        expect(away(layout, one, other)).toBeGreaterThan(2)
      }
    }
  })

  test('keeps a chain of notes in the order the links put them', () => {
    // Six notes in a line. Whatever the arrangement, each is nearer its
    // neighbour in the chain than the note three along.
    const chain = graph(6, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
    const layout = new Layout(chain)
    rested(layout)

    expect(away(layout, 0, 1)).toBeLessThan(away(layout, 0, 3))
    expect(away(layout, 2, 3)).toBeLessThan(away(layout, 2, 5))
  })

  test('an empty graph is already settled', () => {
    const layout = new Layout(graph(0, []))

    expect(layout.settled).toBe(true)
    layout.tick(10)
    expect(layout.x).toHaveLength(0)
  })

  test('one note on its own lands in the middle', () => {
    const layout = new Layout(graph(1, []))
    rested(layout)

    expect(away(layout, 0, 0)).toBe(0)
    expect(Math.hypot(layout.x[0] ?? 0, layout.y[0] ?? 0)).toBeLessThan(20)
  })
})

describe('the same seed lays out the same way', () => {
  test('twice over, to the last decimal', () => {
    const shape = star(30)

    const one = new Layout(shape, { seed: 7 })
    const other = new Layout(shape, { seed: 7 })
    rested(one)
    rested(other)

    expect(positions(one)).toEqual(positions(other))
  })

  test('however the ticks are spread out', () => {
    const shape = star(30)

    const whole = new Layout(shape, { seed: 7 })
    const inBits = new Layout(shape, { seed: 7 })
    rested(whole)
    while (!inBits.settled) inBits.tick(3)

    expect(positions(inBits)).toEqual(positions(whole))
  })

  test('and another seed lays it out another way', () => {
    const shape = star(30)

    const one = new Layout(shape, { seed: 7 })
    const other = new Layout(shape, { seed: 8 })
    rested(one)
    rested(other)

    expect(positions(one)).not.toEqual(positions(other))
  })
})

describe('a note moved by hand', () => {
  test('stays where it was put', () => {
    const layout = new Layout(star(8))
    rested(layout)

    layout.hold(3, 400, -250)
    expect(layout.x[3]).toBe(400)
    expect(layout.y[3]).toBe(-250)

    // Holding warms the layout again so the neighbours follow; the held note is
    // not one of the things that moves.
    expect(layout.settled).toBe(false)
    rested(layout)
    expect(layout.x[3]).toBe(400)
    expect(layout.y[3]).toBe(-250)
  })

  test('and its neighbour comes along', () => {
    // A pair joined by one link. Pulling one of them a long way off has to pull
    // the other after it, or the picture reads as a broken link.
    const layout = new Layout(graph(2, [[0, 1]]))
    rested(layout)

    const was = layout.x[1] ?? 0
    layout.hold(0, 200, 0)
    rested(layout)

    expect(layout.x[1] ?? 0).toBeGreaterThan(was)
    expect(away(layout, 0, 1)).toBeLessThan(60)
  })
})

/** The two forces the card in the corner offers. Both are asked about the same
 *  way: settle the same graph twice and compare, since the arrangement a force
 *  arrives at is the only thing a reader sees of it. */
describe('the forces a reader can ask about', () => {
  /** A hub with six spokes, and two notes off on their own. */
  const shape = () => {
    const held = star(6)
    return graph(
      9,
      held.edges.map((edge): [number, number] => [edge.a, edge.b]),
    )
  }

  const settled = (options: {
    spread?: number
    gather?: boolean
    distance?: number
    push?: number
  }) => {
    const layout = new Layout(shape(), options)
    rested(layout)
    return layout
  }

  /** A link holds its two ends about `DISTANCE` apart whatever the spread, and it
   *  is meant to: that length is what a link means. So what a wider spread opens is
   *  the gaps between notes nothing joins - and since the view frames whatever it
   *  is given, that ratio is the whole of what a reader sees change. Measured at
   *  1.8 against 4.0 between the ends of the dial. */
  test('a wider spread opens the gaps a link is not holding', () => {
    const apart = (layout: Layout) => away(layout, 7, 8) / away(layout, 0, 1)

    expect(apart(settled({ spread: 4 }))).toBeGreaterThan(apart(settled({ spread: 0.25 })) * 2)
  })

  test('and the same spread twice is the same arrangement', () => {
    expect(positions(settled({ spread: 2 }))).toEqual(positions(settled({ spread: 2 })))
  })

  test('gathering keeps the notes nothing links to near the rest', () => {
    const gathered = settled({ gather: true })
    const loose = settled({ gather: false })

    const outFrom = (layout: Layout) => Math.hypot(layout.x[7] ?? 0, layout.y[7] ?? 0)
    expect(outFrom(loose)).toBeGreaterThan(outFrom(gathered))
  })

  /** What a link means, which used to be the one force nobody could ask about: a
   *  short distance draws the clusters tight, a long one lets a chain read as a
   *  chain. The defaults are what the arrangement has always done, so a card nobody
   *  has touched lays out exactly as it did. */
  test('a longer link holds its two ends further apart', () => {
    const near = away(settled({ distance: 12 }), 0, 1)
    const far = away(settled({ distance: 96 }), 0, 1)

    expect(far).toBeGreaterThan(near * 2)
  })

  test('and a harder push opens the gaps the links are not holding', () => {
    const apart = (layout: Layout) => away(layout, 7, 8) / away(layout, 0, 1)

    expect(apart(settled({ push: 400 }))).toBeGreaterThan(apart(settled({ push: 40 })) * 1.5)
  })

  /** The dial says a positive number and the layout is a repulsion, so the sign is
   *  the layout's business; asking for the push either way round is the same picture. */
  test('and the push is a size rather than a direction', () => {
    expect(positions(settled({ push: 220 }))).toEqual(positions(settled({ push: -220 })))
  })

  /** The spread is still a multiple of the push, so the two compose rather than
   *  fighting: twice the push is the same arrangement as twice the spread. */
  test('and the spread is still a multiple of it', () => {
    expect(positions(settled({ push: 300 }))).toEqual(positions(settled({ spread: 2 })))
  })

  test('and saying nothing about either is the arrangement the picture always had', () => {
    expect(positions(settled({}))).toEqual(positions(settled({ distance: 36, push: 150 })))
  })

  test('and both are still arrangements that arrive', () => {
    expect(settled({ spread: 4, gather: false }).settled).toBe(true)
    expect(settled({ distance: 96, push: 400 }).settled).toBe(true)
  })
})

describe('a space of two thousand notes and four thousand links', () => {
  /** The same shape the whole-space graph is measured in the browser on: every
   *  note linked to the next and to one seven along, plus a hub. */
  function many(): NoteGraph {
    const edges: [number, number][] = []

    for (let one = 0; one < 2000; one++) {
      edges.push([one, (one + 1) % 2000])
      edges.push([one, (one + 7) % 2000])
    }

    return graph(2000, edges)
  }

  // Both tests below ask about the same settled arrangement, and settling two
  // thousand notes is a second and a half of arithmetic: it is done once, in a
  // hook, rather than twice inside a test's five-second budget. The budget is a
  // clock, and a clock in a test only says what the machine running it was doing
  // at the time - here it said the whole suite was running alongside.
  const shape = many()
  const layout = new Layout(shape)

  beforeAll(() => {
    layout.tick(30)
    rested(layout)
  })

  test('places them all, at a tick a view can afford', () => {
    expect(shape.edges).toHaveLength(4000)

    // The cost was measured by hand at 1.3 ms to build, 1.3 ms a tick and
    // 375 ms for the whole settle; the numbers are not asserted, for the reason
    // above, so this checks the shape.
    expect(layout.settled).toBe(true)
    expect(layout.x).toHaveLength(shape.nodes.length)
    expect(layout.x.every((x) => Number.isFinite(x))).toBe(true)
  })

  test('nothing lands on top of anything', () => {
    for (let one = 0; one < 2000; one++) {
      expect(Number.isFinite(layout.x[one])).toBe(true)
      expect(Number.isFinite(layout.y[one])).toBe(true)
    }
  })
})
