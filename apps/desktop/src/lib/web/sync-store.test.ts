import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import {
  clear,
  forgetSyncStore,
  get,
  openSyncStore,
  patch,
  put,
  remove,
  scan,
  scanSpace,
  type Change,
  type DocRow,
  type EntryRow,
  type FileStateRow,
  type HeldRow,
  type LogRow,
  type MetaRow,
  type OutboxRow,
  type SpaceRow,
  type SyncStore,
  type WebRow,
  type WrittenRow,
} from '../sync2/store'
import { forgetWeb, leadSync, openWeb } from './sync-store'

/** The browser's sync store against the same behaviour the crate's is held to in
 *  src-tauri/src/sync_store/store.rs, row for row: a new store, the clean-exit flag, a
 *  batch that fails, every operation, bytes, what nib wrote, the log's ceiling and
 *  signing out. Then the election that keeps it to one engine per browser. */

let accounts = 0
/** A store of its own for every test: one database per account. */
function account(): string {
  accounts += 1
  return `account-${accounts}`
}

const entry = (id: string, space: string, extra: Partial<EntryRow> = {}): Change =>
  put('entries', {
    id,
    space_id: space,
    kind: 'note',
    parent: null,
    name: `${id}.md`,
    local_path: `${id}.md`,
    file_key: null,
    written_hash: null,
    mtime: null,
    size: null,
    seq: null,
    deleted: false,
    ...extra,
  })

const file = (hash: string): Change => put('files', { hash, state: 'here' })

/** Whether two runs of bytes are the same bytes. `toEqual` walks a megabyte one element
 *  at a time through its general equality: ten seconds on its own, and past the test's
 *  thirty on a machine running three gates. */
function sameBytes(one: Uint8Array | undefined, other: Uint8Array): boolean {
  return one?.length === other.length && one.every((byte, at) => byte === other[at])
}

describe('the browser sync store', () => {
  test('is new with a device of its own, and keeps it', async () => {
    const name = account()
    const first = await openWeb(name)
    expect(first.opened.device).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.opened).toMatchObject({ wasClean: true, schema: 1, recovered: false })
    await first.close()

    const again = await openWeb(name)
    expect(again.opened.device).toBe(first.opened.device)
    await again.close()
  })

  test('says an exit was clean only when it was told so', async () => {
    const name = account()
    await (await openWeb(name)).close()

    const crashed = await openWeb(name)
    expect(crashed.opened.wasClean).toBe(false)
    await crashed.cleanExit(true)
    await crashed.close()

    const clean = await openWeb(name)
    expect(clean.opened.wasClean).toBe(true)
    await clean.close()
    const after = await openWeb(name)
    expect(after.opened.wasClean).toBe(false)
    await after.close()
  })

  test('writes nothing of a batch it refuses any part of', async () => {
    const store = await openWeb(account())
    const bad = { t: 'put', table: 'files', row: { hash: 'c', state: 3 } } as unknown as Change

    await expect(store.write([file('a'), file('b'), bad])).rejects.toThrow('files.state')
    await expect(
      store.write([
        file('a'),
        { t: 'patch', table: 'files', key: 'a', set: { hash: 'z' } } as Change,
      ]),
    ).rejects.toThrow('cannot change')
    expect(await store.read([scan('files')])).toEqual([[]])

    expect(await store.write([file('a')])).toEqual([1])
    await store.close()
  })

  test('does what each operation says, and counts it', async () => {
    const store = await openWeb(account())

    const counts = await store.write([
      entry('b', 'one'),
      entry('a', 'one'),
      entry('c', 'two'),
      patch('entries', 'a', { size: 12, deleted: true }),
      patch('entries', 'missing', { size: 1 }),
    ])
    expect(counts).toEqual([1, 1, 1, 1, 0])

    const [a, nobody, one] = await store.read([
      get('entries', 'a'),
      get('entries', 'nobody'),
      scanSpace('entries', 'one'),
    ])
    expect(a).toMatchObject({ size: 12, deleted: true, mtime: null })
    expect(nobody).toBeNull()
    expect(one.map((row) => row.id)).toEqual(['a', 'b'])

    expect(await store.write([remove('entries', 'b'), clear('entries', 'two')])).toEqual([1, 1])
    const [left] = await store.read([scan('entries')])
    expect(left.map((row) => row.id)).toEqual(['a'])
    await store.close()
  })

  test('answers the outbox oldest first, and op id among equals', async () => {
    const store = await openWeb(account())
    const op = (op_id: string, made_at: number, space = 's'): Change =>
      put('outbox', { op_id, space_id: space, op: new Uint8Array([1]), seen: 0, made_at })

    await store.write([op('c', 2), op('b', 1), op('a', 2), op('z', 0, 'elsewhere')])
    const [space, all] = await store.read([scanSpace('outbox', 's'), scan('outbox')])
    expect(space.map((row) => row.op_id)).toEqual(['b', 'a', 'c'])
    expect(all.map((row) => row.op_id)).toEqual(['z', 'b', 'a', 'c'])
    await store.close()
  })

  test('gives bytes back as they went in', async () => {
    const store = await openWeb(account())
    const every = Uint8Array.from({ length: 256 }, (_, at) => at)
    const large = Uint8Array.from({ length: 1_000_000 }, (_, at) => at % 251)

    await store.write([
      put('docs', {
        id: 'n',
        epoch: 1,
        client_id: 4_294_967_295,
        confirmed: large,
        confirmed_sv: every,
        pending: new Uint8Array(),
        pending_at: 1_700_000_000_000,
      }),
    ])
    const [row] = await store.read([get('docs', 'n')])
    expect(row?.confirmed).toBeInstanceOf(Uint8Array)
    expect(sameBytes(row?.confirmed, large)).toBe(true)
    expect(row?.confirmed_sv).toEqual(every)
    expect(row?.pending).toEqual(new Uint8Array())
    expect(row?.client_id).toBe(4_294_967_295)
    await store.close()
  })

  test('keeps what nib wrote whole', async () => {
    const store = await openWeb(account())
    const text = '# Plan\n\nThe same line of prose, written again.\n'.repeat(400)
    await store.write([put('written', { id: 'n', text })])
    expect((await store.read([get('written', 'n')]))[0]?.text).toBe(text)
    await store.close()
  })

  test('keeps the newest thousand rows of the log', async () => {
    const store = await openWeb(account())
    const rows = Array.from({ length: 1200 }, (_, at) =>
      put('log', { at, space: 's', pulled: 1, pushed: null, failed: null }),
    )
    await store.write(rows)

    const [kept] = await store.read([scanSpace('log', 's')])
    expect(kept).toHaveLength(1000)
    expect(kept[0]?.at).toBe(200)
    expect(kept.at(-1)?.at).toBe(1199)
    await store.close()
  })

  test('is gone after signing out', async () => {
    const name = account()
    const store: SyncStore = await openWeb(name)
    await store.write([file('a')])
    const device = store.opened.device
    await store.close()

    await forgetWeb(name)
    const fresh = await openWeb(name)
    expect(fresh.opened.device).not.toBe(device)
    expect(await fresh.read([scan('files')])).toEqual([[]])
    await fresh.close()
  })
})

