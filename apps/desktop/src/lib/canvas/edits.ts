/** Everything that can be done to a canvas, as pure functions from one canvas to
 *  the next.
 *
 *  Nothing here changes anything in place. An edit hands back a new canvas whose
 *  untouched nodes, edges and strokes are the very same objects, which is what
 *  makes the undo stack next door cheap, what lets the surface tell in one
 *  comparison whether something it is drawing has moved, and what lets `stamped`
 *  work out which objects need a new time without diffing anything.
 *
 *  What is picked is one list of ids covering all three kinds. A card, a
 *  connector and a stroke of ink are deleted, coloured, copied and dragged by the
 *  same four functions rather than by twelve. */

import {
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  freshId,
  type InkStroke,
  type Shape,
  type Side,
} from './format'
import {
  bounds,
  boxOf,
  type Box,
  dragged,
  GRID,
  type HandleId,
  insideGroup,
  isLineShape,
  keptAspect,
  resizedBox,
  snapped,
} from './geometry'
import { strokeBox, transformed } from './ink'

/** The canvas with some of its nodes replaced, keeping the order they were in:
 *  the order is the z order, and an edit must never bring a card to the front by
 *  accident. */
function replacing(canvas: Canvas, nodes: readonly CanvasNode[]): Canvas {
  if (!nodes.length) return canvas

  const byId = new Map(nodes.map((node) => [node.id, node]))
  return { ...canvas, nodes: canvas.nodes.map((node) => byId.get(node.id) ?? node) }
}

function nodeById(canvas: Canvas, id: string): CanvasNode | undefined {
  return canvas.nodes.find((node) => node.id === id)
}

/** Everything an edit acts on: what was picked, whatever a picked group holds,
 *  and the ink that lies inside a picked group. A frame is a thing with room in
 *  it, and dragging one that left the writing behind would be a surprise. */
function reach(canvas: Canvas, picked: readonly string[]): Set<string> {
  const going = new Set(dragged(canvas, picked))
  const groups = canvas.nodes.filter((node) => node.type === 'group' && going.has(node.id))

  if (groups.length) {
    for (const stroke of canvas.ink) {
      if (going.has(stroke.id)) continue
      if (groups.some((group) => insideGroup(boxOf(group), strokeBox(stroke)))) going.add(stroke.id)
    }
  }

  for (const id of picked) going.add(id)
  return going
}

/** The box round everything picked, or null. What the handles are drawn on and
 *  what a resize scales. */
export function pickedBox(canvas: Canvas, picked: readonly string[]): Box | null {
  if (!picked.length) return null

  const wanted = new Set(picked)
  return bounds([
    ...canvas.nodes.filter((node) => wanted.has(node.id)),
    ...canvas.ink.filter((stroke) => wanted.has(stroke.id)).map(strokeBox),
  ])
}

/** Everything picked moved by a whole number of pixels.
 *
 *  The offset is applied whole rather than each thing being snapped on its own,
 *  so a selection of several keeps its shape: snapping every card would pull a
 *  row of them into a single column the moment it was nudged. Where the offset
 *  came from is the surface's business; see snap.ts. */
export function movedBy(canvas: Canvas, picked: readonly string[], dx: number, dy: number): Canvas {
  const moving = reach(canvas, picked)
  if (!moving.size || (!dx && !dy)) return canvas

  const across = Math.round(dx)
  const down = Math.round(dy)
  if (!across && !down) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      moving.has(node.id) ? { ...node, x: node.x + across, y: node.y + down } : node,
    ),
    ink: canvas.ink.map((stroke) =>
      moving.has(stroke.id)
        ? transformed(stroke, {
            dx: across,
            dy: down,
            sx: 1,
            sy: 1,
            turn: 0,
            about: { x: 0, y: 0 },
          })
        : stroke,
    ),
  }
}

/** How small anything may be dragged, in plane units. Small enough to be a
 *  marker beside something, big enough to still be grabbed. */
const LEAST = GRID * 2

