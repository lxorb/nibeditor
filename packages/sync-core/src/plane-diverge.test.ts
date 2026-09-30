import { type Canvas, type CanvasNode, emptyCanvas } from '@nib/markdown/canvas'
import { describe, expect, test } from 'vitest'
import { divergePlane } from './plane-diverge'

const LOCAL_NEWER = { local: 2, remote: 1 }
const REMOTE_NEWER = { local: 1, remote: 2 }

function card(id: string, text: string, fields: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'text', text, x: 0, y: 0, width: 200, height: 100, ...fields } as CanvasNode
}

function plane(...nodes: CanvasNode[]): Canvas {
  return { ...emptyCanvas(), nodes }
}

function textOf(canvas: Canvas | null, id: string): string | undefined {
  const node = canvas?.nodes.find((one) => one.id === id)
  return node && 'text' in node ? node.text : undefined
}

describe('divergePlane', () => {
  test('one side moved a card, the other recoloured it: both stand, silently', () => {
    const base = plane(card('a', 'Idea'))
    const local = plane(card('a', 'Idea', { x: 300 }))
    const remote = plane(card('a', 'Idea', { color: '4' }))

    const result = divergePlane(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.resolution?.nodes[0]).toMatchObject({ x: 300, color: '4' })
  })

  test('a colour taken away on one side stays away while the other side moves the card', () => {
    const base = plane(card('a', 'Idea', { color: '2' }))
    const result = divergePlane(
      base,
      plane(card('a', 'Idea')),
      plane(card('a', 'Idea', { color: '2', y: 50 })),
      REMOTE_NEWER,
    )
    expect(result.resolution?.nodes[0]).toMatchObject({ y: 50 })
    expect(result.resolution?.nodes[0]).not.toHaveProperty('color')
  })

  test('both moved one card: the newer place, and no question', () => {
    const base = plane(card('a', 'Idea'))
    const result = divergePlane(
      base,
      plane(card('a', 'Idea', { x: 100 })),
      plane(card('a', 'Idea', { x: 900 })),
      REMOTE_NEWER,
    )
    expect(result.verdict).toBe('minor')
    expect(result.resolution?.nodes[0]).toMatchObject({ x: 900 })
  })

  test("both edited a card's text in different places: merged like prose", () => {
    const base = plane(card('a', 'The first line.\n\nThe second line.'))
    const local = plane(card('a', 'The first line, edited.\n\nThe second line.'))
    const remote = plane(card('a', 'The first line.\n\nThe second line, edited.'))

    const result = divergePlane(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('minor')
    expect(textOf(result.resolution, 'a')).toBe(
      'The first line, edited.\n\nThe second line, edited.',
    )
  })

  test("both rewrote a card's sentence: it asks", () => {
    const base = plane(card('a', 'We should ship the release on Monday after the review.'))
    const local = plane(card('a', 'Let us hold the release until every reviewer has signed off.'))
    const remote = plane(card('a', 'The release goes out Friday morning, whatever they say.'))

    const result = divergePlane(base, local, remote, LOCAL_NEWER)
    expect(result.verdict).toBe('diverged')
    expect(result.resolution).toBeNull()
    expect(result.overlaps).toEqual([{ id: 'a', field: 'text', newer: 'local', asks: true }])
  })

  test('a card deleted on one side and rewritten on the other asks', () => {
    const base = plane(card('a', 'Buy milk'))
    const result = divergePlane(
      base,
      plane(),
      plane(card('a', 'Buy milk and eggs and bread and cheese')),
      LOCAL_NEWER,
    )
    expect(result.verdict).toBe('diverged')
    expect(result.overlaps).toEqual([{ id: 'a', field: 'deleted', newer: 'local', asks: true }])
  })

  test('a card deleted on one side and nudged on the other: the newer side decides', () => {
    const base = plane(card('a', 'Buy milk'))
    const nudged = plane(card('a', 'Buy milk', { x: 10 }))

    expect(divergePlane(base, plane(), nudged, LOCAL_NEWER).resolution?.nodes).toEqual([])
    expect(divergePlane(base, plane(), nudged, REMOTE_NEWER).resolution?.nodes).toHaveLength(1)
  })

  test('a card deleted on one side and untouched on the other is gone', () => {
    const base = plane(card('a', 'Old'), card('b', 'Stays'))
    const result = divergePlane(base, plane(card('b', 'Stays')), base, REMOTE_NEWER)
    expect(result.verdict).toBe('clean')
    expect(result.resolution?.nodes.map((node) => node.id)).toEqual(['b'])
  })

  test('cards added on both sides are all kept, and an edge to a card that went goes too', () => {
    const base = plane(card('a', 'A'), card('b', 'B'))
    const local: Canvas = {
      ...plane(card('a', 'A'), card('b', 'B'), card('c', 'C')),
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
    }
    const remote = plane(card('a', 'A'), card('d', 'D'))

    const result = divergePlane(base, local, remote, LOCAL_NEWER)
    expect(result.resolution?.nodes.map((node) => node.id).sort()).toEqual(['a', 'c', 'd'])
    expect(result.resolution?.edges).toEqual([])
  })
})