test('is what the engine opens in a browser, and every table takes its row', async () => {
  const name = account()
  const store = await openSyncStore(name)
  const bytes = new Uint8Array([1])
  const meta: MetaRow = { key: 'note', value: bytes }
  const space: SpaceRow = { space_id: 's', root: '/s', cursor: 3, role: 'owner', store: null }
  const written: WrittenRow = { id: 'n', text: 'words' }
  const doc: DocRow = {
    id: 'n',
    epoch: 1,
    client_id: 2,
    confirmed: bytes,
    confirmed_sv: bytes,
    pending: null,
    pending_at: null,
  }
  const op: OutboxRow = { op_id: 'o', space_id: 's', op: bytes, seen: 1, made_at: 2 }
  const held: HeldRow = { id: 'n', remote: bytes, remote_sv: bytes, device: 'Laptop', at: 3 }
  const blob: FileStateRow = { hash: 'h', state: 'wanted' }
  const web: WebRow = { key: 'k', fence: 1, version: 2, applied: null }
  const log: LogRow = { at: 4, space: 's', pulled: 1, pushed: 0, failed: null }

  const counts = await store.write([
    put('meta', meta),
    put('spaces', space),
    put('written', written),
    put('docs', doc),
    put('outbox', op),
    put('held', held),
    put('files', blob),
    put('web', web),
    put('log', log),
  ])
  expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1])
  expect(
    await store.read([
      get('meta', 'note'),
      get('spaces', 's'),
      get('written', 'n'),
      get('docs', 'n'),
      get('outbox', 'o'),
      get('held', 'n'),
      get('files', 'h'),
      get('web', 'k'),
      scan('log'),
    ]),
  ).toEqual([meta, space, written, doc, op, held, blob, web, [log]])
  await store.close()

  await forgetSyncStore(name)
  const fresh = await openSyncStore(name)
  expect(await fresh.read([scan('docs')])).toEqual([[]])
  await fresh.close()
})

describe('one engine per browser', () => {
  /** Without the Web Locks API every tab leads, which is what leadSync answers on a
   *  host that lacks it. Node has it from 24, which CI and package.json ask for. */
  const locked = () =>
    expect(
      (globalThis.navigator as Navigator | undefined)?.locks,
      'Web Locks need Node 24',
    ).toBeDefined()

  test('the second tab leads once the first lets go', async () => {
    locked()
    const first = await leadSync()
    expect(first).not.toBeNull()

    let second = false
    const waiting = leadSync().then((leading) => {
      second = true
      return leading
    })
    await new Promise((settle) => setTimeout(settle, 30))
    expect(second).toBe(false)

    first?.release()
    const leading = await waiting
    expect(second).toBe(true)
    leading?.release()
  })

  test('a tab that stops waiting is not the leader', async () => {
    locked()
    const first = await leadSync()
    const giving = new AbortController()
    const waiting = leadSync(giving.signal)
    giving.abort()
    expect(await waiting).toBeNull()
    first?.release()
  })
})
