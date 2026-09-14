import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isName, readArranged } from '../src/spaces/arranged'
import { call, mail, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

function put(arranged: unknown, options: { as?: string; id?: string } = {}) {
  return call(env, `/v1/spaces/${options.id ?? space}/arranged`, {
    method: 'PUT',
    token: options.as ?? token,
    body: { arranged },
  })
}

/** What the space listing says the folders were arranged into, which is how the app
 *  reads it. */
async function listed(as = token) {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces.find((one) => one.id === space)?.arranged
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set arranged = ? where id = ?').run(raw, space)
}

/** Somebody the owner gave the space to at read, and in it: invited, then having
 *  proved the address by signing in. Which roles every space route lets through is one
 *  matrix in share.test.ts; this is here because the order is the space's, so being in
 *  it is not the same as being allowed to change it. */
async function reader(): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite`, {
      token,
      body: { email: 'c@d.dev', role: 'read' },
    }),
  )

  const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
  if (!link) throw new Error(`no invitation was sent:\n${sent}`)

  const theirs = await signIn(env, 'c@d.dev')
  await call(env, `/v1/join/${link}`, { method: 'POST', token: theirs })
  return theirs
}

/** Two folders whose rows were dragged, one inside the other. The top of the space is a
 *  key like any other and has a describe of its own below. */
const ARRANGED = {
  Work: ['Plan.md', 'Ideas', 'Old.md'],
  'Work/Ideas': ['Best.md', 'Rest.md'],
}

describe("the order a space's folders were arranged into", () => {
  test('starts as nothing, every folder being in name order', async () => {
    expect(await listed()).toEqual({})
  })

  test('is kept whole, and rides the space listing', async () => {
    const set = await put(ARRANGED)
    expect(set.status).toBe(200)
    expect(set.json.arranged).toEqual(ARRANGED)

    expect(await listed()).toEqual(ARRANGED)
  })

  test('is replaced by the map that arrives, which is how a folder goes back to names', async () => {
    await put(ARRANGED)
    await put({ Work: ['Plan.md'] })

    expect(await listed()).toEqual({ Work: ['Plan.md'] })
  })

  test('goes away when an empty map is sent', async () => {
    await put(ARRANGED)
    await put({})

    expect(await listed()).toEqual({})
  })

  /** An empty list says exactly what no entry says, so the column holds the shorter of
   *  the two rather than both. */
  test('drops a folder whose list comes to nothing', async () => {
    const set = await put({ ...ARRANGED, Travel: [] })

    expect(set.json.arranged).toEqual(ARRANGED)
  })

  test('marks the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(ARRANGED)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what one folder may hold', () => {
  test('is the names of its children, each once and in the order they arrived', async () => {
    const set = await put({ Work: ['b.md', 'a.md', 'b.md', 'c.md', 'a.md'] })

    expect(set.json.arranged).toEqual({ Work: ['b.md', 'a.md', 'c.md'] })
  })

  test('and never a path, nor a way out of the folder', () => {
    expect(isName('Plan.md')).toBe(true)
    expect(isName('..hidden.md')).toBe(true)
    expect(isName('a'.repeat(255))).toBe(true)
    expect(isName('a'.repeat(256))).toBe(false)

    expect(isName('')).toBe(false)
    expect(isName('.')).toBe(false)
    expect(isName('..')).toBe(false)
    expect(isName('Work/Plan.md')).toBe(false)
    expect(isName(String.raw`..\..\Plan.md`)).toBe(false)
    expect(isName('/etc/passwd')).toBe(false)
  })

  /** For the reason a path holds none: a name with a newline in it is two names to
   *  whatever reads it next. */
  test('and never a name that is two names to whatever reads it', () => {
    expect(isName('Plan\nOld.md')).toBe(false)
    expect(isName('Plan\u0000.md')).toBe(false)
    // A space in the middle is a name, though, and one somebody typed on purpose.
    expect(isName('Old plan.md')).toBe(true)
  })

  test('so a name that is a path or a climb out of one is dropped', async () => {
    const set = await put({
      Work: ['Plan.md', 'Ideas/Best.md', '..', '.', String.raw`..\secret`, '', 7, null, {}],
    })

    expect(set.status).toBe(200)
    expect(set.json.arranged).toEqual({ Work: ['Plan.md'] })
  })

  test('and a list longer than one gets is cut rather than refused', async () => {
    const many = Array.from({ length: 501 }, (_one, at) => `${at}.md`)
    const set = await put({ Work: many })

    expect(set.status).toBe(200)
    expect(set.json.arranged.Work).toHaveLength(500)
    expect(set.json.arranged.Work).toEqual(many.slice(0, 500))
  })
})

describe('an entry that is not a folder of this space with an order on it', () => {
  test('is dropped when the key is not a path inside the space', async () => {
    for (const path of ['/etc', '../secret', 'a/../../b', String.raw`C:\secret`, 'C:/secret']) {
      const set = await put({ [path]: ['Plan.md'], Work: ['Plan.md'] })

      expect(set.status, path).toBe(200)
      expect(set.json.arranged, path).toEqual({ Work: ['Plan.md'] })
    }
  })

  test('takes a key with dots in a name of its own', async () => {
    expect((await put({ 'Work/..hidden': ['Plan.md'] })).json.arranged).toEqual({
      'Work/..hidden': ['Plan.md'],
    })
  })

  /** A name a filesystem allows is a folder somebody may have, and a key set on an
   *  object as a loop goes would have become that object's prototype rather than an
   *  entry in it. */
  test('takes a folder named the way an object names its prototype', async () => {
    // Written as JSON rather than as an object literal, where `__proto__` is no key at
    // all but the prototype of the thing being written.
    const sent: unknown = JSON.parse('{"__proto__":["Plan.md"],"Work":["Plan.md"]}')
    const set = await put(sent)

    expect(Object.keys(set.json.arranged).sort()).toEqual(['Work', '__proto__'])
    expect(Object.getOwnPropertyDescriptor(set.json.arranged, '__proto__')?.value).toEqual([
      'Plan.md',
    ])
  })

  test('is dropped when the value is not a list of names at all', async () => {
    for (const order of ['Plan.md', 7, null, {}, { 0: 'Plan.md' }, true]) {
      const set = await put({ Bad: order, Work: ['Plan.md'] })

      const said = JSON.stringify(order)
      expect(set.status, said).toBe(200)
      expect(set.json.arranged, said).toEqual({ Work: ['Plan.md'] })
    }
  })

  test('leaves the rest of the tree arranged, the map being written whole', async () => {
    await put({ ...ARRANGED, '../elsewhere': ['Plan.md'], Travel: 'Plan.md' })

    expect(await listed()).toEqual(ARRANGED)
  })
})

/** The top of the space is a folder whose rows somebody can drag, and the key it has is
 *  the one the app's own arithmetic gives it: a path relative to the root is no path at
 *  all. The icons refuse an empty key because a folder with no name is not a folder
 *  anybody can dress; this column takes it. */
describe('the top of the space', () => {
  test('is a key like any other, and rides the space listing', async () => {
    const set = await put({ '': ['b.md', 'a.md'] })

    expect(set.status).toBe(200)
    expect(set.json.arranged).toEqual({ '': ['b.md', 'a.md'] })
    expect(await listed()).toEqual({ '': ['b.md', 'a.md'] })
  })

  test('sits beside the folders inside it', async () => {
    const whole = { '': ['Work', 'Read me.md'], ...ARRANGED }

    expect((await put(whole)).json.arranged).toEqual(whole)
    expect(await listed()).toEqual(whole)
  })

  test('and is still the only key with no name in it', async () => {
    const set = await put({ '': ['a.md'], '/etc': ['a.md'], '../up': ['a.md'], 'C:/x': ['a.md'] })

    expect(set.json.arranged).toEqual({ '': ['a.md'] })
  })
})

describe('a map that is not one', () => {
  test('is refused', async () => {
    expect((await put([['Plan.md']])).status).toBe(400)
    expect((await put('Plan.md')).status).toBe(400)
    expect((await put(null)).status).toBe(400)
    expect((await put(undefined)).status).toBe(400)
  })

  test('is refused when the body is not an object at all', async () => {
    const sent = await call(env, `/v1/spaces/${space}/arranged`, {
      method: 'PUT',
      token,
      body: [ARRANGED],
    })

    expect(sent.status).toBe(400)
  })

  test('says what is wrong with it', async () => {
    expect((await put('Plan.md')).json.error).toBe('arranged must be a map')
  })

  test('leaves what was there as it was', async () => {
    await put(ARRANGED)
    await put('nonsense')

    expect(await listed()).toEqual(ARRANGED)
  })
})

describe('more arranged folders than a space holds', () => {
  const many = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_one, at) => [`${at}`, ['Plan.md']]))

  test('is refused by the count, at the number the app holds itself to', async () => {
    expect((await put(many(200))).status).toBe(200)

    const past = await put(many(201))
    expect(past.status).toBe(400)
    expect(past.json.error).toBe('arranged holds at most 200 folders')
  })

  test('is refused by the size, when every entry is legal on its own', async () => {
    // Two hundred folders, each holding a dozen names as long as a name may get, is
    // more than the column carries, which is the other end of the same guard.
    const names = Array.from({ length: 12 }, (_one, at) => `${'n'.repeat(200)}${at}.md`)
    const heavy = Object.fromEntries(Array.from({ length: 200 }, (_one, at) => [`${at}`, names]))

    expect((await put(heavy)).status).toBe(413)
    expect(await listed()).toEqual({})
  })
})

/** The column is written whole by clients, so a newer app may have left something in it
 *  this build has never heard of. Read, not trusted. */
describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    column(JSON.stringify({ ...ARRANGED, '../elsewhere': ['Plan.md'], Travel: { by: 'size' } }))

    expect(await listed()).toEqual(ARRANGED)
  })

  test('and answers with nothing at all for a column that is not a map', () => {
    expect(readArranged('not json')).toEqual({})
    expect(readArranged('["Work"]')).toEqual({})
    expect(readArranged('null')).toEqual({})
    expect(readArranged('7')).toEqual({})
  })
})

describe('the order is the space’s', () => {
  test('so everybody in it reads the same one', async () => {
    const theirs = await reader()
    await put(ARRANGED)

    expect(await listed(theirs)).toEqual(ARRANGED)
  })

  test('and arranging a folder is writing in the space, which a reader may not', async () => {
    const theirs = await reader()

    expect((await put(ARRANGED, { as: theirs })).status).toBe(403)
    expect(await listed()).toEqual({})
  })

  test('is not another account’s to write', async () => {
    const other = await signIn(env, 'e@f.dev')

    // The same answer an id that does not exist gets: nothing about the space leaks,
    // not even that it is there.
    expect((await put(ARRANGED, { as: other })).status).toBe(404)
    expect(await listed()).toEqual({})
  })

  test('needs a session at all', async () => {
    expect((await call(env, `/v1/spaces/${space}/arranged`, { method: 'PUT' })).status).toBe(401)
  })

  test('answers 404 for a space that is not there', async () => {
    expect((await put(ARRANGED, { id: 'nope' })).status).toBe(404)
  })
})
