import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  type Canvas,
  type CanvasNode,
  emptyCanvas,
  type InkPoint,
  type InkStroke,
  writeCanvas,
} from '@nib/markdown/canvas'
import { merged, stamped } from '@nib/markdown/canvas-merge'
import { buriedOf, planeIsEmpty, planeOf, pushPlane, readPlane, seedPlane } from './plane'

/** Two devices on one plane, each with its own document, joined by hand: whatever
 *  one writes the other is given, which is the whole of what a room does without a
 *  room in the way. */
class Device {
  readonly doc = new Y.Doc()

  /** The canvas this device is looking at. */
  canvas: Canvas = emptyCanvas()

  /** Which ids the last change from the room touched, which is what the surface
   *  is told so it can keep the objects it already had. */
  changed = new Set<string>()

  constructor() {
    this.doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.local) return
      this.changed = touched(transaction)
      this.canvas = readPlane(this.doc, this.canvas, this.changed)
    })
  }

  /** An edit made here, as the surface makes one: the whole canvas, stamped, and
   *  only what changed written into the document. */
  edit(next: Canvas, now = 1000) {
    const before = this.canvas
    this.canvas = stamped(before, next, now)
    this.doc.transact(() => pushPlane(this.doc, before, this.canvas), 'here')
  }

  /** Reads the plane back from scratch, which is what joining does. */
  reread() {
    this.canvas = readPlane(this.doc)
  }
}

/** Which ids a transaction touched: the entries of the plane that changed, and
 *  the objects whose own fields did. */
function touched(transaction: Y.Transaction): Set<string> {
  const ids = new Set<string>()

  for (const [type, keys] of transaction.changed) {
    const parent = type._item
    if (parent === null) {
      // A root map: the plane itself, or the tombstones. Its keys are ids.
      for (const key of keys) {
        if (key !== null) ids.add(key)
      }
      continue
    }

    // An object's own map, or a card's words inside it. Which object it is is the key
    // the object's own map hangs on, however far down the change was.
    let item = parent
    while (item.parent instanceof Y.AbstractType && item.parent._item) item = item.parent._item
    const key = item.parentSub
    if (key !== null) ids.add(key)
  }

  return ids
}

/** Everything one device holds, handed to another. */
function carry(from: Device, to: Device) {
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)), 'room')
}

function both(one: Device, other: Device) {
  const first = Y.encodeStateAsUpdate(one.doc, Y.encodeStateVector(other.doc))
  const second = Y.encodeStateAsUpdate(other.doc, Y.encodeStateVector(one.doc))
  Y.applyUpdate(other.doc, first, 'room')
  Y.applyUpdate(one.doc, second, 'room')
}

function card(id: string, x = 0, y = 0, text = id): CanvasNode {
  return { id, type: 'text', x, y, width: 250, height: 60, text }
}

function points(count: number): InkPoint[] {
  return Array.from({ length: count }, (_, at) => ({
    x: at * 3,
    y: Math.round(Math.sin(at / 5) * 40),
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    t: at * 8,
  }))
}

function stroke(id: string, count = 4, colour = '1'): InkStroke {
  return { id, tool: 'pen', color: colour, size: 6, points: points(count) }
}

function withNodes(canvas: Canvas, nodes: CanvasNode[]): Canvas {
  return { ...canvas, nodes }
}

function withInk(canvas: Canvas, ink: InkStroke[]): Canvas {
  return { ...canvas, ink }
}

describe('a canvas as a room holds it', () => {
  test('a room nobody has joined is empty, and a seeded one is not', () => {
    const doc = new Y.Doc()
    expect(planeIsEmpty(doc)).toBe(true)

    seedPlane(doc, { ...emptyCanvas(), nodes: [card('a')] })
    expect(planeIsEmpty(doc)).toBe(false)
  })

  test('a file seeded in and read back out is the same file', () => {
    const canvas: Canvas = {
      nodes: [
        card('a', 10, 20),
        { id: 'g', type: 'group', x: -40, y: -40, width: 400, height: 300, label: 'Ideas' },
        { id: 's', type: 'shape', shape: 'arrow', x: 0, y: 0, width: 120, height: 80, up: true },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'g', toEnd: 'arrow' }],
      ink: [stroke('i', 6)],
      at: { a: 5, g: 6, s: 7, e: 8, i: 9 },
      gone: { old: 4 },
    }

    const doc = new Y.Doc()
    seedPlane(doc, canvas)

    // Byte for byte as a file, which is what the settle writes.
    expect(writeCanvas(readPlane(doc))).toBe(writeCanvas(canvas))
  })

  test('a stroke is one entry however many points it has', () => {
    const doc = new Y.Doc()
    seedPlane(doc, withInk(emptyCanvas(), [stroke('long', 300)]))

    const record = planeOf(doc).get('long')
    expect(record).toBeDefined()
    // The points are one value, packed as a file packs them: six numbers a point.
    expect(record?.get('points')).toHaveLength(300 * 6)
    expect(readPlane(doc).ink[0]?.points).toHaveLength(300)
  })
})

