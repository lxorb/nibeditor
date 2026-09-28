/** The arithmetic of the plane: where a node sits, where an edge meets it, what
 *  a pointer is over, and what a rubber band caught.
 *
 *  Pure, and in one place, because the drawing and the pointer both read it: a
 *  click that lands somewhere other than where the node was drawn is the one bug
 *  a surface like this cannot afford. Everything here is in plane coordinates,
 *  which are the ones the file is written in; the camera is next door. */

import type { Canvas, CanvasEdge, CanvasNode, Shape, Side } from './format'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  width: number
  height: number
}

/** The four sides an edge can leave a card by, in the order they read. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** How far apart the dots are, and what a dragged node lands on. Obsidian's own
 *  step, so a canvas edited in either app stays on one grid. */
export const GRID = 20

/** A value on the grid. */
export function snapped(value: number): number {
  return Math.round(value / GRID) * GRID
}

/** The pattern behind the plane - which of the grid's points are drawn at a zoom,
 *  and the fade between one answer and the next - is next door in lattice.ts. It is
 *  about time as much as about arithmetic, and this file is only about arithmetic. */

export function boxOf(node: CanvasNode): Box {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The middle of one side of a box, which is where an edge meets it. */
export function sidePoint(box: Box, side: Side): Point {
  const middle = centreOf(box)

  switch (side) {
    case 'top':
      return { x: middle.x, y: box.y }
    case 'right':
      return { x: box.x + box.width, y: middle.y }
    case 'bottom':
      return { x: middle.x, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: middle.y }
  }
}

/** Which way a side faces, as a unit vector. What bends a curve outwards from
 *  the node rather than straight at the other one. */
function outward(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'right':
      return { x: 1, y: 0 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
  }
}

/** The side of `from` that faces `to`. What an edge uses when the file names no
 *  side: whichever way the two boxes are further apart, since that is the side a
 *  person would have drawn from.
 *
 *  Compared as a share of each box's own size rather than in pixels, so a wide
 *  card beside a tall one still connects the way it looks like it should. */
export function facingSide(from: Box, to: Box): Side {
  const here = centreOf(from)
  const there = centreOf(to)
  const across = there.x - here.x
  const down = there.y - here.y

  if (Math.abs(across) * from.height >= Math.abs(down) * from.width) {
    return across >= 0 ? 'right' : 'left'
  }

  return down >= 0 ? 'bottom' : 'top'
}

export interface EdgeEnds {
  from: Point
  to: Point
  fromSide: Side
  toSide: Side
}

/** Where an edge starts and ends. A side the file names is used as written; one
 *  it leaves out is worked out from where the two boxes are, which is what makes
 *  an edge follow its nodes when they are dragged apart. */
export function edgeEnds(edge: CanvasEdge, from: Box, to: Box): EdgeEnds {
  const fromSide = edge.fromSide ?? facingSide(from, to)
  const toSide = edge.toSide ?? facingSide(to, from)

  return { from: sidePoint(from, fromSide), to: sidePoint(to, toSide), fromSide, toSide }
}

/** How far a curve leans out of a node before it turns towards the other one.
 *  A share of the distance, so a short edge is a gentle bend and a long one a
 *  proper curve, with a floor so two nodes almost touching still leave their
 *  sides at a right angle. */
const LEAN = 0.4
const LEAST_LEAN = 24

/** The four points the edge's cubic runs through: where it leaves, the two it
 *  leans on, and where it arrives. Said once here, so the drawing, the label and
 *  the hit test cannot come to different conclusions about where the line is. */
export function edgeCurve(ends: EdgeEnds): [Point, Point, Point, Point] {
  const { from, to } = ends
  const away = Math.hypot(to.x - from.x, to.y - from.y)
  const lean = Math.max(LEAST_LEAN, away * LEAN)

  const out = outward(ends.fromSide)
  const back = outward(ends.toSide)

  return [
    from,
    { x: from.x + out.x * lean, y: from.y + out.y * lean },
    { x: to.x + back.x * lean, y: to.y + back.y * lean },
    to,
  ]
}

/** The edge as an SVG path: a cubic that leaves each node at a right angle to
 *  the side it meets, which is how a drawn connector reads whichever way the
 *  nodes are arranged. */
export function edgePath(ends: EdgeEnds): string {
  const [from, first, second, to] = edgeCurve(ends)

  return `M ${round(from.x)} ${round(from.y)} C ${round(first.x)} ${round(first.y)}, ${round(second.x)} ${round(second.y)}, ${round(to.x)} ${round(to.y)}`
}

/** Half a pixel is as fine as a path needs to be, and a shorter string is less
 *  for the browser to parse on every frame of a drag. */
function round(value: number): number {
  return Math.round(value * 2) / 2
}

/** Where an arrow head sits and which way it points: at the end of the edge,
 *  facing into the node it meets. */
export function arrowAt(point: Point, side: Side): { x: number; y: number; angle: number } {
  const facing = outward(side)
  // Into the node, which is the opposite of the way the side faces.
  return { x: point.x, y: point.y, angle: (Math.atan2(-facing.y, -facing.x) * 180) / Math.PI }
}

/** Halfway along the edge, where a label goes. The midpoint of the cubic, which
 *  for these control points is a step out from each end towards the other. */
export function edgeMiddle(ends: EdgeEnds): Point {
  const [from, first, second, to] = edgeCurve(ends)

  // The cubic at t = 0.5, which is where the four points average out with the
  // middle pair counting three times each.
  return {
    x: (from.x + 3 * first.x + 3 * second.x + to.x) / 8,
    y: (from.y + 3 * first.y + 3 * second.y + to.y) / 8,
  }
}

export function within(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

/** The node under a point, or null. The last one that holds it, because the
 *  nodes are drawn in order and the last is the one on top.
 *
 *  A group is only picked up by its own frame, never by the middle of it: a
 *  group is a label around some room, and clicking the room inside it means the
 *  room rather than the group. `edge` is how wide that frame is. */
export function nodeAt(nodes: readonly CanvasNode[], point: Point, edge = 12): CanvasNode | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (!node) continue

    const box = boxOf(node)
    if (!within(grown(box, edge / 2), point)) continue
    if (node.type === 'group' && within(inset(box, edge), point)) continue

    if (node.type === 'shape') {
      if (!within(box, point) && !isLineShape(node.shape)) continue
      // A line is a line, not the triangle of plane beside it, and a hollow
      // rectangle is its own outline: what looks empty is empty to a click too.
      if (!onShape(node, point, edge / 2)) continue
    }

    return node
  }

  return null
}

