/** What an agent does to a canvas, as operations on its objects by id, and what it
 *  reads of one. Pure: the objects nobody named come back as the very same objects,
 *  which is what the surface, the stamp and the room all rely on to tell what changed.
 *  See canvas.ts for where the operations are applied. */

import {
  type Canvas,
  type CanvasNode,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  freshId,
  type Side,
} from '../../canvas/format'
import { connected, movedBy, removed, withLabel, withNode, withText } from '../../canvas/edits'
import { Refused } from './problem'

/** A canvas as an agent reads it: JSON Canvas's two lists, and how much ink. */
export function readable(canvas: Canvas) {
  return { nodes: canvas.nodes, edges: canvas.edges, ink: canvas.ink.length }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(op: Record<string, unknown>, key: string): number | null {
  const value = op[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textOf(op: Record<string, unknown>, key: string): string | null {
  const value = op[key]
  return typeof value === 'string' ? value : null
}

function nodeIn(canvas: Canvas, id: string | null): CanvasNode {
  const found = id === null ? undefined : canvas.nodes.find((node) => node.id === id)
  if (!found) throw new Refused('not_found', `there is no card ${String(id)} on the canvas`)

  return found
}

/** Where a card with no place asked for goes: under everything already on the plane,
 *  a card's height apart, so it is never on top of the reader's work. */
function freePlace(canvas: Canvas): { x: number; y: number } {
  if (!canvas.nodes.length) return { x: 0, y: 0 }

  const left = Math.min(...canvas.nodes.map((node) => node.x))
  const bottom = Math.max(...canvas.nodes.map((node) => node.y + node.height))
  return { x: left, y: bottom + DEFAULT_HEIGHT }
}

/** Which sides two cards meet on: the ones facing each other, across or down. */
function sidesBetween(from: CanvasNode, to: CanvasNode): [Side, Side] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)

  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** The operations on a canvas, applied one after the other, and the ids of what they
 *  made. Pure: the objects nobody named come back as the very same objects, which is
 *  what the surface, the stamp and the room all rely on to tell what changed. */
export function applied(canvas: Canvas, ops: unknown): { canvas: Canvas; made: string[] } {
  if (!Array.isArray(ops) || !ops.length) {
    throw new Refused('bad_arguments', 'ops is a list of at least one operation')
  }

  let now = canvas
  const made: string[] = []

  for (const op of ops) {
    if (!isRecord(op)) throw new Refused('bad_arguments', 'an operation is an object')
    const id = textOf(op, 'id')

    switch (op.op) {
      case 'add_card': {
        const at = freePlace(now)
        const colour = textOf(op, 'color') ?? textOf(op, 'colour')
        const card: CanvasNode = {
          id: freshId(),
          type: 'text',
          text: textOf(op, 'text') ?? '',
          x: Math.round(numberOf(op, 'x') ?? at.x),
          y: Math.round(numberOf(op, 'y') ?? at.y),
          width: Math.max(20, Math.round(numberOf(op, 'width') ?? DEFAULT_WIDTH)),
          height: Math.max(20, Math.round(numberOf(op, 'height') ?? DEFAULT_HEIGHT)),
          ...(colour ? { color: colour } : {}),
        }
        now = withNode(now, card)
        made.push(card.id)
        break
      }

      case 'edit_text': {
        const words = textOf(op, 'text')
        if (words === null) throw new Refused('bad_arguments', 'edit_text says text')

        const edge = now.edges.find((one) => one.id === id)
        if (edge) {
          now = withLabel(now, edge.id, words)
          break
        }

        const node = nodeIn(now, id)
        now = node.type === 'group' ? withLabel(now, node.id, words) : withText(now, node.id, words)
        break
      }

      case 'move': {
        const node = nodeIn(now, id)
        const x = numberOf(op, 'x')
        const y = numberOf(op, 'y')
        const dx = x === null ? (numberOf(op, 'dx') ?? 0) : x - node.x
        const dy = y === null ? (numberOf(op, 'dy') ?? 0) : y - node.y
        now = movedBy(now, [node.id], dx, dy)
        break
      }

      case 'connect': {
        const from = nodeIn(now, textOf(op, 'from'))
        const to = nodeIn(now, textOf(op, 'to'))
        const [fromSide, toSide] = sidesBetween(from, to)
        const joined = connected(now, from.id, fromSide, to.id, toSide)
        if (joined.id === null)
          throw new Refused('bad_arguments', 'a card cannot connect to itself')

        now = joined.canvas
        const label = textOf(op, 'label') ?? textOf(op, 'text')
        if (label) now = withLabel(now, joined.id, label)
        made.push(joined.id)
        break
      }

      case 'remove': {
        const there = [...now.nodes, ...now.edges, ...now.ink].some((one) => one.id === id)
        if (id === null || !there)
          throw new Refused('not_found', `there is no ${String(id)} on the canvas`)

        now = removed(now, [id])
        break
      }

      default:
        throw new Refused(
          'bad_arguments',
          'op is one of add_card, edit_text, move, connect, remove',
        )
    }
  }

  return { canvas: now, made }
}
