import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  ackFrame,
  deviceFrameOf,
  deviceRowsOf,
  epochFrame,
  feedPageOf,
  frame,
  type Framed,
  hubFrameOf,
  isName,
  keepRequestOf,
  opOf,
  opsRequestOf,
  opsResponseOf,
  OPS_BATCH,
  pullRequestOf,
  pullResponseOf,
  pushRequestOf,
  pushResponseOf,
  PUSH_BATCH,
  roomNews,
  snapshotPageOf,
  unframe,
} from './wire'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('the envelope', () => {
  test('carries JSON and bytes, and gives back both', () => {
    const value = { docs: [{ id: 'a', epoch: 1, sv: bytes(1, 2, 3) }], note: 'ünïcødé 😀' }
    expect(unframe(frame(value))).toEqual(value)
  })

  test('costs a few bytes a part, not a third of each', () => {
    const update = new Uint8Array(3000).fill(7)
    const framed = frame({ update })
    expect(framed.length).toBeLessThan(update.length + 40)
  })

  test('drops a key whose value is undefined, as JSON would', () => {
    expect(unframe(frame({ a: 1, b: undefined }))).toEqual({ a: 1 })
  })

  test('refuses what is not an envelope', () => {
    expect(unframe(bytes())).toBeNull()
    expect(unframe(bytes(2, 0, 0, 0, 0))).toBeNull()
    expect(unframe(bytes(1, 0, 0, 0, 9, 123))).toBeNull()
    const good = frame({ sv: bytes(1) })
    expect(unframe(good.subarray(0, good.length - 1))).toBeNull()
    expect(unframe(new Uint8Array([...good, 0]))).toBeNull()
  })

  test('a reference to a part there is not reads as nothing', () => {
    const header = new TextEncoder().encode(JSON.stringify({ sv: { $part: 4 } }))
    const body = new Uint8Array(1 + 4 + header.length + 4)
    const view = new DataView(body.buffer)
    body[0] = 1
    view.setUint32(1, header.length)
    body.set(header, 5)
    view.setUint32(5 + header.length, 0)
    expect(unframe(body)).toEqual({ sv: undefined })
    expect(pullRequestOf({ docs: [unframe(body)] })).toBeNull()
  })

  const framed: fc.Arbitrary<Framed> = fc.letrec<{ value: Framed }>((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.uint8Array({ maxLength: 64 }),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(
        fc.string().filter((key) => key !== '$part' && key !== '__proto__'),
        tie('value'),
        { maxKeys: 4 },
      ),
    ),
  })).value

  test('property: frame then unframe is the value', () => {
    fc.assert(
      fc.property(framed, (value) => {
        expect(unframe(frame(value))).toEqual(value)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: any bytes at all are read or refused, never thrown on', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (input) => {
        expect(() => unframe(input)).not.toThrow()
        expect(() => roomNews(input)).not.toThrow()
      }),
      { numRuns: 2000 },
    )
  })
})

describe("the room's v2 messages", () => {
  test('an ACK carries its version and state vector', () => {
    expect(roomNews(ackFrame(41, bytes(1, 2, 3)))).toEqual({
      t: 'ack',
      seq: 41,
      sv: bytes(1, 2, 3),
    })
    expect(roomNews(ackFrame(2 ** 40, bytes()))).toEqual({ t: 'ack', seq: 2 ** 40, sv: bytes() })
    expect(roomNews(bytes(100, 1, 2))).toBeNull()
  })

  test('an EPOCH carries the epoch and its base', () => {
    expect(roomNews(epochFrame(3, 'abc'))).toEqual({ t: 'epoch', epoch: 3, epochBase: 'abc' })
  })

  test('a y-protocols message is neither', () => {
    expect(roomNews(bytes(0, 0, 1, 0))).toBeNull()
    expect(roomNews(bytes(1, 5))).toBeNull()
    expect(roomNews(bytes(101, 123))).toBeNull()
  })
})

describe('names', () => {
  test('anything a platform might refuse is still a name; a slash and the dots are not', () => {
    for (const name of ['Plan.md', 'CON', 'a:b', 'trailing.', 'x'.repeat(255), '日本語.md']) {
      expect(isName(name)).toBe(true)
    }
    for (const name of ['', '.', '..', 'a/b', 'a\u0000b', 'x'.repeat(256), 3, null]) {
      expect(isName(name)).toBe(false)
    }
  })
})