/** Everything picked after a resize handle has been dragged.
 *
 *  One box round the lot is pulled, and everything inside it keeps where it was
 *  in that box: one card resizes exactly as it used to, and nine resize together
 *  the way a hand expects. Ink scales with it, nib and all, so writing pulled to
 *  twice the size is writing that was written twice as big. */
export function resizedPick(
  canvas: Canvas,
  picked: readonly string[],
  handle: HandleId,
  dx: number,
  dy: number,
  aspect = false,
): Canvas {
  const was = pickedBox(canvas, picked)
  if (!was || was.width < 1 || was.height < 1) return canvas

  const pulled = resizedBox(was, handle, dx, dy, LEAST)
  const now = aspect ? keptAspect(was, pulled, handle, LEAST) : pulled
  const sx = now.width / was.width
  const sy = now.height / was.height
  if (sx === 1 && sy === 1 && now.x === was.x && now.y === was.y) return canvas

  const wanted = new Set(picked)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      if (!wanted.has(node.id)) return node

      return {
        ...node,
        x: Math.round(now.x + (node.x - was.x) * sx),
        y: Math.round(now.y + (node.y - was.y) * sy),
        width: Math.max(1, Math.round(node.width * sx)),
        height: Math.max(1, Math.round(node.height * sy)),
      }
    }),
    ink: canvas.ink.map((stroke) =>
      wanted.has(stroke.id)
        ? transformed(stroke, {
            dx: now.x - was.x * sx,
            dy: now.y - was.y * sy,
            sx,
            sy,
            turn: 0,
            about: { x: 0, y: 0 },
          })
        : stroke,
    ),
  }
}

/** Ink turned about a point. Only strokes turn: a card on a plane is upright,
 *  which is what makes a plane of cards readable. */
export function turnedInk(
  canvas: Canvas,
  picked: readonly string[],
  turn: number,
  about: { x: number; y: number },
): Canvas {
  const wanted = new Set(picked)
  if (!turn) return canvas

  return {
    ...canvas,
    ink: canvas.ink.map((stroke) =>
      wanted.has(stroke.id)
        ? transformed(stroke, { dx: 0, dy: 0, sx: 1, sy: 1, turn, about })
        : stroke,
    ),
  }
}

/** A node put on top of the canvas, which is where a new one belongs: the order
 *  of the list is the z order. */
export function withNode(canvas: Canvas, node: CanvasNode): Canvas {
  return { ...canvas, nodes: [...canvas.nodes, node] }
}

/** A group behind everything, which is where a frame belongs: drawn over its own
 *  contents it would hide them. */
export function withGroup(canvas: Canvas, group: CanvasNode): Canvas {
  return { ...canvas, nodes: [group, ...canvas.nodes] }
}

/** A shape drawn out between two points. Its box is always the right way up and
 *  `up` remembers which way a line ran, so one box says all four diagonals. */
export function withShape(
  canvas: Canvas,
  shape: Shape,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour?: string,
): { canvas: Canvas; id: string } {
  const id = freshId()
  const box = {
    x: Math.round(Math.min(from.x, to.x)),
    y: Math.round(Math.min(from.y, to.y)),
    width: Math.max(1, Math.round(Math.abs(to.x - from.x))),
    height: Math.max(1, Math.round(Math.abs(to.y - from.y))),
  }

  const node: CanvasNode = {
    id,
    type: 'shape',
    shape,
    ...box,
    ...(colour === undefined ? {} : { color: colour }),
    // Only a line has a direction inside its box. A body drawn from the bottom
    // right is the same body drawn from the top left.
    ...(isLineShape(shape) && (to.y - from.y) * (to.x - from.x) < 0 ? { up: true } : {}),
  }

  return { canvas: withNode(canvas, node), id }
}

/** How much room a frame leaves round what it was made from, in plane units:
 *  enough to read the frame as holding them rather than as touching them. */
const FRAME_ROOM = GRID * 2

/** A frame round everything picked, behind it, holding it.
 *
 *  Which is all a group is: a labelled box, and whatever happens to sit inside it
 *  moves with it. Nothing is written into the cards themselves, so a canvas grouped
 *  here opens in Obsidian as the same cards inside the same frame. */
