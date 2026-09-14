import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { listIn, MOST_BODY_BYTES, objectBody, objectIn } from '../src/body'
import { MAX_NOTE_BYTES } from '../src/notes'

/** What every route that reads its own fields does with a body, and what every
 *  reader does with a column.
 *
 *  Nine routes had written the same parse out and eight readers the same
 *  try/catch, and each of the nine answers with its own sentence. This holds both
 *  ends of that: one reading, and the sentence each route has always sent - byte
 *  for byte, because the app drops it into a line of its own text.
 *
 *  A backward-compatibility test as much as a refactor's: today's client and last
 *  month's send the same bodies to these routes, and what a route answers a
 *  malformed one with is part of its contract. */

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

/** The bodies a route must refuse: a list, a number, a string, and nonsense. Each
 *  is a client's mistake rather than a field that is wrong. */
const NOT_OBJECTS: { what: string; raw: string }[] = [
  { what: 'a list', raw: '[1, 2]' },
  { what: 'a number', raw: '7' },
  { what: 'a string', raw: '"name"' },
  { what: 'nothing parseable', raw: '{' },
]

/** Every route that reads its own fields out of the body, with the method it takes
 *  and the body an older client sends it. */
const ROUTES: { name: string; path: () => string; method: string; older: unknown }[] = [
  {
    name: 'PUT /v1/spaces/:id/bookmarks',
    path: () => `/v1/spaces/${space}/bookmarks`,
    method: 'PUT',
    older: { bookmarks: [{ kind: 'note', path: 'Read me.md', text: '' }] },
  },
  {
    name: 'PUT /v1/spaces/:id/excluded',
    path: () => `/v1/spaces/${space}/excluded`,
    method: 'PUT',
    older: { excluded: ['Archive'] },
  },
  {
    name: 'PUT /v1/spaces/:id/files',
    path: () => `/v1/spaces/${space}/files`,
    method: 'PUT',
    older: { files: [] },
  },
  {
    name: 'PUT /v1/spaces/:id/graph',
    path: () => `/v1/spaces/${space}/graph`,
    method: 'PUT',
    older: { graph: { depth: 2 } },
  },
  {
    name: 'PUT /v1/spaces/:id/icons',
    path: () => `/v1/spaces/${space}/icons`,
    method: 'PUT',
    older: { icons: { Archive: '📦' } },
  },
  {
    name: 'PUT /v1/spaces/:id/archived-folders',
    path: () => `/v1/spaces/${space}/archived-folders`,
    method: 'PUT',
    older: { archivedFolders: { Archive: '2026-09-14T08:30:00.000Z' } },
  },
  {
    name: 'PUT /v1/spaces/:id/site',
    path: () => `/v1/spaces/${space}/site`,
    method: 'PUT',
    older: { rules: { include: ['Public'] } },
  },
  {
    name: 'POST /v1/spaces/:id/site/preview',
    path: () => `/v1/spaces/${space}/site/preview`,
    method: 'POST',
    older: { rules: { otherwise: 'none' } },
  },
  {
    name: 'PATCH /v1/settings',
    path: () => '/v1/settings',
    method: 'PATCH',
    older: { keepVersions: 30 },
  },
]

describe('a body that is not an object', () => {
  for (const route of ROUTES) {
    for (const { what, raw } of NOT_OBJECTS) {
      test(`${route.name} refuses ${what}, in the words it always has`, async () => {
        const answer = await call(env, route.path(), { method: route.method, token, raw })

        expect(answer.status).toBe(400)
        expect(answer.json.error).toBe('send an object')
      })
    }
  }

  test('and a route that asks for its fields one at a time says so its own way', async () => {
    // `readBody`'s wording, which is a different set of routes and has not moved.
    const answer = await call(env, '/v1/spaces', { method: 'POST', token, raw: '[1, 2]' })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('send a JSON object')
  })
})

describe('the body an older client sends', () => {
  for (const route of ROUTES) {
    test(`${route.name} still takes it`, async () => {
      const answer = await call(env, route.path(), {
        method: route.method,
        token,
        body: route.older,
      })

      expect(answer.status).toBe(200)
    })
  }
})

