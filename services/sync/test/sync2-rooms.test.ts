/** A note's room as sync v2's home for its document (docs/sync-v2.md sections 5.2 to
 *  5.4, 5.10 and 11): seeded exactly as a device seeds, taking HTTP pushes durably
 *  and answering `moved` when it has moved on, acknowledging at every settle, writing
 *  its snapshot to the bucket, starting a new epoch without dropping a word a v1 room
 *  held, and taking whole texts in as operations under its own id. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Canvas, type CanvasNode, readCanvas, writeCanvas } from '@nib/markdown/canvas'
import {
  hash32,
  type PullResponse,
  type PushResponse,
  roomNews,
  seedPlane,
  seedUpdate,
  type SnapshotPage,
} from '@nib/sync-core'
import { receive, syncStep1, syncUpdate, TEXT } from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { call, type RpcView, signIn, type TestEnv, testEnv } from './harness'
import { join, say } from './room'
import { framed, type Live, live } from './sync2'

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'rooms@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Rooms' } })).json.space.id
})

afterEach(() => env.close())

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  return answer.json.note.id
}

async function prepare() {
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
}

function row(id: string): { version: number; hash: string; path: string; deleted: number } {
  return env.db.prepare('select * from notes where id = ?').get(id) as never
}

async function body(id: string): Promise<string> {
  const object = await env.NOTES.get(`spaces/${space}/${id}`)
  return object ? await object.text() : ''
}

/** A device holding a note's document: the seed, and whatever it types after. */
class Device {
  readonly doc = new Y.Doc()
  seq: number
  private pushes = 0

  constructor(
    readonly id: string,
    text: string,
    readonly name: string,
  ) {
    Y.applyUpdateV2(this.doc, seedUpdate(id, 1, text))
    this.seq = text ? 1 : 0
  }

  get words(): string {
    return this.doc.getText(TEXT).toJSON()
  }

  /** What typing here makes, as the pending update a push carries. */
  type(at: number, words: string): { base: Uint8Array; update: Uint8Array } {
    const base = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    return { base, update: Y.encodeStateAsUpdateV2(this.doc, base) }
  }

  push(pending: { base: Uint8Array; update: Uint8Array }, push = `${this.name}-${String(++this.pushes)}`) {
    return framed<PushResponse>(env, '/v2/docs/push', token, {
      docs: [{ id: this.id, push, epoch: 1, seq: this.seq, ...pending, at: 1 }],
    })
  }
}

describe('a room holding a note on sync v2', () => {
  test('seeds its epoch byte for byte as a device seeds it', async () => {
    const text = '# Plan\n\nWe ship on Monday.\n'
    const id = await made('Plan.md', text)
    await prepare()

    // Waking it is enough: a socket joining, and the settle after.
    await join(rooms.of(id).room, { id, spaceId: space })
    await rooms.settle()

    expect(await snapshotOf(id)).toEqual(seedUpdate(id, 1, text))
  })

  test('takes a push made on its version, written down before it answers', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const device = new Device(id, 'one\n', 'laptop')

    const { value } = await device.push(device.type(4, 'two\n'))
    const answer = value.docs[0]
    expect(answer).toMatchObject({ id, ok: true, seq: 2 })

    // Durable before the answer: the room's own storage already holds it, though
    // nothing has settled yet.
    const { state } = rooms.of(id)
    expect(state.kept.get('version')).toMatchObject({ seq: 2 })
    expect(await body(id)).toBe('one\n')

    await rooms.settle()
    expect(await body(id)).toBe('one\ntwo\n')
    expect(row(id).version).toBeGreaterThan(1)
  })

  test('answers moved, with what the device is missing, once it has moved past the version', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const laptop = new Device(id, 'one\n', 'laptop')
    const phone = new Device(id, 'one\n', 'phone')

    expect((await laptop.push(laptop.type(0, 'laptop ')).then((one) => one.value.docs[0]))).toMatchObject({ ok: true })

    const { value } = await phone.push(phone.type(4, 'phone\n'))
    const moved = value.docs[0]
    if (!moved || !('moved' in moved)) throw new Error(`not moved: ${JSON.stringify(moved)}`)
    expect(moved.seq).toBe(2)

    // What it was missing is the laptop's words and nothing of its own.
    const remote = new Y.Doc()
    Y.applyUpdateV2(remote, seedUpdate(id, 1, 'one\n'))
    Y.applyUpdateV2(remote, moved.moved)
    expect(remote.getText(TEXT).toJSON()).toBe('laptop one\n')
  })

  test('answers a push sent again with the answer it gave the first time', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const device = new Device(id, 'one\n', 'laptop')
    const pending = device.type(0, 'x')

    const first = await device.push(pending, 'same')
    const again = await device.push(pending, 'same')
    expect(again.value.docs).toEqual(first.value.docs)
    await rooms.settle()
    expect(await body(id)).toBe('xone\n')
  })

  test('acknowledges at its settle to v2 sockets, and says nothing new to v1 ones', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const v2 = await join(rooms.of(id).room, { id, spaceId: space })
    const v1 = await join(rooms.of(id).room, { id, spaceId: space })
    v2.serializeAttachment({ ...(v2.deserializeAttachment() as object), v2: true })
    v2.take()
    v1.take()

    const device = new Device(id, 'one\n', 'laptop')
    await device.push(device.type(0, 'x'))
    await rooms.settle()

    const acks = v2.take().map((one) => roomNews(one)).filter((one) => one?.t === 'ack')
    expect(acks.at(-1)).toMatchObject({ t: 'ack', seq: 2 })
    expect(v1.take().some((one) => roomNews(one) !== null)).toBe(false)
  })

  test('brings a deleted note back when words land on it', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await call(env, `/v1/notes/${id}`, { method: 'DELETE', token })
    expect(row(id).deleted).toBe(1)

    const device = new Device(id, 'one\n', 'laptop')
    await device.push(device.type(4, 'kept\n'))
    await rooms.settle()

    expect(row(id).deleted).toBe(0)
    expect(await body(id)).toBe('one\nkept\n')
  })
})