export function grouped(canvas: Canvas, picked: readonly string[]): { canvas: Canvas; id: string } {
  const box = pickedBox(canvas, picked)
  if (!box) return { canvas, id: '' }

  const id = freshId()
  const group: CanvasNode = {
    id,
    type: 'group',
    x: Math.round(box.x - FRAME_ROOM),
    y: Math.round(box.y - FRAME_ROOM),
    width: Math.round(box.width + 2 * FRAME_ROOM),
    height: Math.round(box.height + 2 * FRAME_ROOM),
  }

  return { canvas: withGroup(canvas, group), id }
}

/** The frames among what is picked, gone, and everything they held left where it
 *  was. The one edit that deletes something and keeps its contents, which is why it
 *  cannot go through `removed`. */
export function ungrouped(
  canvas: Canvas,
  picked: readonly string[],
): { canvas: Canvas; ids: string[] } {
  const wanted = new Set(picked)
  const going = canvas.nodes.filter((node) => node.type === 'group' && wanted.has(node.id))
  if (!going.length) return { canvas, ids: [] }

  const gone = new Set(going.map((group) => group.id))
  // What the frames held, so it is what stays picked: ungrouping four cards and
  // being left with nothing selected is a gesture that appears to have deleted
  // them.
  const held = new Set<string>()
  for (const group of going) {
    for (const id of dragged(canvas, [group.id])) {
      if (!gone.has(id)) held.add(id)
    }
  }

  return {
    canvas: {
      ...canvas,
      nodes: canvas.nodes.filter((node) => !gone.has(node.id)),
      edges: canvas.edges.filter((edge) => !gone.has(edge.fromNode) && !gone.has(edge.toNode)),
    },
    ids: [...held],
  }
}

/** One end of a connector moved onto another card, with the side it meets left for
 *  the drawing to work out from where the two ended up. An end dropped back on the
 *  card at the other end is refused: a connector from a card to itself is a line
 *  with nowhere to go. */
export function reattached(canvas: Canvas, id: string, end: 'from' | 'to', node: string): Canvas {
  const edge = canvas.edges.find((one) => one.id === id)
  if (!edge || !nodeById(canvas, node)) return canvas
  if ((end === 'from' ? edge.toNode : edge.fromNode) === node) return canvas
  if ((end === 'from' ? edge.fromNode : edge.toNode) === node) return canvas

  const moved: CanvasEdge = { ...edge, ...(end === 'from' ? { fromNode: node } : { toNode: node }) }
  // The side is dropped so it is worked out from where the cards are, which is what
  // makes a moved end meet its new card the way it looks like it should.
  const sideless = put(moved, end === 'from' ? 'fromSide' : 'toSide', null)

  return { ...canvas, edges: canvas.edges.map((one) => (one.id === id ? sideless : one)) }
}

/** A stroke of ink on the plane. Ink is a list of its own rather than a node,
 *  so a canvas of a thousand strokes and ten cards still stacks its cards by
 *  the order of ten things. */
export function withStroke(canvas: Canvas, stroke: InkStroke): Canvas {
  return { ...canvas, ink: [...canvas.ink, stroke] }
}

/** The strokes an eraser cut through, each in whatever pieces it left. A stroke
 *  the eraser missed is the very same object, so a rub that met nothing costs
 *  nothing at all. */
export function cutInk(canvas: Canvas, cut: (stroke: InkStroke) => InkStroke[]): Canvas {
  let changed = false
  const ink: InkStroke[] = []

  for (const stroke of canvas.ink) {
    const pieces = cut(stroke)
    if (pieces.length === 1 && pieces[0] === stroke) {
      ink.push(stroke)
      continue
    }

    changed = true
    ink.push(...pieces)
  }

  return changed ? { ...canvas, ink } : canvas
}

/** The words inside a card or a shape. A shape in a diagram is a shape with a name
 *  on it far more often than it is a shape, so both answer the same edit; an empty
 *  one on a shape is taken away rather than written, since the field is optional
 *  and a shape wearing `""` is a shape with nothing in it. */
