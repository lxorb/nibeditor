/** Sync v2's tree, through its routes, against real SQL (docs/sync-v2.md section 5.9).
 *
 *  A space prepared out of the paths v1 wrote; every rule the tree applies, as a device
 *  meets it through `POST /v2/spaces/:space/ops`; the paths publishing and v1 apps read
 *  kept current in the same batch; an op sent twice answered once; and the feed that
 *  carries all of it in one order. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FeedPage, OpResult, OpsResponse } from '@nib/sync-core'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { invited, type Live, live } from './sync2'

let env: TestEnv
let rooms: Live
/** Two devices of one account: two sessions, which the tree tells apart. */
let token: string
let other: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'tree@example.com')
  other = await signIn(env, 'tree@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Tree' } })).json.space.id
})

afterEach(() => env.close())

interface Row {
  id: string
  path: string
  folder_id: string | null
  name: string | null
  name_key: string | null
  kind: string
  deleted: number
  seq: number
  version: number
  epoch: number
  epoch_base: string | null
  hash: string
  doc_seq: number | null
}

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  deleted: number
  seq: number
}

function row(id: string): Row {
  return env.db.prepare('select * from notes where id = ?').get(id) as unknown as Row
}

function folders(): FolderRow[] {
  return env.db
    .prepare('select * from folders where space_id = ? order by name')
    .all(space) as unknown as FolderRow[]
}

async function made(path: string, content = `# ${path}\n`): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path, content },
  })
  if (answer.status !== 201) throw new Error(`${path}: ${answer.text}`)
  return answer.json.note.id
}

async function prepare(as = token): Promise<number> {
  const answer = await call<{ cursor: number }>(env, `/v2/spaces/${space}/prepare`, {
    token: as,
    method: 'POST',
  })
  expect(answer.status).toBe(200)
  return answer.json.cursor
}

let counter = 0
/** One op, with an id of its own and the cursor its device had seen. */
function op<T extends Record<string, unknown>>(t: string, fields: T, seen = 0) {
  counter += 1
  return { op: `op-${String(counter)}`, t, seen, ...fields }
}

async function ops(list: readonly object[], as = token): Promise<OpsResponse> {
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token: as,
    body: { ops: list },
  })
  expect(answer.status, answer.text).toBe(200)
  return answer.json
}

async function one(item: object, as = token): Promise<OpResult> {
  const { results } = await ops([item], as)
  const result = results[0]
  if (!result) throw new Error('no answer')
  return result
}

async function feed(since = 0, as = token): Promise<FeedPage> {
  const answer = await call<FeedPage>(env, `/v2/spaces/${space}/feed?since=${String(since)}`, {
    token: as,
  })
  expect(answer.status).toBe(200)
  return answer.json
}