/** The three that are drawn from one corner of a box to the other and have no inside
 *  to them. */
export type LineShape = 'line' | 'arrow' | 'elbow'

/** Whether a shape is a line rather than a body. */
export function isLineShape(shape: Shape): shape is LineShape {
  return shape === 'line' || shape === 'arrow' || shape === 'elbow'
}

/** Whether a point is on a shape rather than merely in its box: on the line of a
 *  line, on the ring of an unfilled ellipse, on the frame of an unfilled
 *  rectangle, and anywhere inside a filled one. */
function onShape(node: CanvasNode & { type: 'shape' }, point: Point, reach: number): boolean {
  const box = boxOf(node)

  if (isLineShape(node.shape)) {
    return alongPath(shapePath(node), point) <= reach
  }

  switch (node.shape) {
    case 'rect':
      return node.fill ? within(box, point) : !within(inset(box, reach), point)
    case 'rhombus':
    case 'triangle': {
      const corners = shapePath(node)
      if (node.fill || node.text) return insidePolygon(corners, point)
      // A hollow one is its own outline, closed, so the last corner counts back
      // round to the first.
      return alongPath([...corners, corners[0] ?? point], point) <= reach
    }
    case 'ellipse': {
      const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const rx = Math.max(0.5, box.width / 2)
      const ry = Math.max(0.5, box.height / 2)
      const away = ((point.x - middle.x) / rx) ** 2 + ((point.y - middle.y) / ry) ** 2
      if (node.fill || node.text) return away <= 1

      const slack = reach / Math.min(rx, ry)
      return away <= (1 + slack) ** 2 && away >= Math.max(0, 1 - slack) ** 2
    }
  }
}

/** The corners a shape is drawn through, in plane coordinates.
 *
 *  One answer for the drawing, the export and the hit test, so a click cannot
 *  land somewhere other than where the shape is. A body comes back as its own
 *  corners, closed by whoever draws it; a line comes back as the points it runs
 *  through. Nothing here is a rectangle or a ring, which are drawn as themselves
 *  and need no corners. */
