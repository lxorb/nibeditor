/** Where the nodes of a graph end up: a force layout that settles and then
 *  stops.
 *
 *  Three forces, the usual ones. Linked notes are held a fixed distance apart,
 *  every note pushes every other away, and a weak pull towards the middle keeps
 *  the notes nothing links to from drifting off for ever. All three are the reader's,
 *  from one Forces group on the graph's card: how far apart a link holds two notes,
 *  how hard the notes push, how much more of that push than the arrangement does
 *  unasked, and whether the middle pulls at all. A cooling factor shrinks all three
 *  by the same amount each tick, so the picture arrives at an arrangement and holds
 *  it: once the factor is spent, `tick` does nothing at all, which is what keeps a
 *  graph nobody is touching off the processor.
 *
 *  Pushing every note away from every other is the expensive half - two thousand
 *  notes are four million pairs a tick, which no frame has room for. So the
 *  notes are sorted into a quadtree each tick and a square far enough away is
 *  answered as one body at its centre of mass, the Barnes-Hut approximation.
 *  That turns the tick into n log n: measured at 1.3 ms for two thousand notes
 *  and four thousand links, against 17 ms for the honest sum. The view spends
 *  what a frame has to spare on ticks and no more, so a large space settles over
 *  about a second of animation without ever dropping a frame.
 *
 *  Written here rather than taken from d3-force: the forces are forty lines of
 *  it, the quadtree another hundred, and this way the layout is seeded rather
 *  than random, which is what lets a test say a graph lays out the same way
 *  twice. No dependency, and nothing in it that the app does not use. */

import type { NoteGraph } from './graph'

/** How far apart two linked notes want to sit, in graph units, where the card has
 *  not said. The card's Link distance dial starts here. */
const DISTANCE = 36
/** How hard notes push each other apart, before the reader's own spread is
 *  applied, where the card has not said. Negative, being a repulsion; the dial on the
 *  card says the same number the other way up, because a reader asking for more push
 *  is asking for a bigger number. */
const REPULSION = -150
/** The pull towards the middle, as a fraction of the distance from it. */
const GRAVITY = 0.055
/** How much of its speed a node keeps between ticks. Friction, so the
 *  arrangement comes to rest rather than oscillating around it. */
const KEPT_SPEED = 0.6
/** Where the cooling factor counts as spent. */
const COLD = 0.001
/** How many ticks a settle from cold to spent takes, which is what the cooling
 *  rate is derived from. Three hundred is a little over a third of a second of
 *  animation at eight ticks a frame. */
const TICKS = 300
const COOLING = 1 - Math.pow(COLD, 1 / TICKS)

/** How many ticks `settle` takes between looks at the clock. Small enough that a
 *  budget is kept to on a space large enough for one tick to be milliseconds, large
 *  enough that the clock is not most of the work on a small one. */
const SETTLING_TICKS = 4
/** How warm a drag makes the layout again: enough for the neighbours of the node
 *  being moved to follow it, not enough to rearrange the picture. */
const DRAG_WARMTH = 0.3

/** How far a square may be, as a fraction of its width, before it is answered as
 *  one body rather than looked into. Barnes-Hut's theta. */
const THETA_SQUARED = 0.81
/** Two notes in the same place would push each other infinitely hard. */
const NEAREST_SQUARED = 1
/** How deep the quadtree may go. A thousand notes written at the same position
 *  would otherwise divide for ever. */
const DEEPEST = 24
/** How many notes a square holds before it divides. */
const IN_A_LEAF = 4

/** The phyllotactic spiral d3 starts a simulation from: no two notes in the same
 *  place, and no direction preferred. */
const SPIRAL = Math.PI * (3 - Math.sqrt(5))
const SPIRAL_STEP = 12

/** Small, fast, and the same sequence for the same seed. Only the starting
 *  arrangement asks for it, so nothing here needs more than that. */
