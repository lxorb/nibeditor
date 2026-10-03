import { describe, expect, test, vi } from 'vitest'
import { SharedDoc } from '@nib/editor'
import { readSync, receive, syncStep1, TEXT } from '@nib/rooms'
import { ackFrame, epochFrame, NEW_EPOCH } from '@nib/sync-core/wire'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Carrying } from './carried'

/** Sync v2's room carrying the engine's own document (docs/sync-v2.md 5.2 to 5.4), with
 *  the socket stood in for and the test playing the room in the Worker with the same
 *  protocol module both ends use. What matters: a document with nothing pending meets
 *  the room the ordinary way; one with pending edits opens with its confirmed state,
 *  reads the room's words without applying them until the engine has classified, sends
 *  nothing it typed meanwhile, and on a hold stays out and sends nothing at all. */

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number, said: string) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false
    stopped = false

    constructor(
      readonly noteId: string,
      readonly token: string,
      readonly wire: Wire,
      readonly offers: readonly string[] = [],
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
      // Waits to be told it is up.
    }

    send(message: Uint8Array): boolean {
      if (!this.up) return false
      this.sent.push(message)
      return true
    }

    close(code: number) {
      this.up = false
      this.wire.closed(code, '')
    }

    stop() {
      this.up = false
      this.stopped = true
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))

const { CarriedRoom, CarriedPlaneRoom } = await import('./carried')

/** The room in the Worker, as far as the protocol is concerned. */
class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  get words(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

/** One account's document, seeded once and handed to both ends. */
function seeded(words: string): Uint8Array {
  const doc = new Y.Doc()
  doc.clientID = 1
  doc.getText(TEXT).insert(0, words)
  return Y.encodeStateAsUpdate(doc)
}

interface Device {
  doc: Y.Doc
  confirmed: Uint8Array
  pending: boolean
  verdict: 'go' | 'hold'
  met: Uint8Array[]
  acks: [number, Uint8Array][]
  epochs: number[]
  live: boolean[]
  gone: number
}

function carrying(device: Device): Carrying {
  return {
    doc: device.doc,
    device: 'laptop-device',
    pending: () => device.pending,
    confirmedSv: () => Y.encodeStateVectorFromUpdate(device.confirmed),
    met: (update) => {
      device.met.push(update)
      // The engine takes the room's words into the document when it goes ahead.
      if (device.verdict === 'go') Y.applyUpdate(device.doc, update, 'pulled')
      return Promise.resolve(device.verdict)
    },
    acked: (seq, sv) => device.acks.push([seq, sv]),
    epoch: (epoch) => device.epochs.push(epoch),
    live: (on) => device.live.push(on),
  }
}

function join(device: Device) {
  const note = new SharedDoc(device.doc.getText(TEXT).toJSON())
  const room = new CarriedRoom({
    noteId: 'note-1',
    token: 'token',
    who: { name: 'Laptop', accent: '#000' },
    scheme: 'light',
    onPeers: () => undefined,
    gone: () => (device.gone += 1),
    refused: () => undefined,
    holds: () => true,
    note,
    carrying: carrying(device),
  })
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('no socket')
  return { room, socket }
}

/** A device holding the account's seed, and optionally its own words on top. */
function device(account: Uint8Array, typed?: string): Device {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, account)
  doc.clientID = 77
  if (typed) doc.getText(TEXT).insert(doc.getText(TEXT).length, typed)
  return {
    doc,
    confirmed: account,
    pending: !!typed,
    verdict: 'go',
    met: [],
    acks: [],
    epochs: [],
    live: [],
    gone: 0,
  }
}

/** Plays the room's side of the greeting: its own question, and the answer to the
 *  device's. */
