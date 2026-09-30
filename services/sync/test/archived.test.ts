import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readArchived } from '../src/spaces/archived'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

function put(archived: unknown) {
  return call(env, `/v1/spaces/${space}/archived`, { method: 'PUT', token, body: { archived } })
}

/** What the space listing says is archived, which is how the app reads it. */
async function listed() {
  const { json } = await call(env, '/v1/spaces', { token })
  return json.spaces.find((one) => one.id === space)?.archived
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set archived = ? where id = ?').run(raw, space)
}

const PUT_AWAY = { 'Old/2019': 1_700_000_000_000, 'Plan.md': 1_700_000_500_000 }

describe('what a space has archived', () => {
  test('starts as nothing', async () => {
    expect(await listed()).toEqual({})
  })

  test('is kept whole, restores included, and rides the space listing', async () => {
    const map = { ...PUT_AWAY, 'Taken back.md': -1_700_000_900_000 }
    const set = await put(map)
    expect(set.status).toBe(200)
    expect(set.json.archived).toEqual(map)

    expect(await listed()).toEqual(map)
  })

  test('is replaced by what arrives: the app has met the two copies already', async () => {
    await put(PUT_AWAY)
    await put({ 'Plan.md': -1_700_000_600_000 })

    expect(await listed()).toEqual({ 'Plan.md': -1_700_000_600_000 })
  })

  test('marks the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(PUT_AWAY)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what may be in it', () => {
  test('is a map, and never a list or a word', async () => {
    expect((await put([])).status).toBe(400)
    expect((await put('Plan.md')).status).toBe(400)
  })

  test('and a path inside the space with a whole moment, nothing else', async () => {
    const set = await put({
      'Plan.md': 5,
      '/etc/passwd': 5,
      'C:\\notes': 5,
      '../outside': 5,
      'Half.md': 1.5,
      'Never.md': 0,
      'Word.md': 'soon',
    })

    expect(set.json.archived).toEqual({ 'Plan.md': 5 })
  })

  test('and a folder may be called __proto__ without becoming the map', async () => {
    const set = await put(JSON.parse('{"__proto__": 7, "Plan.md": 5}'))

    expect(set.json.archived).toEqual(JSON.parse('{"__proto__": 7, "Plan.md": 5}'))
  })

  test('and more entries than a space keeps is refused, so nothing is lost', async () => {
    const many = Object.fromEntries(Array.from({ length: 1001 }, (_one, at) => [`n${at}.md`, 1]))

    expect((await put(many)).status).toBe(400)
  })

  test('and more bytes than the column holds says so', async () => {
    const long = Object.fromEntries(
      Array.from({ length: 1000 }, (_one, at) => [`${'p'.repeat(280)}${at}`, 1_700_000_000_000]),
    )
    const answer = await put(long)

    expect(answer.status).toBe(413)
    expect(answer.json.error).toBe('that is more archived paths than a space holds')
  })
})

describe('reading the column back', () => {
  test('keeps the entries and leaves the rest', async () => {
    column('{"Plan.md": 5, "Old": {"at": 1}, "../x": 3}')

    expect(await listed()).toEqual({ 'Plan.md': 5 })
  })

  test('and answers with nothing at all for a column that is not a map', () => {
    expect(readArchived('not json')).toEqual({})
    expect(readArchived('[]')).toEqual({})
    expect(readArchived('null')).toEqual({})
  })
})