export function shapePath(node: CanvasNode & { type: 'shape' }): Point[] {
  const left = node.x
  const right = node.x + node.width
  const top = node.y
  const bottom = node.y + node.height
  const middleX = left + node.width / 2

  switch (node.shape) {
    case 'rhombus':
      return [
        { x: middleX, y: top },
        { x: right, y: top + node.height / 2 },
        { x: middleX, y: bottom },
        { x: left, y: top + node.height / 2 },
      ]
    case 'triangle':
      return [
        { x: middleX, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]
    case 'elbow': {
      const line = shapeLine(node)
      // Along and then down, which is the corner a hand draws when it means "this
      // one, round the side".
      return [line.from, { x: line.to.x, y: line.from.y }, line.to]
    }
    // A line and an arrow are the diagonal of their box; a rectangle and a ring are
    // drawn as themselves and are only ever asked this for the sake of one answer.
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse': {
      const line = shapeLine(node)
      return [line.from, line.to]
    }
  }
}

/** How far a point is from a run of segments. */
function alongPath(points: readonly (Point | undefined)[], point: Point): number {
  let least = Infinity

  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if (!from || !to) continue

    least = Math.min(least, awayFromSegment(point, from, to))
  }

  return least
}

/** Whether a point is inside a polygon, by the crossing rule. */
export function insidePolygon(corners: readonly Point[], point: Point): boolean {
  let inside = false

  for (let one = 0, other = corners.length - 1; one < corners.length; other = one++) {
    const here = corners[one]
    const there = corners[other]
    if (!here || !there) continue

    const crosses =
      here.y > point.y !== there.y > point.y &&
      point.x < ((there.x - here.x) * (point.y - here.y)) / (there.y - here.y) + here.x

    if (crosses) inside = !inside
  }

  return inside
}

/** How far a point is from a segment. The perpendicular where the foot falls on
 *  the segment, and the nearer end otherwise. */
export function awayFromSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  const along = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length),
  )
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy))
}

/** The same box with `by` pixels added to every side, which is the forgiveness a
 *  hand aiming at a thin line needs. */
function grown(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by }
}

/** The same box with `by` pixels taken off every side. Empty rather than
 *  inverted for a box too small to take it. */
function inset(box: Box, by: number): Box {
  return {
    x: box.x + by,
    y: box.y + by,
    width: Math.max(0, box.width - 2 * by),
    height: Math.max(0, box.height - 2 * by),
  }
}