describe('tree ops', () => {
  test('every op reads back as itself', () => {
    const ops = [
      { op: '1', t: 'mkdir', id: 'f', parent: null, name: 'Work', seen: 0 },
      {
        op: '2',
        t: 'create',
        id: 'n',
        kind: 'note',
        parent: 'f',
        name: 'Plan.md',
        seen: 3,
        mergeable: { text: '' },
      },
      {
        op: '3',
        t: 'create',
        id: 'p',
        kind: 'file',
        parent: null,
        name: 'a.png',
        hash: 'h',
        seen: 3,
      },
      { op: '4', t: 'rename', id: 'n', name: 'Other.md', seen: 4 },
      { op: '5', t: 'move', id: 'n', parent: null, seen: 4 },
      { op: '6', t: 'move', id: 'n', parent: 'f', name: 'Again.md', seen: 4 },
      { op: '7', t: 'delete', id: 'n', seen: 5 },
      { op: '8', t: 'restore', id: 'n', seen: 6 },
    ]
    for (const op of ops) expect(opOf(op)).toEqual(op)
    expect(opsRequestOf({ ops })).toEqual({ ops })
  })

  test('a malformed op, a folder made by create, or a batch too long is refused', () => {
    expect(opOf({ op: '1', t: 'mkdir', id: 'f', parent: null, name: 'a/b', seen: 0 })).toBeNull()
    expect(
      opOf({ op: '1', t: 'create', id: 'f', kind: 'folder', parent: null, name: 'F', seen: 0 }),
    ).toBeNull()
    expect(opOf({ op: '1', t: 'delete', id: 'f', seen: -1 })).toBeNull()
    expect(opOf({ op: '1', t: 'explode', id: 'f', seen: 0 })).toBeNull()
    expect(opOf({ op: '', t: 'delete', id: 'f', seen: 0 })).toBeNull()

    const one = { op: '1', t: 'delete', id: 'f', seen: 0 }
    expect(opsRequestOf({ ops: Array.from({ length: OPS_BATCH + 1 }, () => one) })).toBeNull()
  })

  test('the answers read back as themselves', () => {
    const answer = {
      results: [
        { op: '1', ok: true },
        { op: '2', ok: true, id: 'n', parent: null, name: 'Plan 2.md' },
        { op: '3', merged: 'day' },
        { op: '4', refused: 'edited' },
      ],
      cursor: 12,
    }
    expect(opsResponseOf(answer)).toEqual(answer)
    expect(opsResponseOf({ results: [{ op: '1', refused: 'nope' }], cursor: 1 })).toBeNull()
  })
})

describe('the feed', () => {
  test('a page reads back as itself, optional fields and all', () => {
    const page = {
      items: [
        {
          id: 'n',
          kind: 'note',
          parent: null,
          name: 'Plan.md',
          deleted: false,
          seq: 4,
          docSeq: 4,
          epoch: 1,
          epochBase: 'abc',
          hash: 'h',
          size: 10,
          by: 'laptop',
          at: 1,
        },
        {
          id: 'f',
          kind: 'folder',
          parent: null,
          name: 'Work',
          deleted: true,
          seq: 5,
          hash: '',
          size: 0,
          by: 'phone',
          at: 2,
        },
      ],
      cursor: 5,
      more: false,
    }
    expect(feedPageOf(page)).toEqual(page)
    expect(feedPageOf({ ...page, more: 'no' })).toBeNull()
  })
})