describe('whole texts', () => {
  test('a v1 save on the version it read lands as operations a v2 device pulls', async () => {
    const id = await made('Plan.md', 'one\ntwo\n')
    await prepare()

    const put = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'one\n2\n', baseVersion: row(id).version },
    })
    expect(put.status, put.text).toBe(200)
    expect(put.json.note.hash).toBe(row(id).hash)

    const device = new Device(id, 'one\ntwo\n', 'phone')
    const { value } = await framed<PullResponse>(env, '/v2/docs/pull', token, {
      docs: [{ id, epoch: 1, sv: Y.encodeStateVector(device.doc) }],
    })
    const pulled = value.docs[0]
    if (!pulled || !('update' in pulled)) throw new Error('nothing pulled')
    Y.applyUpdateV2(device.doc, pulled.update)
    expect(device.words).toBe('one\n2\n')

    // Made under the room's own id, and as the few operations the text differs by.
    const clients = [...Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(pulled.update)).keys()]
    expect(clients).toEqual([hash32(id, 'account')])
  })

  test('a v1 save naming an older version is the 409 it always was', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const stale = row(id).version
    await call(env, `/v1/notes/${id}`, { method: 'PUT', token, body: { content: 'two\n', baseVersion: stale } })

    const late = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'three\n', baseVersion: stale },
    })
    expect(late.status).toBe(409)
    expect(await body(id)).toBe('two\n')
  })

  test('the connector writes through the room too', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const device = new Device(id, 'one\n', 'laptop')
    await device.push(device.type(4, 'typed\n'))

    // What a connected app writes lands on top of what the room held unsettled, not
    // over it: the room settles first, and the text goes in as operations.
    const mcp = await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })
    const written = await call<RpcView>(env, "/mcp", {
      token: mcp.json.token,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'write_note', arguments: { space: 'Rooms', path: 'Plan.md', content: 'one\ntyped\nconnector\n' } },
      },
    })
    expect(written.status).toBe(200)
    expect(written.json.result.content[0]?.text).toBe('Saved Plan.md.')
    expect(await body(id)).toBe('one\ntyped\nconnector\n')
  })
})