describe('preparing a space', () => {
  test('places every note by its path, with one row per folder', async () => {
    const a = await made('a.md')
    const b = await made('Work/b.md')
    const c = await made('Work/Deep/c.canvas', '{"nodes":[],"edges":[]}')
    const versions = [a, b, c].map((id) => row(id).version)

    await prepare()

    const [deep, work] = folders()
    expect(work?.name).toBe('Work')
    expect(work?.parent_id).toBeNull()
    expect(deep?.name).toBe('Deep')
    expect(deep?.parent_id).toBe(work?.id)

    expect(row(a)).toMatchObject({ folder_id: null, name: 'a.md', name_key: 'a.md', kind: 'note' })
    expect(row(b)).toMatchObject({ folder_id: work?.id, name: 'b.md', path: 'Work/b.md' })
    expect(row(c)).toMatchObject({ folder_id: deep?.id, name: 'c.canvas', kind: 'canvas' })
    // Nothing a v1 app sees moved: the paths and the versions are what they were.
    expect([a, b, c].map((id) => row(id).version)).toEqual(versions)
  })

  test('puts every document on the first epoch, seeded from the words it has', async () => {
    const a = await made('a.md', 'hello\n')
    await prepare()

    expect(row(a).epoch).toBe(1)
    expect(row(a).epoch_base).toBe(row(a).hash)
  })

  test('does nothing the second time', async () => {
    await made('Work/b.md')
    const first = await prepare()
    const seqs = env.db.prepare('select id, seq from notes order by id').all()

    expect(await prepare()).toBe(first)
    expect(folders()).toHaveLength(1)
    expect(env.db.prepare('select id, seq from notes order by id').all()).toEqual(seqs)
  })

  test('joins folders a Linux device spelled two ways, and numbers the later of two notes', async () => {
    const a = await made('Work/a.md')
    const b = await made('work/b.md')
    const upper = await made('Work/A.md')
    const since = (await call(env, `/v1/spaces/${space}/changes?since=0`, { token })).json.cursor

    await prepare()

    expect(folders().map((one) => one.name)).toEqual(['Work'])
    expect(row(a).path).toBe('Work/a.md')
    expect(row(b).path).toBe('Work/b.md')
    expect(row(upper).path).toBe('Work/A 2.md')

    // Every rename is one a v1 app reads off its own feed.
    const moved = await call(env, `/v1/spaces/${space}/changes?since=${String(since)}`, { token })
    expect(moved.json.notes.map((one) => one.path).sort()).toEqual(['Work/A 2.md', 'Work/b.md'])
  })

  test('gives a note in Recently deleted the folder it was in, deleted, so a restore brings both', async () => {
    const gone = await made('Old/x.md')
    await call(env, `/v1/notes/${gone}`, { method: 'DELETE', token })

    await prepare()
    const [old] = folders()
    expect(old).toMatchObject({ name: 'Old', deleted: 1 })
    expect(row(gone).folder_id).toBe(old?.id)

    expect(await one(op('restore', { id: gone }))).toMatchObject({ ok: true, name: 'x.md' })
    expect(folders()[0]?.deleted).toBe(0)
    expect(row(gone)).toMatchObject({ deleted: 0, path: 'Old/x.md' })
  })

  test('is asked for by the first read of the tree when nobody asked', async () => {
    const a = await made('a.md')
    const page = await feed()
    expect(page.items.map((item) => item.id)).toContain(a)
    expect(row(a).epoch).toBe(1)
  })
})

