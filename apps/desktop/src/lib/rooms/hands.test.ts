import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { awarenessUpdate, receive } from '@nib/rooms'
import { planeOf } from '@nib/rooms/plane'
import * as Y from 'yjs'
import type { InkStroke } from '../canvas/format'
import { HAND, handsIn, saidHand } from './hands'

/** Two devices on one plane, each with its own awareness. What is measured is
 *  whether one can say where its hand is and what it is drawing, and the other can
 *  read it back as something to draw. */
function pair() {
  const one = new Y.Doc()
  const two = new Y.Doc()
  // The plane itself, so both documents have the same root and neither is empty.
  planeOf(one)
  planeOf(two)

  return {
    one: { doc: one, awareness: new Awareness(one) },
    two: { doc: two, awareness: new Awareness(two) },
  }
}

/** What one device says, reaching the other, over the wire both ends really use. */
function tell(
  from: { doc: Y.Doc; awareness: Awareness },
  to: { doc: Y.Doc; awareness: Awareness },
) {
  receive(awarenessUpdate(from.awareness, [from.doc.clientID]), to.doc, to.awareness, 'room')
}

function stroke(count: number): InkStroke {
  return {
    id: 'live',
    tool: 'highlighter',
    color: '3',
    size: 12,
    points: Array.from({ length: count }, (_, at) => ({
      x: at * 2,
      y: at,
      pressure: 0.6,
      tiltX: 3,
      tiltY: -2,
      t: at * 8,
    })),
  }
}

describe('whose hand is on the plane', () => {
  test('is nobody when nobody has said anything', () => {
    const { two } = pair()
    expect(handsIn(two.awareness, two.doc, 'dark')).toEqual({
      present: 0,
      hands: [],
      seen: { people: [], mine: 0 },
    })
  })

  test('never counts the device asking', () => {
    const { one } = pair()
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 5, y: 6 }, null))

    expect(handsIn(one.awareness, one.doc, 'dark').present).toBe(0)
  })

  test('is somebody on the plane before they have moved a pointer', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    tell(one, two)

    const found = handsIn(two.awareness, two.doc, 'dark')
    expect(found.present).toBe(1)
    expect(found.hands).toEqual([])
  })

  test('carries a name, a pointer and the shade the scheme needs', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Android', accent: 'teal' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 12.34, y: -8.7 }, null))
    tell(one, two)

    const { present, hands } = handsIn(two.awareness, two.doc, 'dark')
    expect(present).toBe(1)
    expect(hands).toHaveLength(1)
    expect(hands[0]).toMatchObject({ id: one.doc.clientID, name: 'Android' })
    // Rounded to a tenth of a plane unit, which is finer than any hand is steady.
    expect(hands[0]?.at).toEqual({ x: 12.3, y: -8.7 })

    // Teal, in the shade a dark background needs; the light one is another value.
    expect(hands[0]?.colour).toBe('#33c7ba')
    expect(handsIn(two.awareness, two.doc, 'light').hands[0]?.colour).not.toBe('#33c7ba')
  })

  test('carries how much of the colour the dial was set to land', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'iPhone', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 0, y: 0 }, { ...stroke(4), opacity: 0.3 }))
    tell(one, two)

    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke?.opacity).toBe(0.3)

    // And a pen nobody turned the dial on says nothing about it, exactly as a
    // file written before there was a dial says nothing.
    one.awareness.setLocalStateField(HAND, saidHand({ x: 0, y: 0 }, stroke(4)))
    tell(one, two)
    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke?.opacity).toBeUndefined()
  })

  test('carries the stroke under the pen, whole', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'iPhone', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 0, y: 0 }, stroke(300)))
    tell(one, two)

    const held = handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke
    expect(held?.points).toHaveLength(300)
    expect(held?.tool).toBe('highlighter')
    expect(held?.color).toBe('3')
    expect(held?.points[299]).toMatchObject({ x: 598, tiltX: 3, tiltY: -2 })
  })

  test("a live stroke is nobody's object, so it cannot be picked or erased", () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'iPhone', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 0, y: 0 }, stroke(4)))
    tell(one, two)

    // Named after the hand rather than after the stroke: it is not on the plane, so
    // it must not share an id with anything that is.
    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke?.id).toBe(
      `hand:${one.doc.clientID}`,
    )
    expect(planeOf(two.doc).size).toBe(0)
  })

  test('a pen lifted takes the stroke away and leaves the pointer', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 4, y: 4 }, stroke(6)))
    tell(one, two)
    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke).not.toBeNull()

    one.awareness.setLocalStateField(HAND, saidHand({ x: 4, y: 4 }, null))
    tell(one, two)

    const hand = handsIn(two.awareness, two.doc, 'dark').hands[0]
    expect(hand?.stroke).toBeNull()
    expect(hand?.at).toEqual({ x: 4, y: 4 })
  })

  test('a hand that left the plane draws nothing and is still somebody there', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue' })
    one.awareness.setLocalStateField(HAND, null)
    tell(one, two)

    const found = handsIn(two.awareness, two.doc, 'dark')
    expect(found.present).toBe(1)
    expect(found.hands).toEqual([])
  })

  test('a stroke that does not read as one is left out rather than drawn wrong', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue' })
    // A tool this build has never heard of, and a stroke of one point.
    one.awareness.setLocalStateField(HAND, {
      x: 1,
      y: 2,
      ink: { tool: 'airbrush', color: '1', size: 3, points: [0, 0, 0.5, 0, 0, 0] },
    })
    tell(one, two)

    const hand = handsIn(two.awareness, two.doc, 'dark').hands[0]
    expect(hand?.at).toEqual({ x: 1, y: 2 })
    expect(hand?.stroke).toBeNull()
  })

  test('a stroke is held to what a stroke in a file is held to', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue' })
    // A pen no dial in this app can be turned to: what arrives over awareness was
    // written by another machine, and a size the paint cannot use or an opacity
    // past one are the same thing here as they are in a file.
    one.awareness.setLocalStateField(HAND, {
      x: 1,
      y: 2,
      ink: {
        tool: 'pen',
        color: '1',
        size: -4,
        opacity: 900,
        points: [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8],
      },
    })
    tell(one, two)

    const drawn = handsIn(two.awareness, two.doc, 'dark').hands[0]?.stroke
    expect(drawn?.size).toBeGreaterThan(0)
    expect(drawn?.opacity).toBeLessThanOrEqual(1)
  })

  test('is named by the machine among one person, and by the person among two', () => {
    const { one, two } = pair()
    one.awareness.setLocalStateField('who', { name: 'Android', accent: 'teal', person: 'Emil' })
    one.awareness.setLocalStateField(HAND, saidHand({ x: 0, y: 0 }, null))
    tell(one, two)

    // Two of one person's own machines: the machine is the answer.
    two.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue', person: 'Emil' })
    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.name).toBe('Android')

    // Two people: the person is.
    two.awareness.setLocalStateField('who', { name: 'Windows', accent: 'blue', person: 'Ada' })
    expect(handsIn(two.awareness, two.doc, 'dark').hands[0]?.name).toBe('Emil')
  })
})
