/** What a space keeps about its own tree, one entry at a time (docs/sync-v2.md 5.11):
 *  two devices changing different entries both keep theirs, a folder's icon and a
 *  row's place are keyed by what they are about so a rename orphans neither, a v1
 *  app's whole value is read as every entry changed, and what a v1 app reads is
 *  written from the entries. And the account's settings, merged per key. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

let env: TestEnv
let laptop: string
let phone: string
let space: string

beforeEach(async () => {
  env = testEnv()
  live(env)
  laptop = await signIn(env, 'maps@example.com')
  phone = await signIn(env, 'maps@example.com')
  space = (await call(env, '/v1/spaces', { token: laptop, body: { name: 'Maps' } })).json.space.id
})

afterEach(() => env.close())

async function prepare() {
  await call(env, `/v2/spaces/${space}/prepare`, { token: laptop, method: 'POST' })
}

async function listed() {
  const { json } = await call(env, '/v1/spaces', { token: laptop })
  const found = json.spaces.find((one) => one.id === space)
  if (!found) throw new Error('no space')
  return found
}

function patch(token: string, entries: object[]) {
  return call<{ cursor: number; error: string }>(env, `/v2/spaces/${space}/maps`, {
    method: 'PATCH',
    token,
    body: { entries },
  })
}

interface Entries {
  entries: { map: string; key: string; value: unknown; seq: number }[]
  cursor: number
}

async function entries(since = 0): Promise<Entries> {
  return (await call<Entries>(env, `/v2/spaces/${space}/maps?since=${String(since)}`, { token: laptop })).json
}

function bookmark(path: string, at: number) {
  return { kind: 'note', path, text: path, at }
}

describe('entries of a map', () => {
  beforeEach(prepare)

  test('two devices changing different bookmarks both keep theirs, in their order', async () => {
    await patch(laptop, [{ map: 'bookmark', key: 'b1', value: bookmark('a.md', 1) }])
    await patch(phone, [{ map: 'bookmark', key: 'b2', value: bookmark('b.md', 0.5) }])

    expect((await listed()).bookmarks.map((one) => one.path)).toEqual(['b.md', 'a.md'])
    expect((await entries()).entries.map((one) => one.key).sort()).toEqual(['b1', 'b2'])
  })

  test('the later of two changes to one entry stands, and a null takes it away', async () => {
    await patch(laptop, [{ map: 'graph', key: 'orphans', value: true }])
    await patch(phone, [{ map: 'graph', key: 'orphans', value: false }])
    expect((await listed()).graph).toEqual({ orphans: false })

    await patch(laptop, [{ map: 'graph', key: 'orphans', value: null }])
    expect((await listed()).graph).toEqual({})
  })

  test('refused when one of them is not what the map holds', async () => {
    const answer = await patch(laptop, [{ map: 'graph', key: 'nonsense', value: 1 }])
    expect(answer.status).toBe(400)
  })

  test('a folder keeps its icon and its order through a rename on a v2 device', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token: laptop,
      body: { path: 'Work/a.md', content: 'a' },
    })
    await call(env, `/v1/spaces/${space}/notes`, {
      token: laptop,
      body: { path: 'Work/b.md', content: 'b' },
    })
    const tree = env.db
      .prepare("select id, name from notes where space_id = ? and path like 'Work/%' order by name")
      .all(space) as { id: string }[]
    const folder = env.db.prepare('select id from folders where space_id = ?').get(space) as {
      id: string
    }

    await patch(laptop, [
      { map: 'icon', key: folder.id, value: { icon: 'briefcase', tint: 'blue' } },
      { map: 'order', key: tree[1]?.id ?? '', value: 1 },
      { map: 'order', key: tree[0]?.id ?? '', value: 2 },
    ])
    expect((await listed()).icons).toEqual({ Work: 'briefcase' })
    expect((await listed()).arranged).toEqual({ Work: ['b.md', 'a.md'] })

    await call(env, `/v2/spaces/${space}/ops`, {
      token: phone,
      body: { ops: [{ op: 'r1', t: 'rename', id: folder.id, name: 'Job', seen: 0 }] },
    })
    const after = await listed()
    expect(after.icons).toEqual({ Job: 'briefcase' })
    expect(after.tints).toEqual({ Job: 'blue' })
    expect(after.arranged).toEqual({ Job: ['b.md', 'a.md'] })
  })
})

describe('a v1 app writing a whole value', () => {
  test('is read as every entry changed', async () => {
    await prepare()
    await call(env, `/v1/spaces/${space}/bookmarks`, {
      method: 'PUT',
      token: laptop,
      body: { bookmarks: [bookmark('a.md', 0), bookmark('b.md', 0)].map(({ at: _at, ...one }) => one) },
    })
    const first = await entries()
    expect(first.entries.filter((one) => one.value !== null)).toHaveLength(2)

    // One taken out: its entry goes, the other keeps its key.
    await call(env, `/v1/spaces/${space}/bookmarks`, {
      method: 'PUT',
      token: laptop,
      body: { bookmarks: [{ kind: 'note', path: 'b.md', text: 'b.md' }] },
    })
    const second = await entries(first.cursor)
    const kept = first.entries.find((one) => (one.value as { path: string }).path === 'b.md')
    expect(second.entries.find((one) => one.value === null)?.key).not.toBe(kept?.key)
  })

  test('and what a space kept before it was prepared is read in as entries', async () => {
    await call(env, `/v1/spaces/${space}/graph`, {
      method: 'PUT',
      token: laptop,
      body: { graph: { orphans: true } },
    })
    await call(env, `/v1/spaces/${space}/excluded`, {
      method: 'PUT',
      token: laptop,
      body: { excluded: ['Private'] },
    })
    await prepare()

    const kept = (await entries()).entries.map((one) => [one.map, one.key, one.value])
    expect(kept).toEqual(
      expect.arrayContaining([
        ['graph', 'orphans', true],
        ['excluded', 'Private', true],
      ]),
    )
  })
})

describe("the account's settings", () => {
  test('two devices changing different settings at once both keep theirs', async () => {
    // The other device's write lands between this one reading the settings and
    // writing them.
    env.justBefore(/update users set settings/, () => {
      env.db
        .prepare(`update users set settings = json_set(coalesce(settings, '{}'), '$.vim', json('true'))`)
        .run()
    })
    const answer = await call(env, '/v1/settings', {
      method: 'PATCH',
      token: laptop,
      body: { preset: 'obsidian' },
    })
    expect(answer.status, answer.text).toBe(200)
    expect(answer.json.settings).toMatchObject({ vim: true, preset: 'obsidian' })
  })
})