describe('two devices on one plane', () => {
  test('edits to different objects never conflict', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)

    // Each moves a different card, neither having heard the other.
    one.edit(withNodes(one.canvas, [{ ...card('a'), x: 100 }, card('b')]), 2000)
    two.edit(withNodes(two.canvas, [card('a'), { ...card('b'), y: 200 }]), 2000)
    both(one, two)

    for (const device of [one, two]) {
      expect(device.canvas.nodes.find((node) => node.id === 'a')?.x).toBe(100)
      expect(device.canvas.nodes.find((node) => node.id === 'b')?.y).toBe(200)
    }
  })

  test('edits to the same object resolve one field at a time', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a')]))
    carry(one, two)

    // One moves it, the other colours it. Both are true afterwards.
    one.edit(withNodes(one.canvas, [{ ...card('a'), x: 300, y: 40 }]), 2000)
    two.edit(withNodes(two.canvas, [{ ...card('a'), color: '4' }]), 2000)
    both(one, two)

    for (const device of [one, two]) {
      const node = device.canvas.nodes[0]
      expect(node?.x).toBe(300)
      expect(node?.y).toBe(40)
      expect(node?.color).toBe('4')
    }
  })

  test("edits to one card's words made apart are both kept, as prose merges", () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a', 0, 0, 'We ship on Monday.')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [card('a', 0, 0, 'We ship on Monday morning.')]), 2000)
    two.edit(withNodes(two.canvas, [card('a', 0, 0, 'Maybe we ship on Monday.')]), 2100)
    both(one, two)

    for (const device of [one, two]) {
      const node = device.canvas.nodes[0]
      expect(node && 'text' in node ? node.text : null).toBe('Maybe we ship on Monday morning.')
    }
    // And the file is the one a string would have written.
    expect(writeCanvas(one.canvas)).toBe(writeCanvas(two.canvas))
  })

  test('two strokes drawn at the same moment are both kept, in the same order', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('base')]))
    carry(one, two)

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('mine', 5, '2')]), 2000)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('yours', 5, '3')]), 2000)
    both(one, two)

    expect(one.canvas.ink.map((held) => held.id)).toEqual(two.canvas.ink.map((held) => held.id))
    expect(new Set(one.canvas.ink.map((held) => held.id))).toEqual(
      new Set(['base', 'mine', 'yours']),
    )
    // The one that was already there stays under both of them.
    expect(one.canvas.ink[0]?.id).toBe('base')
  })

  test('a stroke crossing to the other device keeps every point', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('drawn', 300)]))
    carry(one, two)

    const held = two.canvas.ink[0]
    expect(held?.points).toHaveLength(300)
    expect(held?.points[299]).toMatchObject({ x: 299 * 3, t: 299 * 8 })
  })

  test('a delete travels, and stays deleted', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [card('b')]), 2000)
    carry(one, two)

    expect(two.canvas.nodes.map((node) => node.id)).toEqual(['b'])
    expect(two.canvas.gone.a).toBe(2000)
  })

  test('a card put back after a delete loses its tombstone', () => {
    const one = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a')]))
    one.edit(withNodes(one.canvas, []), 2000)
    expect(buriedOf(one.doc).get('a')).toBe(2000)

    one.edit(withNodes(one.canvas, [card('a')]), 3000)
    expect(buriedOf(one.doc).get('a')).toBeUndefined()
    expect(one.canvas.nodes.map((node) => node.id)).toEqual(['a'])
  })

  test('a device that was away merges what it drew without losing either drawing', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('shared')]))
    carry(one, two)

    // Two goes away. Both draw.
    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('while-away-one')]), 2000)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('while-away-two')]), 2100)
    both(one, two)

    for (const device of [one, two]) {
      expect(new Set(device.canvas.ink.map((held) => held.id))).toEqual(
        new Set(['shared', 'while-away-one', 'while-away-two']),
      )
    }
  })

  test('a plane read afresh is the plane read a change at a time', () => {
    const one = new Device()
    const two = new Device()

    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)
    one.edit(withInk(withNodes(one.canvas, [card('a'), card('b'), card('c')]), [stroke('i')]), 2000)
    carry(one, two)
    one.edit(withNodes(one.canvas, [card('a'), card('c')]), 3000)
    carry(one, two)

    const followed = writeCanvas(two.canvas)
    two.reread()
    expect(writeCanvas(two.canvas)).toBe(followed)
  })

  test('an object the room did not touch comes back as the very same object', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('first', 200), stroke('second', 200)]))
    carry(one, two)

    const before = two.canvas.ink
    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('third')]), 2000)
    carry(one, two)

    // The identity is what keeps a traced outline cached and a plane of five
    // thousand strokes from being repainted because somebody drew one.
    expect(two.canvas.ink[0]).toBe(before[0])
    expect(two.canvas.ink[1]).toBe(before[1])
    expect(two.canvas.ink[2]?.id).toBe('third')
  })

  test('an edge whose card has gone is not written into the file', () => {
    const one = new Device()
    one.edit({
      ...emptyCanvas(),
      nodes: [card('a'), card('b')],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
    })

    one.edit({ ...one.canvas, nodes: [card('a')] }, 2000)
    expect(readPlane(one.doc).edges).toEqual([])
  })
})

describe('the room and the file say the same thing', () => {
  test('what the room settles to is what merging the two files gives', () => {
    // The same two edits, once through the room and once as two files put back
    // together by the merge an offline device uses. Both answers have to hold
    // every stroke, which is the promise the format makes.
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('shared')]))
    carry(one, two)

    const base = one.canvas
    const mine = stamped(base, withInk(base, [...base.ink, stroke('mine')]), 2000)
    const yours = stamped(base, withInk(base, [...base.ink, stroke('yours')]), 2100)

    one.edit(withInk(base, [...base.ink, stroke('mine')]), 2000)
    two.edit(withInk(base, [...base.ink, stroke('yours')]), 2100)
    both(one, two)

    const asFiles = merged(mine, yours, 3000)
    expect(new Set(one.canvas.ink.map((held) => held.id))).toEqual(
      new Set(asFiles.ink.map((held) => held.id)),
    )
  })
})