describe('documents', () => {
  test('a pull and its answers survive the envelope', () => {
    const request = { docs: [{ id: 'n', epoch: 1, sv: bytes(0) }] }
    expect(pullRequestOf(unframe(frame(request)))).toEqual(request)

    const response = {
      docs: [
        { id: 'n', update: bytes(1, 2), seq: 7 },
        { id: 'm', epoch: 2, epochBase: 'hash' },
        { id: 'o', refused: 'gone' },
      ],
    }
    expect(pullResponseOf(unframe(frame(response)))).toEqual(response)
  })

  test('a push and its answers survive the envelope', () => {
    const request = {
      docs: [
        { id: 'n', push: 'p1', epoch: 1, seq: 3, base: bytes(0), update: bytes(1), at: 5 },
        { id: 'm', push: 'p2', epoch: 1, seq: 0, base: bytes(2), update: bytes(3), at: 6 },
      ],
    }
    expect(pushRequestOf(unframe(frame(request)))).toEqual(request)

    const response = {
      docs: [
        { id: 'n', ok: true, seq: 4, sv: bytes(1) },
        { id: 'm', moved: bytes(2), seq: 9, sv: bytes(3), at: 12 },
        { id: 'o', epoch: 2 },
        { id: 'p', refused: 'large' },
      ],
    }
    expect(pushResponseOf(unframe(frame(response)))).toEqual(response)
  })

  test('bytes where bytes belong, and no more documents than a batch', () => {
    expect(
      pushRequestOf({
        docs: [{ id: 'n', push: 'p', epoch: 1, seq: 1, base: 'AA==', update: bytes(1), at: 5 }],
      }),
    ).toBeNull()
    expect(
      pushRequestOf({ docs: [{ id: 'n', epoch: 1, base: bytes(0), update: bytes(1), at: 5 }] }),
    ).toBeNull()
    const one = { id: 'n', push: 'p', epoch: 1, seq: 1, base: bytes(0), update: bytes(1), at: 5 }
    expect(pushRequestOf({ docs: Array.from({ length: PUSH_BATCH + 1 }, () => one) })).toBeNull()
  })

  test('keep and snapshot', () => {
    expect(keepRequestOf({ id: 'n', text: 'words', device: 'laptop' })).toEqual({
      id: 'n',
      text: 'words',
      device: 'laptop',
    })
    expect(keepRequestOf({ id: 'n', text: 3, device: 'laptop' })).toBeNull()

    const page = {
      docs: [{ id: 'a', epoch: 1, epochBase: 'h', seq: 2, update: bytes(1) }],
      next: 'a',
    }
    expect(snapshotPageOf(unframe(frame(page)))).toEqual(page)
    expect(snapshotPageOf({ docs: [], next: null })).toEqual({ docs: [], next: null })
  })
})

describe('the hub', () => {
  test('every frame a device sends reads back as itself', () => {
    const frames = [
      { t: 'hello', device: 'd1', name: 'Laptop', platform: 'windows', app: '1.0.0' },
      { t: 'active' },
      { t: 'idle' },
      { t: 'acquire', key: 'k', take: true },
      { t: 'release', key: 'k', version: 3 },
      { t: 'flushed', key: 'k', version: 4 },
      { t: 'want-key', pub: 'pub' },
      { t: 'grant-key', to: 'd2', wrapped: 'w', generation: 1 },
      { t: 'deny-key', to: 'd2' },
    ]
    for (const one of frames) expect(deviceFrameOf(one)).toEqual(one)
    expect(deviceFrameOf({ t: 'acquire', key: 'k' })).toBeNull()
    expect(deviceFrameOf({ t: 'poke', space: 's', seq: 1 })).toBeNull()
  })

  test('every frame the hub sends reads back as itself', () => {
    const frames = [
      { t: 'poke', space: 's', seq: 1 },
      { t: 'granted', key: 'k', fence: 2, version: 3 },
      { t: 'busy', key: 'k', device: 'd' },
      { t: 'flush', key: 'k', fence: 2 },
      { t: 'lost', key: 'k', device: 'd' },
      { t: 'free', key: 'k' },
      { t: 'state', key: 'k', version: 4 },
      { t: 'key-wanted', device: 'd', name: 'Desktop', pub: 'p' },
      { t: 'key', wrapped: 'w', generation: 2 },
      { t: 'key-denied' },
    ]
    for (const one of frames) expect(hubFrameOf(one)).toEqual(one)
    expect(hubFrameOf({ t: 'granted', key: 'k', fence: -1, version: 3 })).toBeNull()
  })

  test('the devices list', () => {
    const rows = [{ id: 'd', name: 'Laptop', platform: 'windows', createdAt: 1, lastSeenAt: null }]
    expect(deviceRowsOf(rows)).toEqual(rows)
    expect(deviceRowsOf([{ id: 'd' }])).toBeNull()
  })
})