/** The one route where an empty body means something. A client asking for a token
 *  without saying anything is asking for a read-only one, and that is how every
 *  build since the route landed has asked. */
describe('POST /v1/mcp/token', () => {
  test('takes no body at all, and hands back a read-only token', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token })

    expect(answer.status).toBe(200)
    expect(typeof answer.json.token).toBe('string')
  })

  test('and an unparseable body the same way, as it always has', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token, raw: '{' })
    expect(answer.status).toBe(200)
  })

  test('but refuses a body that parsed to something else', async () => {
    const answer = await call(env, '/v1/mcp/token', { method: 'POST', token, raw: '[1, 2]' })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('send an object')
  })

  test('and still refuses a readOnly that is not true or false', async () => {
    const answer = await call(env, '/v1/mcp/token', {
      method: 'POST',
      token,
      body: { readOnly: 'yes' },
    })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('readOnly must be true or false')
  })
})

describe('what the one reading answers', () => {
  /** The smallest thing with a body, which is all `objectBody` asks for. */
  const sent = (json: () => Promise<unknown>) => ({ req: { json: json as never } })

  test('the object where a body was one', async () => {
    expect(await objectBody(sent(() => Promise.resolve({ a: 1 })))).toEqual({ a: 1 })
  })

  test('null where it parsed to something else', async () => {
    expect(await objectBody(sent(() => Promise.resolve([1, 2])))).toBeNull()
    expect(await objectBody(sent(() => Promise.resolve(7)))).toBeNull()
    expect(await objectBody(sent(() => Promise.resolve(null)))).toBeNull()
  })

  test('and undefined where there was no body to parse', async () => {
    expect(await objectBody(sent(() => Promise.reject(new Error('no body'))))).toBeUndefined()
  })

  /** Parsing first and measuring afterwards is how a Worker with a hundred and
   *  twenty-eight megabytes is asked to hold a hundred - and `/v1/auth/code` takes a
   *  body from anybody at all. So the length a request declares is read first. */
  test('and null for a body that says it is longer than one, without reading it', async () => {
    let read = 0
    const long = {
      req: {
        json: (() => {
          read += 1
          return Promise.resolve({ a: 1 })
        }) as never,
        header: (name: string) =>
          name === 'content-length' ? String(MOST_BODY_BYTES + 1) : undefined,
      },
    }

    expect(await objectBody(long)).toBeNull()
    expect(read).toBe(0)
  })

  test('while a body the routes were built for is read as it always was', async () => {
    const held = (length: number) => ({
      req: {
        json: (() => Promise.resolve({ a: 1 })) as never,
        header: (name: string) => (name === 'content-length' ? String(length) : undefined),
      },
    })

    expect(await objectBody(held(0))).toEqual({ a: 1 })
    expect(await objectBody(held(MOST_BODY_BYTES))).toEqual({ a: 1 })
  })

  /** The longest field any body carries is a note, so the ceiling has to be above
   *  it: the two are in different modules and a note could otherwise grow past the
   *  body that has to hold it. */
  test('and the ceiling leaves room for the longest note', () => {
    expect(MOST_BODY_BYTES).toBeGreaterThan(MAX_NOTE_BYTES)
  })
})

describe('what a stored column reads as', () => {
  test('a list, where it holds one', () => {
    expect(listIn('[1, "two"]')).toEqual([1, 'two'])
    expect(objectIn('{"a":1}')).toEqual({ a: 1 })
  })

  test('and nothing at all where it holds anything else', () => {
    for (const raw of ['{"a":1}', '7', '"text"', '{', '']) expect(listIn(raw)).toBeNull()
    for (const raw of ['[1]', '7', '"text"', '{', '']) expect(objectIn(raw)).toBeNull()
  })

  test('and nothing for a column that was never written', () => {
    expect(listIn(null)).toBeNull()
    expect(listIn(undefined)).toBeNull()
    expect(objectIn(null)).toBeNull()
    expect(objectIn(undefined)).toBeNull()
  })

  /** A column nobody can read must not reach a caller as something it can walk:
   *  `JSON.parse('null')` is a successful parse of nothing. */
  test('and a column that says null is not an object', () => {
    expect(objectIn('null')).toBeNull()
    expect(listIn('null')).toBeNull()
  })
})