describe('an epoch starting', () => {
  test('a v1 room with words it never settled takes them into the new document', async () => {
    const id = await made('Plan.md', 'one\n')
    const { room, state } = rooms.of(id)
    const socket = await join(room, { id, spaceId: space })

    // A v1 app's handshake: what the room holds comes down, and then it types, and
    // nothing has settled when the space is prepared.
    const device = new Y.Doc()
    const awareness = new Awareness(device)
    await say(room, state, socket, syncStep1(device))
    for (const message of socket.take()) receive(message, device, awareness, 'room')
    expect(device.getText(TEXT).toJSON()).toBe('one\n')
    const before = Y.encodeStateVector(device)
    device.getText(TEXT).insert(4, 'unsettled\n')
    await say(room, state, socket, syncUpdate(Y.encodeStateAsUpdate(device, before)))
    state.takeAlarm()

    await prepare()
    // The settle that finds the note on an epoch starts it; the one after writes it.
    await room.alarm()
    await state.idle()
    await rooms.settle()

    expect(socket.closedWith?.code).toBe(1012)
    expect(await body(id)).toBe('one\nunsettled\n')

    // The new document is the seed a device makes with the words on top: a device
    // holding the seed merges into one text, not two.
    const merged = new Y.Doc()
    Y.applyUpdateV2(merged, seedUpdate(id, 1, 'one\n'))
    Y.applyUpdateV2(merged, await snapshotOf(id))
    expect(merged.getText(TEXT).toJSON()).toBe('one\nunsettled\n')
  })

  test('closes a v2 socket with the new epoch and 4001', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const { room, state } = rooms.of(id)
    const socket = await join(room, { id, spaceId: space })
    socket.serializeAttachment({ ...(socket.deserializeAttachment() as object), v2: true })
    socket.take()

    // An operator starting the note again: the room hears it at its next settle.
    env.db.prepare('update notes set epoch = 2, epoch_base = hash where id = ?').run(id)
    await room.alarm()
    await state.idle()

    const news = socket.take().map((one) => roomNews(one))
    expect(news).toContainEqual({ t: 'epoch', epoch: 2, epochBase: row(id).hash })
    expect(socket.closedWith?.code).toBe(4001)
  })
})

/** The snapshot of a note's document the bucket holds. */
async function snapshotOf(id: string): Promise<Uint8Array> {
  const object = await env.NOTES.get(`crdt/${id}`)
  if (!object) throw new Error('no snapshot')
  return new Uint8Array(await object.arrayBuffer())
}

describe('a canvas on sync v2', () => {
  test('seeds as a device seeds it, and a v1 save of it lands as operations on its cards', async () => {
    const canvas: Canvas = {
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'One' }],
      edges: [],
      ink: [],
      at: { a: 1 },
      gone: {},
    }
    const id = await made('Board.canvas', writeCanvas(canvas))
    await prepare()
    await join(rooms.of(id).room, { id, spaceId: space, kind: 'plane' })
    await rooms.settle()
    expect(await snapshotOf(id)).toEqual(seedPlane(id, 1, readCanvas(writeCanvas(canvas))))

    const next: Canvas = { ...canvas, nodes: [{ ...canvas.nodes[0], text: 'One two' } as CanvasNode], at: { a: 2 } }
    const put = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: writeCanvas(next), baseVersion: row(id).version },
    })
    expect(put.status, put.text).toBe(200)
    expect(await body(id)).toBe(writeCanvas(readCanvas(writeCanvas(next))))
  })
})

describe('the bulk read and the kept side', () => {
  test('a first sync reads every document, woken or not, in id order', async () => {
    const one = await made('One.md', 'one\n')
    const two = await made('Two.md', 'two\n')
    await prepare()
    const device = new Device(one, 'one\n', 'laptop')
    await device.push(device.type(4, 'more\n'))
    await rooms.settle()

    const { value } = await framed<SnapshotPage>(env, `/v2/spaces/${space}/snapshot`, token)
    const texts = new Map(
      value.docs.map((doc) => {
        const read = new Y.Doc()
        Y.applyUpdateV2(read, doc.update)
        return [doc.id, read.getText(TEXT).toJSON()]
      }),
    )
    expect(texts.get(one)).toBe('one\nmore\n')
    expect(texts.get(two)).toBe('two\n')
    expect(value.next).toBeNull()
  })

  test('the side a modal answer let go of is kept as a version, named after its device', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    const kept = await call(env, '/v2/docs/keep', {
      token,
      body: { id, text: 'the words that lost\n', device: 'Laptop' },
    })
    expect(kept.status).toBe(200)

    const versions = await call(env, `/v1/notes/${id}/versions`, { token })
    const newest = (versions.json as unknown as { versions: { at: number; by: string }[] }).versions[0]
    expect(newest?.by).toBe('Laptop')
    const words = await call(env, `/v1/notes/${id}/versions/${String(newest?.at)}`, { token })
    expect(words.json.content).toBe('the words that lost\n')
  })
})