describe('tree operations', () => {
  beforeEach(async () => {
    await prepare()
  })

  test('make, rename, move and delete by id, with every path current', async () => {
    const results = await ops([
      op('mkdir', { id: 'f1', parent: null, name: 'Plans' }),
      op('create', { id: 'n1', kind: 'note', parent: 'f1', name: 'Q3.md' }),
      op('rename', { id: 'f1', name: 'Roadmap' }),
    ])
    expect(results.results).toEqual([
      { op: expect.any(String), ok: true, id: 'f1', parent: null, name: 'Plans' },
      { op: expect.any(String), ok: true, id: 'n1', parent: 'f1', name: 'Q3.md' },
      { op: expect.any(String), ok: true, id: 'f1', parent: null, name: 'Roadmap' },
    ])
    expect(row('n1')).toMatchObject({ path: 'Roadmap/Q3.md', epoch: 1, kind: 'note' })

    await one(op('move', { id: 'n1', parent: null, name: 'Q4.md' }))
    expect(row('n1').path).toBe('Q4.md')

    expect(await one(op('delete', { id: 'n1' }, results.cursor + 10))).toMatchObject({ ok: true })
    expect(row('n1').deleted).toBe(1)
  })

  test('number a name that is taken as Windows and a Mac compare names', async () => {
    const results = await ops([
      op('create', { id: 'p1', kind: 'note', parent: null, name: 'Plan.md' }),
      op('create', { id: 'p2', kind: 'note', parent: null, name: 'plan.md' }),
      op('create', { id: 'c1', kind: 'note', parent: null, name: 'Café.md' }),
      op('create', { id: 'c2', kind: 'note', parent: null, name: 'Café.md' }),
    ])
    expect(results.results.map((one) => ('name' in one ? one.name : null))).toEqual([
      'Plan.md',
      'plan 2.md',
      'Café.md',
      'Café 2.md',
    ])
  })

  test("answer a create of the day's note that is already there with the note", async () => {
    const day = { kind: 'note', parent: null, name: '2026-09-30.md', mergeable: { text: '' } }
    await one(op('create', { id: 'd1', ...day }))
    expect(await one(op('create', { id: 'd2', ...day }, 0), other)).toMatchObject({ merged: 'd1' })
    expect(env.db.prepare("select count(*) as n from notes where id = 'd2'").get()).toEqual({ n: 0 })
  })

  test('refuse a move that would put a folder inside itself', async () => {
    await ops([
      op('mkdir', { id: 'a', parent: null, name: 'A' }),
      op('mkdir', { id: 'b', parent: null, name: 'B' }),
    ])
    expect(await one(op('move', { id: 'a', parent: 'b' }))).toMatchObject({ ok: true })
    expect(await one(op('move', { id: 'b', parent: 'a' }), other)).toMatchObject({
      refused: 'cycle',
    })
  })

  test('let the later of two renames stand', async () => {
    await one(op('create', { id: 'n', kind: 'note', parent: null, name: 'One.md' }))
    await one(op('rename', { id: 'n', name: 'Two.md' }))
    await one(op('rename', { id: 'n', name: 'Three.md' }), other)
    expect(row('n').path).toBe('Three.md')
  })

  test('bring a deleted folder back, with the folders above it, for a move into it', async () => {
    const { cursor } = await ops([
      op('mkdir', { id: 'outer', parent: null, name: 'Outer' }),
      op('mkdir', { id: 'inner', parent: 'outer', name: 'Inner' }),
      op('create', { id: 'n', kind: 'note', parent: null, name: 'n.md' }),
    ])
    await one(op('delete', { id: 'outer' }, cursor))
    expect(folders().every((one) => one.deleted === 1)).toBe(true)

    expect(await one(op('move', { id: 'n', parent: 'inner' }), other)).toMatchObject({ ok: true })
    expect(folders().every((one) => one.deleted === 0)).toBe(true)
    expect(row('n').path).toBe('Outer/Inner/n.md')
  })

  test('bring back something deleted after its device last looked, for a rename of it', async () => {
    const { cursor } = await ops([op('create', { id: 'n', kind: 'note', parent: null, name: 'n.md' })])
    await one(op('delete', { id: 'n' }, cursor))

    expect(await one(op('rename', { id: 'n', name: 'm.md' }, cursor), other)).toMatchObject({
      ok: true,
      name: 'm.md',
    })
    expect(row('n')).toMatchObject({ deleted: 0, path: 'm.md' })
  })

  test('refuse the delete of a note another device wrote in since the deleting one looked', async () => {
    const id = await made('Plan.md', 'first\n')
    const before = (await feed()).cursor

    // Written by the other device, through the note's room.
    const put = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token: other,
      body: { content: 'first\nsecond\n', baseVersion: row(id).version },
    })
    expect(put.status, put.text).toBe(200)

    expect(await one(op('delete', { id }, before))).toMatchObject({ refused: 'edited' })
    expect(row(id).deleted).toBe(0)
    expect(await one(op('delete', { id }, (await feed()).cursor))).toMatchObject({ ok: true })
  })

  test("never stand a device's own writing against its own delete", async () => {
    const id = await made('Plan.md', 'first\n')
    const before = (await feed()).cursor
    await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'first\nmine\n', baseVersion: row(id).version },
    })

    expect(await one(op('delete', { id }, before))).toMatchObject({ ok: true })
  })

  test('take a folder away with what its device saw, leaving what another device changed since', async () => {
    const { cursor } = await ops([
      op('mkdir', { id: 'f', parent: null, name: 'Folder' }),
      op('create', { id: 'seen', kind: 'note', parent: 'f', name: 'seen.md' }),
    ])
    await one(op('create', { id: 'new', kind: 'note', parent: 'f', name: 'new.md' }), other)

    expect(await one(op('delete', { id: 'f' }, cursor))).toMatchObject({ refused: 'edited' })
    expect(row('seen').deleted).toBe(1)
    expect(row('new').deleted).toBe(0)
    expect(folders()[0]?.deleted).toBe(0)
  })

  test('keep the path of five hundred notes current when their folder is renamed', async () => {
    const creates = Array.from({ length: 500 }, (_, at) =>
      op('create', {
        id: `n${String(at)}`,
        kind: 'note',
        parent: at % 2 ? 'sub' : 'big',
        name: `${String(at)}.md`,
      }),
    )
    await ops([
      op('mkdir', { id: 'big', parent: null, name: 'Big' }),
      op('mkdir', { id: 'sub', parent: 'big', name: 'Sub' }),
    ])
    for (let at = 0; at < creates.length; at += 200) await ops(creates.slice(at, at + 200))
    const since = (await call(env, `/v1/spaces/${space}/changes?since=0`, { token })).json.cursor

    await one(op('rename', { id: 'big', name: 'Huge' }))

    const paths = env.db
      .prepare("select path, seq from notes where space_id = ? and id like 'n%'")
      .all(space) as { path: string; seq: number }[]
    expect(paths).toHaveLength(500)
    expect(paths.every((one) => /^Huge\/(Sub\/)?\d+\.md$/.test(one.path))).toBe(true)
    expect(new Set(paths.map((one) => one.seq)).size).toBe(500)
    // What D1 would take in one statement, however many rows moved.
    expect(env.widest().count).toBeLessThanOrEqual(100)

    // And a v1 app reads every one of them off its feed.
    const moved = await call(env, `/v1/spaces/${space}/changes?since=${String(since)}`, { token })
    expect(moved.json.notes).toHaveLength(500)
  })

  test('answer an op sent again after its answer was lost with the first answer', async () => {
    const batch = [
      op('create', { id: 'x', kind: 'note', parent: null, name: 'x.md' }),
      op('rename', { id: 'x', name: 'y.md' }),
    ]
    const first = await ops(batch)
    await one(op('rename', { id: 'x', name: 'z.md' }), other)

    const again = await ops(batch)
    expect(again.results).toEqual(first.results)
    expect(row('x').path).toBe('z.md')
    expect(env.db.prepare("select count(*) as n from notes where id = 'x'").get()).toEqual({ n: 1 })
  })

  test('refuse every op of somebody who may only read the space', async () => {
    const reader = await invited(env, token, space, 'reader@example.com', 'read')
    expect(
      await one(op('create', { id: 'r', kind: 'note', parent: null, name: 'r.md' }), reader),
    ).toMatchObject({ refused: 'role' })
  })

  test('answer somebody given one file of the space with nothing at all', async () => {
    const id = await made('Given.md')
    const given = await invited(env, token, space, 'given@example.com', 'write', id)
    const answer = await call(env, `/v2/spaces/${space}/ops`, {
      token: given,
      body: { ops: [op('delete', { id })] },
    })
    expect(answer.status).toBe(404)
    expect(row(id).deleted).toBe(0)
  })

  test('make a file only for bytes the account keeps', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const file = { kind: 'file', parent: null, name: 'picture.png', hash }

    expect(await one(op('create', { id: 'pic', ...file }))).toMatchObject({ refused: 'gone' })

    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': 'image/png' },
    })
    expect(await one(op('create', { id: 'pic', ...file }))).toMatchObject({ ok: true })
    expect(row('pic')).toMatchObject({ kind: 'file', hash, epoch: 0 })

    // And a v1 app never reads it as a note.
    const v1 = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(v1.json.notes.map((one) => one.id)).not.toContain('pic')
    expect((await call(env, '/v1/notes/pic', { token })).status).toBe(404)
  })
})