function random(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let z = Math.imul(state ^ (state >>> 15), 1 | state)
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

export interface LayoutOptions {
  /** Which starting arrangement to lay out from. The same seed lays the same
   *  graph out the same way, every run and on every machine. */
  seed?: number
  /** How hard the notes push each other away, as a multiple of what they do on
   *  their own. One is the arrangement the layout arrives at unasked; below it the
   *  picture balls up, above it the clusters come apart and the links stretch.
   *
   *  The repulsion alone rather than the link distance with it: scaling both would
   *  blow the whole arrangement up by the same amount, and a view that frames what
   *  it is given would draw the identical picture. What a reader wants from a dial
   *  called spread is for the clumps to separate, and that is this ratio. */
  spread?: number
  /** Whether the pull towards the middle is on. Off, the notes nothing links to
   *  drift out as far as the cooling lets them rather than sitting in a ring, which
   *  is what a reader looking at the connected middle of a space wants. */
  gather?: boolean
  /** How far apart two linked notes want to sit, in graph units. `DISTANCE` where
   *  nothing says: what a link means, which used to be the one force nobody could
   *  ask about. A short distance draws the clusters tight and a long one lets a chain
   *  of notes read as a chain. */
  distance?: number
  /** How hard every note pushes every other away, as the positive number the card's
   *  dial says: the layout turns it round, being a repulsion. `spread` is still a
   *  multiple of it, so the two compose - this is what the arrangement does unasked,
   *  and that is how much more of it the reader wants. */
  push?: number
}

export class Layout {
  readonly x: Float64Array
  readonly y: Float64Array

  private readonly vx: Float64Array
  private readonly vy: Float64Array
  /** Where a node is being held, for one under the pointer. */
  private readonly held: Uint8Array
  private readonly heldX: Float64Array
  private readonly heldY: Float64Array

  /** Edge ends, and the two numbers the spring between them is scaled by:
   *  `pull` shares the correction out so a hub is not dragged around by each of
   *  its many links, and `bias` gives the less connected end more of the move. */
  private readonly from: Int32Array
  private readonly to: Int32Array
  private readonly pull: Float64Array
  private readonly bias: Float64Array

  private readonly count: number
  private warmth = 1
  /** The forces a reader can ask about, settled at construction: the layout is built
   *  afresh when any of them changes, since an arrangement half laid out under one
   *  spread and half under another is neither. */
  private readonly repulsion: number
  private readonly gravity: number
  private readonly distance: number

  constructor(graph: NoteGraph, options: LayoutOptions = {}) {
    const count = graph.nodes.length
    this.count = count
    // The card says how hard the notes push as a positive number, and the spread is
    // still a multiple of it: one is what the arrangement does unasked.
    this.repulsion = -Math.abs(options.push ?? -REPULSION) * (options.spread ?? 1)
    this.gravity = options.gather === false ? 0 : GRAVITY
    this.distance = options.distance ?? DISTANCE

    this.x = new Float64Array(count)
    this.y = new Float64Array(count)
    this.vx = new Float64Array(count)
    this.vy = new Float64Array(count)
    this.held = new Uint8Array(count)
    this.heldX = new Float64Array(count)
    this.heldY = new Float64Array(count)

    const next = random(options.seed ?? 1)
    for (let one = 0; one < count; one++) {
      // The spiral gives the arrangement its shape; the seed turns it, so two
      // seeds settle differently and one seed settles the same way twice.
      const radius = SPIRAL_STEP * Math.sqrt(0.5 + one)
      const angle = one * SPIRAL + next() * 2 * Math.PI
      this.x[one] = radius * Math.cos(angle)
      this.y[one] = radius * Math.sin(angle)
    }

    const edges = graph.edges.length
    this.from = new Int32Array(edges)
    this.to = new Int32Array(edges)
    this.pull = new Float64Array(edges)
    this.bias = new Float64Array(edges)

    for (let edge = 0; edge < edges; edge++) {
      const one = graph.edges[edge]
      if (!one) continue

      const here = Math.max(1, graph.nodes[one.a]?.degree ?? 1)
      const there = Math.max(1, graph.nodes[one.b]?.degree ?? 1)

      this.from[edge] = one.a
      this.to[edge] = one.b
      this.pull[edge] = 1 / Math.min(here, there)
      this.bias[edge] = here / (here + there)
    }

    this.stack = new Int32Array(4 * DEEPEST + 8)
    this.order = new Int32Array(count)
    this.scratch = new Int32Array(count)
    this.growCells(Math.max(8, 4 * Math.ceil(count / IN_A_LEAF) + 8))
  }

  /** Whether the arrangement has arrived. Nothing moves after this, so the view
   *  can stop asking for frames. */
  get settled(): boolean {
    return this.warmth < COLD || this.count === 0
  }

  /** Advances the arrangement, or does nothing once it has arrived. */
  tick(times = 1) {
    for (let step = 0; step < times && !this.settled; step++) {
      this.warmth -= this.warmth * COOLING
      this.spring(this.warmth)
      this.push(this.warmth)
      this.gather(this.warmth)
      this.move()
    }
  }

  /** Ticks towards the arrangement for as long as `budget` milliseconds allow, and
   *  answers whether it has arrived. For a reader who has asked not to see things
   *  move: the view calls this a frame at a time and draws nothing until it says
   *  yes, so the picture appears already laid out.
   *
   *  It used to be a `while` loop with no way out, which on five thousand notes is
   *  three hundred ticks and a second and a half of a thread that answers nothing -
   *  so the readers who asked for less movement were the only ones who got a freeze.
   *  A budget rather than a count of ticks, because a tick is as long as the space
   *  is large and only a clock knows what a frame has left. */
  settle(budget: number): boolean {
    const until = performance.now() + budget
    while (!this.settled && performance.now() < until) this.tick(SETTLING_TICKS)

    return this.settled
  }

  /** Holds a node where the pointer put it, and warms the layout so its
   *  neighbours come along. A held node stays held: dragging a note somewhere is
   *  saying it belongs there. */
  hold(node: number, x: number, y: number) {
    if (node < 0 || node >= this.count) return

    this.held[node] = 1
    this.heldX[node] = x
    this.heldY[node] = y
    this.x[node] = x
    this.y[node] = y
    if (this.warmth < DRAG_WARMTH) this.warmth = DRAG_WARMTH
  }

  /** One spring per link, pulling the two ends towards `distance` apart. Reads
   *  the speeds as well as the positions, the way Verlet integration wants: the
   *  correction is against where the two ends are about to be. */
  private spring(warmth: number) {
    const { x, y, vx, vy, from, to, pull, bias, distance } = this

    for (let edge = 0; edge < from.length; edge++) {
      const a = from[edge] ?? 0
      const b = to[edge] ?? 0

      let dx = (x[b] ?? 0) + (vx[b] ?? 0) - ((x[a] ?? 0) + (vx[a] ?? 0))
      let dy = (y[b] ?? 0) + (vy[b] ?? 0) - ((y[a] ?? 0) + (vy[a] ?? 0))
      const length = Math.sqrt(dx * dx + dy * dy) || NEAREST_SQUARED

      const force = ((length - distance) / length) * warmth * (pull[edge] ?? 1)
      dx *= force
      dy *= force

      const share = bias[edge] ?? 0.5
      vx[b] = (vx[b] ?? 0) - dx * share
      vy[b] = (vy[b] ?? 0) - dy * share
      vx[a] = (vx[a] ?? 0) + dx * (1 - share)
      vy[a] = (vy[a] ?? 0) + dy * (1 - share)
    }
  }

  /** The pull towards the middle, which is what gives the notes nothing links to
   *  a ring to sit in rather than an escape. */
  private gather(warmth: number) {
    const { x, y, vx, vy, count } = this

    if (this.gravity === 0) return

    for (let one = 0; one < count; one++) {
      vx[one] = (vx[one] ?? 0) - (x[one] ?? 0) * this.gravity * warmth
      vy[one] = (vy[one] ?? 0) - (y[one] ?? 0) * this.gravity * warmth
    }
  }

  private move() {
    const { x, y, vx, vy, held, heldX, heldY, count } = this

    for (let one = 0; one < count; one++) {
      if (held[one]) {
        x[one] = heldX[one] ?? 0
        y[one] = heldY[one] ?? 0
        vx[one] = 0
        vy[one] = 0
        continue
      }

      vx[one] = (vx[one] ?? 0) * KEPT_SPEED
      vy[one] = (vy[one] ?? 0) * KEPT_SPEED
      x[one] = (x[one] ?? 0) + (vx[one] ?? 0)
      y[one] = (y[one] ?? 0) + (vy[one] ?? 0)
    }
  }

  // ── The quadtree ───────────────────────────────────────────────────
  //
  // Rebuilt every tick, since the notes have all moved. Top down: the notes are
  // sorted into the four quadrants of a square, then each quadrant into its own
  // four, and a square holding few enough notes stops dividing. `order` holds
  // the notes so that every square owns one unbroken run of it, which is what
  // lets a square be a pair of numbers rather than a list.

  private readonly order: Int32Array
  private readonly scratch: Int32Array
  private readonly stack: Int32Array

  private first = new Int32Array(0)
  private inside = new Int32Array(0)
  private child = new Int32Array(0)
  private mass = new Float64Array(0)
  private middleX = new Float64Array(0)
  private middleY = new Float64Array(0)
  private width = new Float64Array(0)
  private squares = 0

  /** Room for more squares, keeping what is already in them: this is called from
   *  the middle of a build, where the squares above the one being divided have
   *  already been written. */
  private growCells(wanted: number) {
    if (this.first.length >= wanted) return

    const size = Math.max(wanted, this.first.length * 2)
    const wider = (held: Int32Array) => {
      const grown = new Int32Array(size)
      grown.set(held)
      return grown
    }
    const widerFloat = (held: Float64Array) => {
      const grown = new Float64Array(size)
      grown.set(held)
      return grown
    }

    this.first = wider(this.first)
    this.inside = wider(this.inside)
    this.child = wider(this.child)
    this.mass = widerFloat(this.mass)
    this.middleX = widerFloat(this.middleX)
    this.middleY = widerFloat(this.middleY)
    this.width = widerFloat(this.width)
  }

  /** Every note pushes every other away, with a whole square standing in for the
   *  notes in it once it is far enough off. */
  private push(warmth: number) {
    const { x, y, vx, vy, count, order, stack, child, first, inside, mass } = this
    if (count < 2) return

    this.divide()

    for (let one = 0; one < count; one++) {
      const px = x[one] ?? 0
      const py = y[one] ?? 0
      let fx = 0
      let fy = 0
      let top = 0
      stack[top++] = 0

      while (top > 0) {
        const square = stack[--top] ?? 0
        const weight = mass[square] ?? 0
        if (weight === 0) continue

        const dx = (this.middleX[square] ?? 0) - px
        const dy = (this.middleY[square] ?? 0) - py
        let far = dx * dx + dy * dy
        const side = this.width[square] ?? 0
        const base = child[square] ?? -1

        // Near enough to matter in detail: look into it.
        if (base >= 0 && side * side >= THETA_SQUARED * far) {
          stack[top++] = base
          stack[top++] = base + 1
          stack[top++] = base + 2
          stack[top++] = base + 3
          continue
        }

        if (base < 0) {
          // A leaf: every note in it, one at a time, so a note is not pushed by
          // a square it is itself part of the centre of.
          const start = first[square] ?? 0
          const held = inside[square] ?? 0

          for (let step = 0; step < held; step++) {
            const other = order[start + step] ?? 0
            if (other === one) continue

            const ox = (x[other] ?? 0) - px
            const oy = (y[other] ?? 0) - py
            let apart = ox * ox + oy * oy
            if (apart < NEAREST_SQUARED) apart = NEAREST_SQUARED

            const force = (this.repulsion * warmth) / apart
            fx += ox * force
            fy += oy * force
          }
          continue
        }

        if (far < NEAREST_SQUARED) far = NEAREST_SQUARED
        const force = (this.repulsion * weight * warmth) / far
        fx += dx * force
        fy += dy * force
      }

      vx[one] = (vx[one] ?? 0) + fx
      vy[one] = (vy[one] ?? 0) + fy
    }
  }

  /** Sorts the notes into a fresh quadtree over where they are now. */
  private divide() {
    const { x, y, count, order } = this

    let least = Infinity
    let most = -Infinity
    let lowest = Infinity
    let highest = -Infinity

    for (let one = 0; one < count; one++) {
      order[one] = one
      const px = x[one] ?? 0
      const py = y[one] ?? 0
      if (px < least) least = px
      if (px > most) most = px
      if (py < lowest) lowest = py
      if (py > highest) highest = py
    }

    // A square, so the halving is the same in both directions, and a hair wider
    // than the notes so the ones on its edge fall inside it.
    const side = Math.max(most - least, highest - lowest, 1) * 1.01
    this.squares = 1
    this.build(0, 0, count, least, lowest, side, 0)
  }

  /** Fills in one square and, unless it is a leaf, the four under it. Answers
   *  nothing: what the caller needs is left in the arrays. */
  private build(
    square: number,
    low: number,
    high: number,
    x0: number,
    y0: number,
    side: number,
    depth: number,
  ) {
    const { order, scratch, x, y } = this

    this.first[square] = low
    this.inside[square] = high - low
    this.width[square] = side
    this.mass[square] = high - low

    if (high - low === 0) {
      this.child[square] = -1
      this.middleX[square] = x0
      this.middleY[square] = y0
      return
    }

    if (high - low <= IN_A_LEAF || depth >= DEEPEST) {
      this.child[square] = -1

      let sumX = 0
      let sumY = 0
      for (let step = low; step < high; step++) {
        const one = order[step] ?? 0
        sumX += x[one] ?? 0
        sumY += y[one] ?? 0
      }

      this.middleX[square] = sumX / (high - low)
      this.middleY[square] = sumY / (high - low)
      return
    }

    const half = side / 2
    const midX = x0 + half
    const midY = y0 + half

    // Counting sort into the four quadrants, so each child owns one run of
    // `order`. Four counters rather than an array of them, which keeps the
    // innermost loop in the space this walks over anyway.
    let inTopLeft = 0
    let inTopRight = 0
    let inBottomLeft = 0
    for (let step = low; step < high; step++) {
      const one = order[step] ?? 0
      const which = quadrant(x[one] ?? 0, y[one] ?? 0, midX, midY)
      if (which === 0) inTopLeft++
      else if (which === 1) inTopRight++
      else if (which === 2) inBottomLeft++
    }

    const startTopLeft = low
    const startTopRight = startTopLeft + inTopLeft
    const startBottomLeft = startTopRight + inTopRight
    const startBottomRight = startBottomLeft + inBottomLeft

    let atTopLeft = startTopLeft
    let atTopRight = startTopRight
    let atBottomLeft = startBottomLeft
    let atBottomRight = startBottomRight

    for (let step = low; step < high; step++) {
      const one = order[step] ?? 0
      const which = quadrant(x[one] ?? 0, y[one] ?? 0, midX, midY)
      if (which === 0) scratch[atTopLeft++] = one
      else if (which === 1) scratch[atTopRight++] = one
      else if (which === 2) scratch[atBottomLeft++] = one
      else scratch[atBottomRight++] = one
    }
    for (let step = low; step < high; step++) order[step] = scratch[step] ?? 0

    this.growCells(this.squares + 4)
    const base = this.squares
    this.squares += 4
    this.child[square] = base

    const starts = [startTopLeft, startTopRight, startBottomLeft, startBottomRight]
    const ends = [startTopRight, startBottomLeft, startBottomRight, high]
    for (let which = 0; which < 4; which++) {
      this.build(
        base + which,
        starts[which] ?? low,
        ends[which] ?? low,
        which % 2 === 0 ? x0 : midX,
        which < 2 ? y0 : midY,
        half,
        depth + 1,
      )
    }

    // The centre of mass of a square is where its children's are, weighted.
    let sumX = 0
    let sumY = 0
    for (let which = 0; which < 4; which++) {
      const weight = this.mass[base + which] ?? 0
      sumX += (this.middleX[base + which] ?? 0) * weight
      sumY += (this.middleY[base + which] ?? 0) * weight
    }

    const weight = this.mass[square] ?? 1
    this.middleX[square] = sumX / weight
    this.middleY[square] = sumY / weight
  }
}

/** Which of a square's four quadrants a point falls in: top left, top right,
 *  bottom left, bottom right. */
function quadrant(px: number, py: number, midX: number, midY: number): number {
  return (px >= midX ? 1 : 0) + (py >= midY ? 2 : 0)
}