async function greet(server: Server, socket: InstanceType<typeof sockets.FakeSocket>) {
  socket.wire.heard(syncStep1(server.doc))
  for (const message of socket.take()) {
    const answer = server.answer(message)
    if (answer) socket.wire.heard(answer)
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (const message of socket.take()) server.answer(message)
}

describe('a room carrying the engine’s document', () => {
  test('offers nib.v2 and the device, and with nothing pending meets the room as v1 does', async () => {
    const account = seeded('We ship on Monday.')
    const server = new Server()
    Y.applyUpdate(server.doc, account)
    server.doc.getText(TEXT).insert(0, 'Room: ')
    const one = device(account)
    const { socket } = join(one)

    expect(socket.offers).toEqual(['nib.v2', 'nib.device.laptop-device'])
    socket.arrive()
    await greet(server, socket)

    expect(one.doc.getText(TEXT).toJSON()).toBe('Room: We ship on Monday.')
    expect(one.met).toEqual([])
    expect(one.live).toEqual([true])
  })

  test('with pending edits, opens with the confirmed state and sends nothing until it is met', async () => {
    const account = seeded('We ship on Monday.')
    const server = new Server()
    Y.applyUpdate(server.doc, account)
    server.doc.getText(TEXT).insert(0, 'Room: ')
    const one = device(account, ' Laptop.')
    const { socket } = join(one)
    socket.arrive()

    const [question] = socket.take()
    const read = question ? readSync(question) : null
    expect(read?.kind).toBe('step1')
    expect(read && 'sv' in read ? [...read.sv] : []).toEqual([
      ...Y.encodeStateVectorFromUpdate(account),
    ])

    // Typed while the room was being met: not sent yet.
    one.doc.getText(TEXT).insert(0, '>')
    expect(socket.take()).toEqual([])
    socket.wire.heard(syncStep1(server.doc))
    const answer = server.answer(question ?? new Uint8Array())
    if (answer) socket.wire.heard(answer)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The room's words came to the engine as an update; nothing of the device's own.
    expect(one.met).toHaveLength(1)
    for (const message of socket.take()) server.answer(message)
    expect(server.words).toBe('>Room: We ship on Monday. Laptop.')
    expect(one.doc.getText(TEXT).toJSON()).toBe('>Room: We ship on Monday. Laptop.')
    expect(one.live).toEqual([true])
  })

  test('a note held for the question stays out, reading and sending nothing', async () => {
    const account = seeded('We ship on Monday.')
    const server = new Server()
    Y.applyUpdate(server.doc, account)
    server.doc.getText(TEXT).insert(0, 'Room: ')
    const one = device(account, ' Laptop.')
    one.verdict = 'hold'
    const { socket } = join(one)
    socket.arrive()
    await greet(server, socket)

    expect(one.met).toHaveLength(1)
    expect(socket.stopped).toBe(true)
    expect(one.doc.getText(TEXT).toJSON()).toBe('We ship on Monday. Laptop.')
    expect(server.words).toBe('Room: We ship on Monday.')
    expect(one.live).toEqual([])
  })

  test('hears the room’s acknowledgement and its new epoch, and lets go on 4001', async () => {
    const account = seeded('We ship.')
    const server = new Server()
    Y.applyUpdate(server.doc, account)
    const one = device(account)
    const { socket } = join(one)
    socket.arrive()
    await greet(server, socket)

    const sv = Y.encodeStateVector(server.doc)
    socket.wire.heard(ackFrame(7, sv))
    expect(one.acks).toEqual([[7, sv]])

    socket.wire.heard(epochFrame(2, 'base'))
    expect(one.epochs).toEqual([2])
    socket.close(NEW_EPOCH)
    expect(one.gone).toBe(1)
    expect(one.live.at(-1)).toBe(false)
  })

  test('a canvas’s room carries its document and says where this hand is', async () => {
    const account = seeded('')
    const server = new Server()
    Y.applyUpdate(server.doc, account)
    const one = device(account)
    const hands: unknown[] = []
    const room = new CarriedPlaneRoom({
      noteId: 'board-1',
      token: 'token',
      who: { name: 'Laptop', accent: '#000' },
      scheme: 'light',
      onPeers: () => undefined,
      gone: () => undefined,
      refused: () => undefined,
      holds: () => true,
      surface: {
        canvas: { nodes: [], edges: [], ink: [], at: {}, gone: {} },
        shared: null,
        arrived: () => undefined,
        handsAre: (said) => hands.push(said),
        historyIs: () => undefined,
      },
      carrying: carrying(one),
    })
    const socket = sockets.opened.at(-1)
    if (!socket) throw new Error('no socket')
    expect(socket.offers).toEqual(['nib.v2', 'nib.device.laptop-device'])
    socket.arrive()
    await greet(server, socket)
    expect(room.settled).toBe(true)

    room.hand({ x: 10, y: 20 }, null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(socket.take().length).toBeGreaterThan(0)
    room.leave()
    expect(hands.at(-1)).toEqual([])
  })
})
