/** An agent's operations on a canvas, and how they meet the reader's own drawing: in
 *  a room through the plane's Yjs document, object by object, and in a file through
 *  the merge two devices' copies get. See docs/agent-native.md 8.7. */

import { type Canvas, type CanvasNode, emptyCanvas } from '@nib/markdown/canvas'
import { merged, stamped } from '@nib/markdown/canvas-merge'
import { pushPlane, readPlane, seedPlane } from '@nib/rooms/plane'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { movedBy } from '../../canvas/edits'
import { applied, readable } from './canvas-ops'
import { Refused } from './problem'

function card(id: string, x: number, y: number, text = id): CanvasNode {
  return { id, type: 'text', text, x, y, width: 200, height: 60 }
}

function plane(...nodes: CanvasNode[]): Canvas {
  return { ...emptyCanvas(), nodes }
}

function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof Refused) return error.code
    throw error
  }
  return 'applied'
}

const textOf = (canvas: Canvas, id: string) => {
  const node = canvas.nodes.find((one) => one.id === id)
  return node?.type === 'text' ? node.text : null
}

describe('the operations', () => {
  test('add a card under everything, change words, move, connect and remove', () => {
    const start = plane(card('a', 0, 0), card('b', 400, 0))
    const { canvas, made } = applied(start, [
      { op: 'add_card', text: 'New idea' },
      { op: 'edit_text', id: 'a', text: 'Alpha' },
      { op: 'move', id: 'b', x: 500, y: 20 },
      { op: 'connect', from: 'a', to: 'b', label: 'leads to' },
    ])

    const added = canvas.nodes.find((one) => one.id === made[0])
    expect(added).toMatchObject({ type: 'text', text: 'New idea', x: 0 })
    // Under the lowest card, never over the reader's work.
    expect(added?.y).toBeGreaterThanOrEqual(60)
    expect(textOf(canvas, 'a')).toBe('Alpha')
    expect(canvas.nodes.find((one) => one.id === 'b')).toMatchObject({ x: 500, y: 20 })

    const edge = canvas.edges.find((one) => one.id === made[1])
    expect(edge).toMatchObject({
      fromNode: 'a',
      toNode: 'b',
      fromSide: 'right',
      toSide: 'left',
      label: 'leads to',
    })

    const gone = applied(canvas, [{ op: 'remove', id: 'a' }]).canvas
    expect(gone.nodes.map((one) => one.id)).not.toContain('a')
    // A card takes its connections with it.
    expect(gone.edges).toEqual([])
  })

  test('hand back every object nobody named as the very same object', () => {
    const start = plane(card('a', 0, 0), card('b', 400, 0))
    const { canvas } = applied(start, [{ op: 'edit_text', id: 'a', text: 'Alpha' }])

    expect(canvas.nodes[1]).toBe(start.nodes[1])
  })

  test('refuse what names nothing, and say what an operation is', () => {
    const start = plane(card('a', 0, 0))
    expect(refusal(() => applied(start, [{ op: 'move', id: 'nope', x: 1 }]))).toBe('not_found')
    expect(refusal(() => applied(start, [{ op: 'remove', id: 'nope' }]))).toBe('not_found')
    expect(refusal(() => applied(start, [{ op: 'connect', from: 'a', to: 'a' }]))).toBe(
      'bad_arguments',
    )
    expect(refusal(() => applied(start, [{ op: 'paint' }]))).toBe('bad_arguments')
    expect(refusal(() => applied(start, []))).toBe('bad_arguments')
  })

  test('read as JSON Canvas, the ink as how many strokes', () => {
    const start = { ...plane(card('a', 0, 0)), ink: [] }
    expect(readable(start)).toEqual({ nodes: start.nodes, edges: [], ink: 0 })
  })
})

/** Two devices on one plane, joined by hand the way a room joins them: whatever one
 *  writes the other is given. */
function joined(start: Canvas): [Y.Doc, Y.Doc] {
  const reader = new Y.Doc()
  const agent = new Y.Doc()
  seedPlane(reader, start)
  Y.applyUpdate(agent, Y.encodeStateAsUpdate(reader))
  return [reader, agent]
}

function exchange(one: Y.Doc, other: Y.Doc) {
  const toOther = Y.encodeStateAsUpdate(one, Y.encodeStateVector(other))
  const toOne = Y.encodeStateAsUpdate(other, Y.encodeStateVector(one))
  Y.applyUpdate(other, toOther)
  Y.applyUpdate(one, toOne)
}

describe('an agent edit beside the reader drawing', () => {
  test('merges object by object through the room, whichever lands first', () => {
    const start = plane(card('a', 0, 0), card('b', 400, 0))
    const [reader, agent] = joined(start)

    // At the same moment: the reader drags card a, the agent rewrites card b and adds
    // one, each against the plane as they had it.
    const theirs = readPlane(reader)
    const moved = stamped(theirs, movedBy(theirs, ['a'], 80, 40), 2000)
    reader.transact(() => pushPlane(reader, theirs, moved), 'here')

    const mine = readPlane(agent)
    const { canvas, made } = applied(mine, [
      { op: 'edit_text', id: 'b', text: 'Rewritten' },
      { op: 'add_card', text: 'From the agent' },
    ])
    agent.transact(() => pushPlane(agent, mine, stamped(mine, canvas, 2001)), 'agent')

    exchange(reader, agent)

    for (const doc of [reader, agent]) {
      const now = readPlane(doc)
      expect(now.nodes.find((one) => one.id === 'a')).toMatchObject({ x: 80, y: 40 })
      expect(textOf(now, 'b')).toBe('Rewritten')
      expect(textOf(now, made[0] ?? '')).toBe('From the agent')
    }
  })

  test('keeps both where they touched one card: the reader moved it, the agent wrote in it', () => {
    const start = plane(card('a', 0, 0))
    const [reader, agent] = joined(start)

    const theirs = readPlane(reader)
    reader.transact(
      () => pushPlane(reader, theirs, stamped(theirs, movedBy(theirs, ['a'], 10, 0), 2000)),
      'here',
    )
    const mine = readPlane(agent)
    const { canvas } = applied(mine, [{ op: 'edit_text', id: 'a', text: 'Both' }])
    agent.transact(() => pushPlane(agent, mine, stamped(mine, canvas, 2001)), 'agent')

    exchange(reader, agent)

    expect(readPlane(reader).nodes[0]).toMatchObject({ x: 10, text: 'Both' })
    expect(readPlane(agent).nodes[0]).toMatchObject({ x: 10, text: 'Both' })
  })

  test('keeps what landed in the file while the agent worked, out of a room', () => {
    const before = plane(card('a', 0, 0))
    const { canvas } = applied(before, [{ op: 'add_card', text: 'Agent' }])
    const mine = stamped(before, canvas, 2000)

    // The reader drew a card of their own in the meantime, and it was written.
    const written = stamped(
      before,
      { ...before, nodes: [...before.nodes, card('r', 0, 300)] },
      1999,
    )
    const kept = merged(mine, written, 3000)

    expect(kept.nodes.map((one) => one.id).sort()).toEqual(
      ['a', 'r', ...canvas.nodes.slice(1).map((one) => one.id)].sort(),
    )
  })
})
