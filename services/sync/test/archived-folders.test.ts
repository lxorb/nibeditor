import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readArchivedFolders } from '../src/spaces/archived-folders'
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

function put(archivedFolders: unknown, options: { as?: string; id?: string } = {}) {
  return call(env, `/v1/spaces/${options.id ?? space}/archived-folders`, {
    method: 'PUT',
    token: options.as ?? token,
    body: { archivedFolders },
  })
}

/** What the space listing says has been put away, which is how the app reads it. */
async function listed(as = token) {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces.find((one) => one.id === space)?.archivedFolders
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set archived_folders = ? where id = ?').run(raw, space)
}

/** Somebody the owner gave the space to at read, and in it: invited, then having
 *  proved the address by signing in. The map is the space's, so being in it is not
 *  the same as being allowed to change it; see icons.test.ts, which arranges the
 *  same person for the same reason. */
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

/** Two folders put away, with the moment each of them went. */
const AWAY = { Archive: '2026-09-13T10:00:00.000Z', 'Work/Old plans': '2026-09-14T08:30:00.000Z' }

describe('the folders a space has put away', () => {
  test('start as nothing', async () => {
    expect(await listed()).toEqual({})
  })

  test('are kept whole, and ride the space listing', async () => {
    const set = await put(AWAY)
    expect(set.status).toBe(200)
    expect(set.json.archivedFolders).toEqual(AWAY)

    expect(await listed()).toEqual(AWAY)
  })

  test('are replaced by the map that arrives, which is how one is taken back', async () => {
    await put(AWAY)
    await put({ Archive: AWAY.Archive })

    expect(await listed()).toEqual({ Archive: AWAY.Archive })
  })

  test('go away altogether when an empty map is sent', async () => {
    await put(AWAY)
    await put({})

    expect(await listed()).toEqual({})
  })

  test('mark the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(AWAY)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what may be in it', () => {
  test('is a map, and never a list or a word', async () => {
    expect((await put(['Archive'])).status).toBe(400)
    expect((await put('Archive')).status).toBe(400)
    expect((await put(null)).status).toBe(400)
  })

  test('and says what is wrong with it', async () => {
    expect((await put('Archive')).json.error).toBe('archivedFolders must be a map')
  })

  test('and is refused when the body is not an object at all', async () => {
    const sent = await call(env, `/v1/spaces/${space}/archived-folders`, {
      method: 'PUT',
      token,
      raw: '[1, 2]',
    })

    expect(sent.status).toBe(400)
    expect(sent.json.error).toBe('send an object')
  })

  test('and leaves what was there as it was when it is refused', async () => {
    await put(AWAY)
    await put('nonsense')

    expect(await listed()).toEqual(AWAY)
  })
})

describe('more folders than a space puts away', () => {
  const many = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, at) => [`${at}`, AWAY.Archive]))

  test('is refused by the count, at the number the app holds itself to', async () => {
    expect((await put(many(400))).status).toBe(200)

    const past = await put(many(401))
    expect(past.status).toBe(400)
    expect(past.json.error).toBe('a space puts at most 400 folders away')
  })

  test('and by the size, when every entry is legal on its own', async () => {
    // Two hundred folders nested as deep as a path may go is more than the column
    // carries, which is the other end of the same guard; see spaces/columns.ts.
    const deep = Object.fromEntries(
      Array.from({ length: 200 }, (_, at) => [`${'folder/'.repeat(40)}${at}`, AWAY.Archive]),
    )

    const past = await put(deep)
    expect(past.status).toBe(413)
    expect(past.json.error).toBe('that is more archived folders than a space holds')
    expect(await listed()).toEqual({})
  })
})

describe('an entry that is not a folder of this space with a moment on it', () => {
  test('is dropped when the path is not inside the space', async () => {
    for (const path of ['/etc', '../secret', 'a/../../b', String.raw`C:\secret`, '', 'a\nb']) {
      const set = await put({ [path]: AWAY.Archive, Archive: AWAY.Archive })

      expect(set.status, path).toBe(200)
      expect(set.json.archivedFolders, path).toEqual({ Archive: AWAY.Archive })
    }
  })

  test('and when the path is longer than a path', async () => {
    const set = await put({ ['a'.repeat(301)]: AWAY.Archive, Archive: AWAY.Archive })

    expect(set.json.archivedFolders).toEqual({ Archive: AWAY.Archive })
  })

  test('and takes a path with dots in a name of its own', async () => {
    const set = await put({ 'Work/..hidden': AWAY.Archive })

    expect(set.json.archivedFolders).toEqual({ 'Work/..hidden': AWAY.Archive })
  })

  test('is dropped when the value is not a moment anybody could have written', async () => {
    for (const when of ['', '   ', 'a'.repeat(65), 7, true, null, { at: 1 }, ['2026-09-13']]) {
      const set = await put({ Bad: when, Archive: AWAY.Archive })

      const said = JSON.stringify(when)
      expect(set.status, said).toBe(200)
      expect(set.json.archivedFolders, said).toEqual({ Archive: AWAY.Archive })
    }
  })

  /** A word rather than a date, for the reason an icon is read as a shape: how a
   *  moment is written is the app's, and a service that parsed one would have to be
   *  deployed before the app could write it differently. */
  test('and takes a moment written some other way, so long as it is short', async () => {
    const set = await put({ Archive: '  13 September 2026  ' })

    expect(set.json.archivedFolders).toEqual({ Archive: '13 September 2026' })
  })

  test('leaves the rest of the tree away, the map being written whole', async () => {
    await put({ ...AWAY, '../elsewhere': AWAY.Archive, Travel: 7 })

    expect(await listed()).toEqual(AWAY)
  })
})

/** The column is written whole by clients, so a newer app may have left something in
 *  it this build has never heard of. Read, not trusted. */
describe('reading the column back', () => {
  test('keeps the folders and leaves the rest', async () => {
    column(JSON.stringify({ ...AWAY, '../elsewhere': AWAY.Archive, Travel: { at: 1 } }))

    expect(await listed()).toEqual(AWAY)
  })

  test('and answers with nothing at all for a column that is not a map', () => {
    expect(readArchivedFolders('not json')).toEqual({})
    expect(readArchivedFolders('["Archive"]')).toEqual({})
    expect(readArchivedFolders('null')).toEqual({})
    expect(readArchivedFolders('7')).toEqual({})
  })
})

describe('the map is the space’s', () => {
  test('so everybody in it reads the same folders', async () => {
    const theirs = await reader()
    await put(AWAY)

    expect(await listed(theirs)).toEqual(AWAY)
  })

  test('and putting a folder away is writing in the space, which a reader may not', async () => {
    const theirs = await reader()

    expect((await put(AWAY, { as: theirs })).status).toBe(403)
    expect(await listed()).toEqual({})
  })

  test('and is not another account’s to write', async () => {
    const other = await signIn(env, 'e@f.dev')

    // The same answer an id that does not exist gets: nothing about the space
    // leaks, not even that it is there.
    expect((await put(AWAY, { as: other })).status).toBe(404)
    expect(await listed()).toEqual({})
  })

  test('and needs a session at all', async () => {
    const sent = await call(env, `/v1/spaces/${space}/archived-folders`, { method: 'PUT' })

    expect(sent.status).toBe(401)
  })

  test('and answers 404 for a space that is not there', async () => {
    expect((await put(AWAY, { id: 'nope' })).status).toBe(404)
  })
})