export function withText(canvas: Canvas, id: string, text: string): Canvas {
  const node = nodeById(canvas, id)
  if (!node) return canvas

  if (node.type === 'shape') {
    if ((node.text ?? '') === text) return canvas
    return replacing(canvas, [put(node, 'text', text.trim() ? text : null)])
  }

  if (node.type !== 'text' || node.text === text) return canvas

  return replacing(canvas, [{ ...node, text }])
}

/** The words on a group's frame, or along an edge. An empty label is taken away
 *  rather than written: the field is optional in the format, and a frame wearing
 *  `""` is one with a label nobody can see. */
export function withLabel(canvas: Canvas, id: string, label: string): Canvas {
  const node = nodeById(canvas, id)
  if (node?.type === 'group') return replacing(canvas, [put(node, 'label', label.trim() || null)])

  return {
    ...canvas,
    edges: canvas.edges.map((edge) =>
      edge.id === id ? put(edge, 'label', label.trim() || null) : edge,
    ),
  }
}

/** Which way an edge's arrow heads point. Both ends at once, because that is how
 *  the four states read: none, one way, the other, or both. */
export function withEnds(
  canvas: Canvas,
  picked: readonly string[],
  from: boolean,
  to: boolean,
): Canvas {
  const chosen = new Set(picked)

  return {
    ...canvas,
    edges: canvas.edges.map((edge) => {
      if (!chosen.has(edge.id)) return edge

      // The spec's own defaults are left unwritten, so an edge Nib did not
      // change comes back byte for byte.
      const one = put(edge, 'fromEnd', from ? 'arrow' : null)
      return put(one, 'toEnd', to ? null : 'none')
    }),
  }
}

/** Nodes, edges and ink given a colour, or stripped of one. All three at once,
 *  because the colour dots act on whatever is picked. */
export function coloured(canvas: Canvas, picked: readonly string[], colour: string | null): Canvas {
  const chosen = new Set(picked)

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (chosen.has(node.id) ? put(node, 'color', colour) : node)),
    edges: canvas.edges.map((edge) => (chosen.has(edge.id) ? put(edge, 'color', colour) : edge)),
    // A stroke of ink always has a colour: there is no plane showing through a
    // line, so "none" leaves it as it was.
    ink: colour
      ? canvas.ink.map((stroke) => (chosen.has(stroke.id) ? { ...stroke, color: colour } : stroke))
      : canvas.ink,
  }
}

/** One optional field set, or dropped for null.
 *
 *  Dropped rather than set to undefined, because what goes into the file is only
 *  what the spec defines: `"color": undefined` would come out as a key that is
 *  not in the spec, or vanish silently depending on the serialiser, and neither
 *  is a decision worth leaving to chance.
 *
 *  The cast is what a generic spread costs: the compiler cannot see that an
 *  object missing one optional field, plus that field, is the object again. */
function put<T extends object, K extends keyof T & string>(one: T, key: K, value: T[K] | null): T {
  const rest = Object.fromEntries(Object.entries(one).filter(([name]) => name !== key))
  return { ...rest, ...(value === null ? {} : { [key]: value }) } as T
}

/** Everything picked, gone. A node takes every edge that touched it: an edge
 *  from nothing to nothing is not a connector, and the format has no place to put
 *  one. A group takes its contents with it, the way a drag does. */
export function removed(canvas: Canvas, picked: readonly string[]): Canvas {
  const going = reach(canvas, picked)
  if (!going.size) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.filter((node) => !going.has(node.id)),
    edges: canvas.edges.filter(
      (edge) => !going.has(edge.fromNode) && !going.has(edge.toNode) && !going.has(edge.id),
    ),
    ink: canvas.ink.filter((stroke) => !going.has(stroke.id)),
  }
}

/** An edge between two nodes, from one side to another. A second edge the same
 *  way round between the same two sides is not added: a pair of nodes joined
 *  twice reads as one thicker line and there is nothing to be done with the
 *  second. */
