/** A canvas whose tab has moved on to another file, with its room still joined.
 *
 *  The note's room is asked on every change whether the document is still on the
 *  file it was joined for, because the one preview tab takes another note on in the
 *  same document and the pairing of documents to rooms catches up a beat later; see
 *  `holds` in room.ts and the whole of switching.test.ts. A canvas's room is the same
 *  room about a different kind of file, and the same beat is the same accident: a
 *  plane pushed into the file the tab came from is one drawing written over another.
 *
 *  Nothing in the app hands a canvas tab another canvas today - a plane arrives with
 *  its surface and goes with it, so `holds` is only ever asked and only ever answers
 *  yes. These tests are what says the guard is the room's rather than the note's:
 *  they move the surface on by hand, which is exactly what a canvas tab that learns
 *  to preview would do, and measure that nothing crosses in either direction.
 *
 *  Everything here is real but the socket: the document, the plane in it, the
 *  binding, the merge when the room answers. The other end of the socket is the room
 *  in the Worker, driven by the very same protocol module both ends use.
 */

import { describe, expect, test, vi } from 'vitest'
import { receive, syncUpdate } from '@nib/rooms'
import { readPlane, seedPlane } from '@nib/rooms/plane'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { type Canvas, type CanvasNode, emptyCanvas } from '../canvas/format'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from '../canvas/shared'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false

    constructor(
      readonly noteId: string,
      readonly token: string,
      readonly wire: Wire,
    ) {
      opened.push(this)
    }

    get open(): boolean {
      return this.up
    }

    arrive() {
      this.up = true
      this.wire.opened()
    }

    take(): Uint8Array[] {
      const said = this.sent
      this.sent = []
      return said
    }

    start() {
      // The real one connects here; this one waits to be told it is up.
    }

    send(message: Uint8Array): boolean {
      if (!this.up) return false

      this.sent.push(message)
      return true
    }

    stop() {
      this.up = false
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))

const { PlaneRoom } = await import('./plane')

/** The room in the Worker, as far as the protocol is concerned, seeded from the file
 *  the account holds. What a settle would write back into that file is `plane` - so
 *  reading it is the whole test: a room holding the other canvas's objects has
 *  already lost this one's. */
class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(canvas: Canvas) {
    this.doc.transact(() => seedPlane(this.doc, canvas), 'room')
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  /** Somebody else drawing in this canvas on their own device, and the room passing
   *  it on to this one. */
  elsewhere(canvas: Canvas, socket: InstanceType<typeof sockets.FakeSocket>) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.transact(() => seedPlane(this.doc, canvas), 'socket')
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  get plane(): Canvas {
    return readPlane(this.doc)
  }
}

/** The little of `CanvasStore` a room touches: the plane it holds, what the room
 *  says arrived, and who else is drawing. */
class Surface implements PlaneSurface {
  canvas: Canvas
  shared: SharedPlane | null = null
  hands: readonly Hand[] = []
  reachable: Reachable = { undo: false, redo: false }
  /** How many times the room has handed this surface a plane. */
  arrivals = 0

  constructor(canvas: Canvas) {
    this.canvas = canvas
  }

  arrived(canvas: Canvas) {
    this.canvas = canvas
    this.arrivals++
  }

  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs(reachable: Reachable) {
    this.reachable = reachable
  }
}

function socketOf(): InstanceType<typeof sockets.FakeSocket> {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the room opened no socket')

  return socket
}

function card(id: string, x = 0): CanvasNode {
  return { id, type: 'text', x, y: 0, width: 250, height: 60, text: id }
}

function drawn(...nodes: CanvasNode[]): Canvas {
  return { ...emptyCanvas(), nodes }
}

/** Everything the device has said, into the room, and everything the room says back.
 *  What the network does, done by hand. */