/** The rectangle two points make, whichever corner the drag started in. */
export function rectBetween(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

export function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

/** Everything a rubber band caught: a node it touches at all, the way a file
 *  manager's own band works. */
export function caught(nodes: readonly CanvasNode[], band: Box): string[] {
  return nodes.filter((node) => overlaps(boxOf(node), band)).map((node) => node.id)
}

/** The box every one of these fits in, or null when there are none. What Ctrl+0
 *  frames, what the handles are drawn on, what an arrangement lines up against
 *  and what a paste is centred by. */
export function bounds(boxes: readonly Box[]): Box | null {
  const [first] = boxes
  if (!first) return null

  let least = first.x
  let most = first.x + first.width
  let lowest = first.y
  let highest = first.y + first.height

  for (const box of boxes) {
    least = Math.min(least, box.x)
    most = Math.max(most, box.x + box.width)
    lowest = Math.min(lowest, box.y)
    highest = Math.max(highest, box.y + box.height)
  }

  return { x: least, y: lowest, width: most - least, height: highest - lowest }
}

/** Whether a node sits inside a group, which is what makes a group carry it.
 *  Its whole box, not its middle: half a card hanging out of a frame belongs to
 *  whatever it is mostly in, and a person who wanted it carried would have put
 *  it inside. */
export function insideGroup(group: Box, node: Box): boolean {
  return (
    node.x >= group.x &&
    node.y >= group.y &&
    node.x + node.width <= group.x + group.width &&
    node.y + node.height <= group.y + group.height
  )
}

/** Everything a drag of these nodes takes with it: the nodes themselves, and
 *  whatever sits inside any group among them. A group inside a group carries its
 *  own contents too, so the walk repeats until nothing new is caught. */
export function dragged(canvas: Canvas, picked: readonly string[]): string[] {
  const moving = new Set(picked)
  const groups = canvas.nodes.filter((node) => node.type === 'group')
  if (!groups.length) return [...moving]

  for (;;) {
    const before = moving.size

    for (const group of groups) {
      if (!moving.has(group.id)) continue

      for (const node of canvas.nodes) {
        if (node.id === group.id || moving.has(node.id)) continue
        if (insideGroup(boxOf(group), boxOf(node))) moving.add(node.id)
      }
    }

    if (moving.size === before) return [...moving]
  }
}

/** The eight handles a selected node is resized by, and which way each pulls. */
export const HANDLES = [
  { id: 'nw', x: -1, y: -1 },
  { id: 'n', x: 0, y: -1 },
  { id: 'ne', x: 1, y: -1 },
  { id: 'e', x: 1, y: 0 },
  { id: 'se', x: 1, y: 1 },
  { id: 's', x: 0, y: 1 },
  { id: 'sw', x: -1, y: 1 },
  { id: 'w', x: -1, y: 0 },
] as const

export type HandleId = (typeof HANDLES)[number]['id']

/** A box after a handle has been dragged by `dx`, `dy`. The edges the handle
 *  pulls move and the others stay, and a side dragged past its opposite stops at
 *  `least` rather than turning the box inside out.
 *
 *  The offset arrives already snapped, or not, as the surface decided; see
 *  snap.ts. Rounding here would fight the guides. */
export function resizedBox(box: Box, handle: HandleId, dx: number, dy: number, least: number): Box {
  const pull = HANDLES.find((one) => one.id === handle)
  if (!pull) return box

  let { x, y, width, height } = box

  if (pull.x < 0) {
    const right = x + width
    x = Math.min(Math.round(x + dx), right - least)
    width = right - x
  } else if (pull.x > 0) {
    width = Math.max(least, Math.round(width + dx))
  }

  if (pull.y < 0) {
    const bottom = y + height
    y = Math.min(Math.round(y + dy), bottom - least)
    height = bottom - y
  } else if (pull.y > 0) {
    height = Math.max(least, Math.round(height + dy))
  }

  return { x, y, width, height }
}

/** The same resize with the shape of the box held.
 *
 *  Which axis leads is which one the handle really pulls: a side handle pulls one,
 *  and a corner is led by whichever of the two moved further as a share of itself,
 *  so a corner dragged mostly sideways widens and a corner dragged mostly down
 *  heightens. The edges the handle is not pulling stay exactly where they were,
 *  which is what makes a held-shape resize feel like the same gesture. */
export function keptAspect(was: Box, now: Box, handle: HandleId, least: number): Box {
  if (was.width < 1 || was.height < 1) return now

  const ratio = was.width / was.height
  const acrossLed =
    handle === 'e' || handle === 'w'
      ? true
      : handle === 'n' || handle === 's'
        ? false
        : Math.abs(now.width - was.width) / was.width >=
          Math.abs(now.height - was.height) / was.height

  const width = acrossLed ? now.width : Math.max(least, Math.round(now.height * ratio))
  const height = acrossLed ? Math.max(least, Math.round(now.width / ratio)) : now.height

  const pull = HANDLES.find((one) => one.id === handle)
  // The corner the handle is pulling away from stays put; a side handle grows
  // about the middle of the axis it is not pulling.
  const x = pull && pull.x < 0 ? now.x + now.width - width : now.x
  const y = pull && pull.y < 0 ? now.y + now.height - height : now.y

  return {
    x: Math.round(pull?.x === 0 ? was.x + was.width / 2 - width / 2 : x),
    y: Math.round(pull?.y === 0 ? was.y + was.height / 2 - height / 2 : y),
    width,
    height,
  }
}

/** Where a line, an arrow or an elbow runs inside its own box: corner to corner,
 *  and `up` says which pair. One box, all four diagonals. */
export function shapeLine(node: CanvasNode & { type: 'shape' }): { from: Point; to: Point } {
  const left = node.x
  const right = node.x + node.width
  const top = node.y
  const bottom = node.y + node.height

  return node.up
    ? { from: { x: left, y: bottom }, to: { x: right, y: top } }
    : { from: { x: left, y: top }, to: { x: right, y: bottom } }
}
