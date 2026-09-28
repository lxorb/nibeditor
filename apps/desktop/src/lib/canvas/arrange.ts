/** Putting several things in order: lining them up, spreading them out, and
 *  saying which is in front.
 *
 *  All of it is pure, and all of it works on the boxes rather than on what is in
 *  them, so a card, a frame and a shape are arranged by one rule. The z order is
 *  the order of the list, which is what the format says, so bringing a card
 *  forward is moving it down the array and nothing else. */

import type { Canvas, CanvasNode } from './format'
import { bounds, type Box, boxOf, dragged } from './geometry'

/** The six ways a row of things can be lined up. Two axes, three places on
 *  each, which is every alignment anybody has ever wanted. */
export const ALIGNMENTS = ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

/** Where one box has to go to be lined up with a span. */
function placed(box: Box, how: Alignment, span: Box): { x: number; y: number } {
  switch (how) {
    case 'left':
      return { x: span.x, y: box.y }
    case 'centre':
      return { x: span.x + span.width / 2 - box.width / 2, y: box.y }
    case 'right':
      return { x: span.x + span.width - box.width, y: box.y }
    case 'top':
      return { x: box.x, y: span.y }
    case 'middle':
      return { x: box.x, y: span.y + span.height / 2 - box.height / 2 }
    case 'bottom':
      return { x: box.x, y: span.y + span.height - box.height }
  }
}

/** Which of the picked nodes an arrangement acts on: the ones named, and never
 *  what a group happens to hold. Lining up a frame with a card means the frame;
 *  its contents move with it because the offset moves them, not because they
 *  were picked. */
function chosen(canvas: Canvas, picked: readonly string[]): CanvasNode[] {
  const wanted = new Set(picked)
  return canvas.nodes.filter((node) => wanted.has(node.id))
}

/** The offset each node moves by, applied to whatever a drag of it would carry:
 *  a frame lined up left takes its cards with it. */
function shifted(canvas: Canvas, moves: ReadonlyMap<string, { dx: number; dy: number }>): Canvas {
  const byId = new Map<string, { dx: number; dy: number }>()

  for (const [id, move] of moves) {
    if (!move.dx && !move.dy) continue
    for (const carried of dragged(canvas, [id])) {
      // A card inside two frames that both moved would otherwise be moved twice.
      if (!byId.has(carried)) byId.set(carried, move)
    }
  }

  if (!byId.size) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      const move = byId.get(node.id)
      return move
        ? { ...node, x: Math.round(node.x + move.dx), y: Math.round(node.y + move.dy) }
        : node
    }),
  }
}

/** Everything picked lined up on one edge or through one middle. Fewer than two
 *  is nothing to line up, and the canvas comes back as it was. */
export function aligned(canvas: Canvas, picked: readonly string[], how: Alignment): Canvas {
  const nodes = chosen(canvas, picked)
  if (nodes.length < 2) return canvas

  const span = bounds(nodes)
  if (!span) return canvas

  const moves = new Map<string, { dx: number; dy: number }>()
  for (const node of nodes) {
    const to = placed(boxOf(node), how, span)
    moves.set(node.id, { dx: to.x - node.x, dy: to.y - node.y })
  }

  return shifted(canvas, moves)
}

/** Everything picked spread evenly between the two outermost, so the gaps
 *  between them are the same. Fewer than three has no middle to move. */
export function distributed(canvas: Canvas, picked: readonly string[], axis: 'x' | 'y'): Canvas {
  const nodes = chosen(canvas, picked)
  if (nodes.length < 3) return canvas

  const along = axis === 'x' ? (node: CanvasNode) => node.x : (node: CanvasNode) => node.y
  const size = axis === 'x' ? (node: CanvasNode) => node.width : (node: CanvasNode) => node.height

  const order = [...nodes].sort((one, other) => along(one) - along(other))
  const first = order[0]
  const last = order[order.length - 1]
  if (!first || !last) return canvas

  const room =
    along(last) - along(first) - order.slice(0, -1).reduce((sum, one) => sum + size(one), 0)
  const gap = room / (order.length - 1)

  const moves = new Map<string, { dx: number; dy: number }>()
  let at = along(first)

  for (const node of order) {
    const to = Math.round(at)
    moves.set(node.id, axis === 'x' ? { dx: to - node.x, dy: 0 } : { dx: 0, dy: to - node.y })
    at += size(node) + gap
  }

  return shifted(canvas, moves)
}

/** The four ways the z order changes. `front` and `back` go all the way;
 *  `forward` and `backward` go one step, which is what a stack of overlapping
 *  cards needs. */
export type Order = 'front' | 'forward' | 'backward' | 'back'

/** The nodes reordered so the picked ones sit where they were asked to.
 *
 *  The relative order of what moves is kept, and so is the relative order of
 *  what does not: three cards brought to the front arrive in the order they were
 *  already in, which is the only answer nobody has to think about. */
export function ordered(canvas: Canvas, picked: readonly string[], how: Order): Canvas {
  const wanted = new Set(picked)
  const nodes = canvas.nodes
  if (!wanted.size || nodes.every((node) => wanted.has(node.id))) return canvas

  if (how === 'front' || how === 'back') {
    const moving = nodes.filter((node) => wanted.has(node.id))
    const still = nodes.filter((node) => !wanted.has(node.id))
    if (!moving.length) return canvas

    return { ...canvas, nodes: how === 'front' ? [...still, ...moving] : [...moving, ...still] }
  }

  const next = [...nodes]
  const by = how === 'forward' ? 1 : -1
  // Walked from the end the cards are moving towards, so two picked cards next
  // to each other do not swap places with each other on the way.
  const walk = how === 'forward' ? [...next.keys()].reverse() : [...next.keys()]

  for (const index of walk) {
    const node = next[index]
    if (!node || !wanted.has(node.id)) continue

    const to = index + by
    const other = next[to]
    // Stopped by the end of the list, and by another card that is also moving:
    // a pair keeps its own order.
    if (!other || wanted.has(other.id)) continue

    next[index] = other
    next[to] = node
  }

  return { ...canvas, nodes: next }
}