function carry(socket: InstanceType<typeof sockets.FakeSocket>, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

/** A canvas open in a tab, joined to its room: the surface, the room in the Worker,
 *  and the switch the app throws when the tab moves on to another file.
 *
 *  `holds` is what `rooms.svelte.ts` hands over - how many files the document has
 *  held, compared with how many it had held when the room was joined. `moveOn` is
 *  that count going up, which is the click the pairing has not caught up with yet. */
function joining(file: Canvas, room: Canvas) {
  const surface = new Surface(file)
  const server = new Server(room)
  let arrivals = 0

  const plane = new PlaneRoom({
    noteId: 'c1',
    token: 'session',
    surface,
    who: { name: 'Mac', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    gone: () => undefined,
    refused: () => undefined,
    holds: () => arrivals === 0,
  })

  return {
    surface,
    server,
    room: plane,
    socket: socketOf(),
    moveOn: () => {
      arrivals += 1
    },
  }
}

/** Long enough for the greeting to have been answered. The door awaits whoever it
 *  told, so being caught up is a turn away even where the canvas answers at once. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A canvas joined to its room and caught up with it: the greeting answered, the two
 *  planes merged, and every stroke from here going both ways. Where the tests start.
 */
async function inTheRoom(file: Canvas, room: Canvas) {
  const held = joining(file, room)
  held.socket.arrive()
  carry(held.socket, held.server)
  await settled()
  carry(held.socket, held.server)

  return held
}

function ids(canvas: Canvas): string[] {
  return canvas.nodes.map((node) => node.id)
}

describe('a canvas tab that has moved on to another file', () => {
  test('leaves the room it came from holding its own plane', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))
    expect(held.room.settled).toBe(true)

    held.moveOn()
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a'])
  })

  test('does not push what is drawn in the new canvas into the old one’s room', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    // The click, and then a card dropped on the plane before the pairing has caught
    // up. Those objects are the other canvas's.
    held.moveOn()
    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a'])
  })

  test('does not take the old canvas’s objects into the new one', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))
    const arrivals = held.surface.arrivals

    held.moveOn()

    // Another device draws in the canvas the tab came from, in that same beat. It is
    // not this surface's file any more, so nothing it says belongs on this plane.
    held.server.elsewhere(drawn(card('a'), card('elsewhere', 800)), held.socket)
    carry(held.socket, held.server)

    expect(ids(held.surface.canvas)).toEqual(['a'])
    expect(held.surface.arrivals).toBe(arrivals)
  })

  test('takes nothing back either, an undo being an edit like any other', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)
    expect(ids(held.server.plane)).toEqual(['a', 'b'])

    held.moveOn()

    expect(held.room.undo()).toBe(false)
    expect(held.room.redo()).toBe(false)
    carry(held.socket, held.server)
    expect(ids(held.server.plane)).toEqual(['a', 'b'])
  })
})

describe('a room answering after the tab has moved on', () => {
  test('neither merges the two planes nor hands the surface the room', async () => {
    const held = joining(drawn(card('mine')), drawn(card('theirs')))
    held.socket.arrive()

    // The greeting is in the air and the click lands inside the round trip.
    held.moveOn()
    carry(held.socket, held.server)
    await settled()
    carry(held.socket, held.server)

    // The room keeps what it held, this surface keeps what it holds, and the surface
    // was never joined - so nothing it draws next can reach this room.
    expect(ids(held.server.plane)).toEqual(['theirs'])
    expect(ids(held.surface.canvas)).toEqual(['mine'])
    expect(held.surface.shared).toBeNull()
  })

  test('a room that has been left carries nothing at all', async () => {
    const held = joining(drawn(card('mine')), drawn(card('theirs')))
    held.socket.arrive()

    // Signing out, or the last tab closing: the room goes while its greeting is in
    // the air, and what it was about to do must not happen behind it.
    held.room.leave()
    carry(held.socket, held.server)
    await settled()
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['theirs'])
    expect(held.surface.shared).toBeNull()
  })
})

describe('a canvas whose tab has not moved on', () => {
  test('merges both planes, keeping what each side had', async () => {
    const held = await inTheRoom(drawn(card('mine')), drawn(card('theirs', 400)))

    expect(ids(held.surface.canvas).sort()).toEqual(['mine', 'theirs'])
    expect(held.surface.shared).not.toBeNull()
  })

  test('and every edit made here reaches the room', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    const before = held.surface.canvas
    held.surface.canvas = drawn(card('a'), card('b', 400))
    held.room.push(before, held.surface.canvas)
    carry(held.socket, held.server)

    expect(ids(held.server.plane)).toEqual(['a', 'b'])
  })

  test('and what another device draws reaches the surface', async () => {
    const held = await inTheRoom(drawn(card('a')), drawn(card('a')))

    held.server.elsewhere(drawn(card('a'), card('theirs', 400)), held.socket)
    carry(held.socket, held.server)

    expect(ids(held.surface.canvas).sort()).toEqual(['a', 'theirs'])
  })
})