describe('the feed', () => {
  beforeEach(async () => {
    await prepare()
  })

  test('carries the tree and the words in one order', async () => {
    const { cursor } = await ops([
      op('mkdir', { id: 'f', parent: null, name: 'F' }),
      op('create', { id: 'n', kind: 'note', parent: 'f', name: 'n.md' }),
    ])
    const page = await feed()
    expect(page.items.map((item) => [item.id, item.kind, item.parent, item.name])).toEqual([
      ['f', 'folder', null, 'F'],
      ['n', 'note', 'f', 'n.md'],
    ])
    expect(page.cursor).toBe(cursor)
    expect(page.more).toBe(false)
    expect(page.items[1]).toMatchObject({ epoch: 1, docSeq: 0, deleted: false })

    // Words written move the note's docSeq, and only its.
    await call(env, '/v1/notes/n', { method: 'PUT', token, body: { content: 'words\n' } })
    const next = await feed(cursor)
    expect(next.items.map((item) => item.id)).toEqual(['n'])
    expect(next.items[0]?.docSeq).toBe(next.items[0]?.seq)
  })

  test('pages at a thousand', async () => {
    for (let at = 0; at < 1100; at += 200) {
      await ops(
        Array.from({ length: Math.min(200, 1100 - at) }, (_, one) =>
          op('create', { id: `p${String(at + one)}`, kind: 'note', parent: null, name: `${String(at + one)}.md` }),
        ),
      )
    }
    const first = await feed()
    expect(first.items).toHaveLength(1000)
    expect(first.more).toBe(true)
    const second = await feed(first.cursor)
    expect(second.items).toHaveLength(100)
    expect(second.more).toBe(false)
  })
})