export function connected(
  canvas: Canvas,
  fromNode: string,
  fromSide: Side,
  toNode: string,
  toSide: Side,
  head = true,
): { canvas: Canvas; id: string | null } {
  if (fromNode === toNode) return { canvas, id: null }
  if (!nodeById(canvas, fromNode) || !nodeById(canvas, toNode)) return { canvas, id: null }

  const already = canvas.edges.find(
    (edge) =>
      edge.fromNode === fromNode &&
      edge.toNode === toNode &&
      edge.fromSide === fromSide &&
      edge.toSide === toSide,
  )
  if (already) return { canvas, id: already.id }

  // The spec's own default is an arrow at the far end, so only a line with no head
  // on it has anything to say.
  const edge: CanvasEdge = {
    id: freshId(),
    fromNode,
    fromSide,
    toNode,
    toSide,
    ...(head ? {} : { toEnd: 'none' as const }),
  }
  return { canvas: { ...canvas, edges: [...canvas.edges, edge] }, id: edge.id }
}

/** How far a copy lands from what it was copied from: one grid step each way, so
 *  the copy is visibly its own card and still where the hand left off. */
const COPY_OFFSET = GRID

/** What is picked as a canvas of its own, with the edges that ran between the
 *  cards in it and nothing else. What a copy puts on the clipboard, so what is
 *  pasted from it is a canvas any app that reads the format can take. */
export function subset(canvas: Canvas, picked: readonly string[]): Canvas {
  const taking = reach(canvas, picked)

  return {
    nodes: canvas.nodes.filter((node) => taking.has(node.id)),
    edges: canvas.edges.filter((edge) => taking.has(edge.fromNode) && taking.has(edge.toNode)),
    ink: canvas.ink.filter((stroke) => taking.has(stroke.id)),
    at: {},
    gone: {},
  }
}

/** Cards from somewhere else onto this canvas, moved by an offset and renamed as
 *  they arrive: an id belongs to the file it is in, and two cards sharing one
 *  would leave every edge pointing at whichever came first.
 *
 *  Answers the canvas and the ids of what arrived, so the caller can pick what it
 *  just made: pasting something and then having to find it is the one thing a
 *  paste should never make anybody do. */
export function pasted(
  canvas: Canvas,
  incoming: Canvas,
  dx = 0,
  dy = 0,
): { canvas: Canvas; ids: string[] } {
  if (!incoming.nodes.length && !incoming.ink.length) return { canvas, ids: [] }

  const renamed = new Map(incoming.nodes.map((node) => [node.id, freshId()]))
  const nodes: CanvasNode[] = incoming.nodes.map((node) => ({
    ...node,
    id: renamed.get(node.id) ?? node.id,
    x: node.x + dx,
    y: node.y + dy,
  }))

  const edges = incoming.edges
    .filter((edge) => renamed.has(edge.fromNode) && renamed.has(edge.toNode))
    .map((edge) => ({
      ...edge,
      id: freshId(),
      fromNode: renamed.get(edge.fromNode) ?? edge.fromNode,
      toNode: renamed.get(edge.toNode) ?? edge.toNode,
    }))

  const ink = incoming.ink.map((stroke) => ({
    ...transformed(stroke, { dx, dy, sx: 1, sy: 1, turn: 0, about: { x: 0, y: 0 } }),
    id: freshId(),
  }))

  return {
    canvas: {
      ...canvas,
      nodes: [...canvas.nodes, ...nodes],
      edges: [...canvas.edges, ...edges],
      ink: [...canvas.ink, ...ink],
    },
    ids: [...nodes.map((node) => node.id), ...ink.map((stroke) => stroke.id)],
  }
}

/** Copies of what is picked, a grid step along from the originals. */
export function copied(
  canvas: Canvas,
  picked: readonly string[],
  dx = COPY_OFFSET,
  dy = COPY_OFFSET,
): { canvas: Canvas; ids: string[] } {
  return pasted(canvas, subset(canvas, picked), dx, dy)
}

/** A card dropped somewhere on the plane, sized as it should start and with its
 *  top left on the grid. `at` is where the pointer was, and the card is centred
 *  on it: a card that appeared beside the click would read as a miss. */
export function placedAt(at: { x: number; y: number }, width: number, height: number): Box {
  return {
    x: snapped(at.x - width / 2),
    y: snapped(at.y - height / 2),
    width,
    height,
  }
}
