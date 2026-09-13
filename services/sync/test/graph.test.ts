import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readGraph } from '../src/spaces/graph'
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

function put(graph: unknown) {
  return call(env, `/v1/spaces/${space}/graph`, { method: 'PUT', token, body: { graph } })
}

/** What the space listing says about the picture, which is how the app reads it. */
async function listed() {
  const { json } = await call(env, '/v1/spaces', { token })
  return json.spaces.find((one) => one.id === space)?.graph
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set graph = ? where id = ?').run(raw, space)
}

const DRAWN = {
  filter: 'tag:work -path:archive',
  orphans: false,
  groups: [{ query: 'tag:work', colour: 2 }],
  spread: 1.5,
  gather: false,
  arrows: true,
  sized: false,
  lines: 3,
  depth: 2,
}

describe("how a space's graph is drawn", () => {
  test('starts as nothing said, which is the app asking for its defaults', async () => {
    expect(await listed()).toEqual({})
  })

  test('is kept whole, and rides the space listing', async () => {
    const set = await put(DRAWN)
    expect(set.status).toBe(200)
    expect(set.json.graph).toEqual(DRAWN)

    expect(await listed()).toEqual(DRAWN)
  })

  test('is replaced by what arrives, which is how a filter is cleared', async () => {
    await put(DRAWN)
    await put({ filter: '' })

    expect(await listed()).toEqual({ filter: '' })
  })

  test('marks the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(DRAWN)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what a space may say about its graph', () => {
  test('is an object, and never a list or a word', async () => {
    expect((await put([])).status).toBe(400)
    expect((await put('all of it')).status).toBe(400)
  })

  test('and a field this build has never heard of is dropped, not refused', async () => {
    const set = await put({ arrows: true, curvature: 3 })

    expect(set.status).toBe(200)
    expect(set.json.graph).toEqual({ arrows: true })
  })

  test('and a switch that is not one is dropped rather than guessed at', async () => {
    const set = await put({ arrows: 'yes', sized: true })

    expect(set.json.graph).toEqual({ sized: true })
  })

  test('and a spread or a depth outside what the app offers is held to it', async () => {
    const set = await put({ spread: 400, gather: true, depth: 9 })

    expect(set.json.graph).toEqual({ spread: 4, gather: true, depth: 3 })
  })

  test('and a line width outside the three steps is held to them', async () => {
    expect((await put({ lines: 9 })).json.graph).toEqual({ lines: 3 })
    expect((await put({ lines: 0 })).json.graph).toEqual({ lines: 1 })
    expect((await put({ lines: 'thick' })).json.graph).toEqual({})
  })

  test('and a filter longer than a query is refused, so nothing else is lost', async () => {
    expect((await put({ filter: 'a'.repeat(201) })).status).toBe(400)
    expect((await put({ filter: 'a'.repeat(200) })).status).toBe(200)
  })

  test('and the row a card has just added, with nothing typed in it yet, is kept', async () => {
    const set = await put({ groups: [{ query: '', colour: 4 }] })

    expect(set.json.graph).toEqual({ groups: [{ query: '', colour: 4 }] })
  })

  test('and more colour groups than the theme has colours is refused', async () => {
    const many = Array.from({ length: 7 }, (_one, index) => ({
      query: `tag:t${index}`,
      colour: 1,
    }))

    expect((await put({ groups: many })).status).toBe(400)
  })

  test('and a group with no colour, or one the theme has not, is put right', async () => {
    const set = await put({
      groups: [{ query: 'tag:work', colour: 99 }, { query: 'path:x' }, { colour: 3 }],
    })

    // An entry with no query key is not a group at all. One whose query is empty
    // is the row the card has just added, and that one is kept.
    expect(set.json.graph).toEqual({
      groups: [
        { query: 'tag:work', colour: 6 },
        { query: 'path:x', colour: 1 },
      ],
    })
  })
})

/** The column is written whole by clients, so a newer app may have left something
 *  in it this build has never heard of. Read, not trusted. */
describe('reading the column back', () => {
  test('keeps what reads as a setting and leaves the rest', async () => {
    column('{"arrows":true,"filter":"plan","somethingElse":{"deep":1}}')

    expect(await listed()).toEqual({ filter: 'plan', arrows: true })
  })

  test('and answers with nothing at all for a column that is not an object', () => {
    expect(readGraph('not json')).toEqual({})
    expect(readGraph('[1,2]')).toEqual({})
    expect(readGraph('null')).toEqual({})
  })
})
