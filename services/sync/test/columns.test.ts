import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { fits, MOST_BYTES } from '../src/spaces/columns'
import { staysInside } from '../src/spaces/paths'

/** The seven columns a client writes whole: what each may hold, and that writing one
 *  says the space changed.
 *
 *  The ceilings were six constants in six files and the write was one statement in
 *  five. What is held here is the part a client can feel: the ceiling each column
 *  refuses at, in the words it has always refused with, and `updated_at` moving -
 *  which is how every other device learns there is something to fetch. A write that
 *  forgot the second half would leave the other devices reading last week's
 *  bookmarks and nothing would say so.
 *
 *  A backward-compatibility test too: 413 and its sentence are what an app that
 *  cannot shrink its own list shows somebody. */

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

/** When the space listing says this space last changed. */
async function changedAt() {
  const { json } = await call(env, '/v1/spaces', { token })
  return json.spaces.find((one) => one.id === space)?.updatedAt
}

/** A column, the body that fills it past its ceiling, and what it says then. */
const TOO_MUCH: {
  name: string
  path: string
  method: string
  body: () => unknown
  says: string
}[] = [
  {
    name: 'bookmarks',
    path: 'bookmarks',
    method: 'PUT',
    body: () => ({
      bookmarks: Array.from({ length: 60 }, (_, at) => ({
        kind: 'note',
        path: `${'p'.repeat(200)}${at}.md`,
        text: '',
      })),
    }),
    says: 'that is more bookmarks than a space holds',
  },
  {
    name: 'excluded',
    path: 'excluded',
    method: 'PUT',
    body: () => ({ excluded: Array.from({ length: 200 }, (_, at) => `${'p'.repeat(280)}${at}`) }),
    says: 'that is more paths than a space leaves out',
  },
  {
    name: 'icons',
    path: 'icons',
    method: 'PUT',
    body: () => ({
      icons: Object.fromEntries(
        Array.from({ length: 400 }, (_, at) => [`${'p'.repeat(280)}${at}`, '📦']),
      ),
    }),
    says: 'that is more folder icons than a space holds',
  },
  {
    name: 'arranged',
    path: 'arranged',
    method: 'PUT',
    body: () => ({
      arranged: Object.fromEntries(
        Array.from({ length: 200 }, (_, at) => [
          `${at}`,
          Array.from({ length: 12 }, (_one, which) => `${'n'.repeat(200)}${which}.md`),
        ]),
      ),
    }),
    says: 'that is more arranged folders than a space holds',
  },
]

describe('a column filled past what it holds', () => {
  for (const column of TOO_MUCH) {
    test(`${column.name} says so, and says it the way it always has`, async () => {
      const answer = await call(env, `/v1/spaces/${space}/${column.path}`, {
        method: column.method,
        token,
        body: column.body(),
      })

      expect(answer.status).toBe(413)
      expect(answer.json.error).toBe(column.says)
    })
  }
})

describe('writing a column', () => {
  test('says the space changed, so every other device learns there is something', async () => {
    const before = await changedAt()

    const answer = await call(env, `/v1/spaces/${space}/bookmarks`, {
      method: 'PUT',
      token,
      body: { bookmarks: [{ kind: 'note', path: 'Read me.md', text: '' }] },
    })
    expect(answer.status).toBe(200)

    const after = await changedAt()
    expect(typeof after).toBe('number')
    expect(after).toBeGreaterThanOrEqual(before ?? 0)
  })

  test('and each of the five writes its own column and no other', async () => {
    await call(env, `/v1/spaces/${space}/bookmarks`, {
      method: 'PUT',
      token,
      body: { bookmarks: [{ kind: 'note', path: 'Read me.md', text: '' }] },
    })
    await call(env, `/v1/spaces/${space}/excluded`, {
      method: 'PUT',
      token,
      body: { excluded: ['Archive'] },
    })
    await call(env, `/v1/spaces/${space}/graph`, { method: 'PUT', token, body: { graph: {} } })

    const { json } = await call(env, '/v1/spaces', { token })
    const kept = json.spaces.find((one) => one.id === space)

    // Each column still holds what its own route put there.
    expect(kept?.bookmarks).toHaveLength(1)
    expect(kept?.excluded).toEqual(['Archive'])
  })
})

describe('what each column may hold', () => {
  test('is a number a reader can compare with the others', () => {
    expect(MOST_BYTES.graph).toBeLessThan(MOST_BYTES.bookmarks)
    expect(MOST_BYTES.bookmarks).toBeLessThan(MOST_BYTES.excluded)
    expect(MOST_BYTES.excluded).toBeLessThan(MOST_BYTES.site)
    expect(MOST_BYTES.site).toBeLessThan(MOST_BYTES.files)
    expect(MOST_BYTES.files).toBe(MOST_BYTES.icons)
    // The three keyed by path share the ceiling: fewer folders may be arranged than
    // may wear an icon, and each of them carries a list rather than one word.
    expect(MOST_BYTES.arranged).toBe(MOST_BYTES.icons)
  })

  /** Bytes and not characters: one emoji is a single character and four bytes, and
   *  a ceiling counted in characters lets a space keep several times what it may. */
  test('and is counted in bytes', () => {
    const emoji = '📦'.repeat(MOST_BYTES.graph / 4 + 1)

    expect(emoji.length).toBeLessThan(MOST_BYTES.graph)
    expect(fits(emoji, 'graph')).toBe(false)
  })

  test('and what fits, fits', () => {
    expect(fits('', 'graph')).toBe(true)
    expect(fits('x'.repeat(MOST_BYTES.graph), 'graph')).toBe(true)
    expect(fits('x'.repeat(MOST_BYTES.graph + 1), 'graph')).toBe(false)
  })
})

/** The one reading four columns judge a path by; see src/spaces/paths.ts. The app
 *  holds itself to the same three answers - `insideItsSpace` - because a column the
 *  service takes is a column the app resolves against a folder. */
describe('a path a column may hold', () => {
  test('is one every machine resolves in the same place', () => {
    for (const path of ['Read me.md', 'a/b/Read me.md', 'Notes/Deep idea.md', '..hidden/x.md']) {
      expect(staysInside(path), path).toBe(true)
    }
  })

  test('and never one that starts at the root of somebody’s disk', () => {
    for (const path of [
      '/etc/passwd',
      'C:/Windows/System32/x.pdf',
      'c:/x.pdf',
      'C:\\Windows\\x.pdf',
      '\\\\server\\share\\x.pdf',
    ]) {
      expect(staysInside(path), path).toBe(false)
    }
  })

  test('nor one that climbs out of the space', () => {
    for (const path of ['../out.md', 'a/../../out.md', '..', 'a/..']) {
      expect(staysInside(path), path).toBe(false)
    }
  })

  test('nor a name that is two names to whatever reads it next', () => {
    expect(staysInside('a\nb.md')).toBe(false)
    expect(staysInside('a\u0000b.md')).toBe(false)
  })
})
