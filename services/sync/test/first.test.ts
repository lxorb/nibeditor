/** The space and the note a new account is given; see src/spaces/first.ts.
 *
 *  Everything here goes through the sign-in the app uses, because the point of
 *  the feature is that no client has to know about it: whatever signs in first
 *  finds the space already there. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, mail, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => env.close())

/** The one note in the one space, content and all. */
async function firstNote(token: string) {
  const spaces = await call(env, '/v1/spaces', { token })
  const id = spaces.json.spaces[0]?.id ?? ''

  const changes = await call(env, `/v1/spaces/${id}/changes?since=0`, { token })
  const note = changes.json.notes[0]
  if (!note) throw new Error('the account was given no note')

  const fetched = await call(env, `/v1/notes/${note.id}`, { token })
  return { note, content: fetched.json.content }
}

/** Signs in with a language, which is all the service ever learns about one. */
async function signInFrom(email: string, language: string): Promise<string> {
  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email } }))
  const code = /(\d{3}) (\d{3})/.exec(logged)
  if (!code) throw new Error(`no code was sent:\n${logged}`)

  const verified = await call(env, '/v1/auth/verify', {
    body: { email, code: `${code[1]}${code[2]}` },
    headers: { 'accept-language': language },
  })

  return verified.json.token
}

describe('a new account', () => {
  test('owns one space, named and marked so the rail can draw it', async () => {
    const token = await signIn(env, 'a@b.dev')

    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces.map((one) => [one.name, one.icon, one.role])).toEqual([
      ['Notes', 'NotebookPen', 'owner'],
    ])
  })

  test('holds one note in it, at the path the browser build also seeds', async () => {
    const token = await signIn(env, 'a@b.dev')

    const { note, content } = await firstNote(token)
    expect(note.path).toBe('Read me.md')
    expect(note.version).toBe(1)
    expect(content).toContain('# Welcome to nibeditor')
  })

  /** The clipper and the connector both used to have to say "make a space
   *  first", because an account could exist with nowhere to write. */
  test('is somewhere the connector can write without being told to make a space', async () => {
    const token = await signIn(env, 'a@b.dev')
    const key = await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })

    const said = await call<{ result: { content: { text: string }[] } }>(env, '/mcp', {
      token: key.json.token,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'write_note',
          arguments: { space: 'Notes', path: 'clip.md', content: 'x' },
        },
      },
    })

    expect(said.json.result.content[0]?.text).toBe('Saved clip.md.')
  })

  test('counts the note it was given against its storage', async () => {
    const token = await signIn(env, 'a@b.dev')

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBeGreaterThan(0)
  })
})

describe('the space a new account is given', () => {
  test('is made once, however often the same address signs in', async () => {
    const token = await signIn(env, 'a@b.dev')
    await signIn(env, 'a@b.dev')
    await signIn(env, 'a@b.dev')

    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces).toHaveLength(1)

    const changes = await call(env, `/v1/spaces/${json.spaces[0]?.id ?? ''}/changes?since=0`, {
      token,
    })
    expect(changes.json.notes).toHaveLength(1)
  })

  /** Two verifies for one code is what a retried request looks like, and it is
   *  the way two of them could once have raced each other into two spaces. */
  test('is made once when a second verify arrives for the same address', async () => {
    const logged = await mail(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))
    const code = /(\d{3}) (\d{3})/.exec(logged)
    const sent = { email: 'a@b.dev', code: `${code?.[1]}${code?.[2]}` }

    const first = await call(env, '/v1/auth/verify', { body: sent })
    await call(env, '/v1/auth/verify', { body: sent })

    const { json } = await call(env, '/v1/spaces', { token: first.json.token })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('is not a second one for an account that already has a space', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/spaces', { token, body: { name: 'Work' } })

    const again = await signIn(env, 'a@b.dev')
    const { json } = await call(env, '/v1/spaces', { token: again })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', 'Work'])
  })

  /** Only an account being made is given one. An empty rail is a state somebody
   *  can mean - they deleted every space - and it is the state every account
   *  made before this feature existed signs in with, so a space appearing on a
   *  later sign-in would be the app deciding something for them. */
  test('does not come back for an account that has emptied its rail', async () => {
    const token = await signIn(env, 'a@b.dev')
    const { json } = await call(env, '/v1/spaces', { token })
    await call(env, `/v1/spaces/${json.spaces[0]?.id ?? ''}`, { method: 'DELETE', token })

    const again = await signIn(env, 'a@b.dev')
    expect((await call(env, '/v1/spaces', { token: again })).json.spaces).toEqual([])
  })

  /** An account is worth more than the note it opens with, so a store that
   *  refuses does not cost somebody their sign-in; see src/auth.ts. */
  test('is not worth a sign-in when the store will not take the note', async () => {
    env = testEnv({
      NOTES: {
        put: () => Promise.reject(new Error('no')),
        get: () => Promise.resolve(null),
        delete: () => Promise.resolve(),
      } as unknown as R2Bucket,
    })

    const token = await signIn(env, 'a@b.dev')
    expect(token).toBeTruthy()
    expect((await call(env, '/v1/me', { token })).json.user.email).toBe('a@b.dev')
  })
})

describe('the note a new account is given', () => {
  test('is in the language the sign-in asked in', async () => {
    const english = await firstNote(await signInFrom('en@b.dev', 'en-GB,en;q=0.9'))
    const german = await firstNote(await signInFrom('de@b.dev', 'de-DE,de;q=0.9,en;q=0.8'))
    const swiss = await firstNote(await signInFrom('gsw@b.dev', 'gsw,de;q=0.9'))
    const french = await firstNote(await signInFrom('fr@b.dev', 'fr-CH,fr;q=0.9'))
    const japanese = await firstNote(await signInFrom('ja@b.dev', 'ja,en;q=0.5'))

    expect(german.content).toContain('# Willkommen bei nibeditor')
    expect(swiss.content).toContain('# Willkomme bi nibeditor')
    expect(french.content).toContain('# Bienvenue dans nibeditor')
    expect(japanese.content).toContain('へようこそ')

    const said = [english, german, swiss, french, japanese].map((one) => one.content)
    expect(new Set(said).size).toBe(said.length)
  })

  /** The path is an identity: the browser build seeds `/Notes/Read me.md`
   *  before anybody signs in, and a translated one would pair with nothing. */
  test('keeps its path and its space name in English whatever the language', async () => {
    const token = await signInFrom('de@b.dev', 'de-CH,de;q=0.9')

    const spaces = await call(env, '/v1/spaces', { token })
    expect(spaces.json.spaces[0]?.name).toBe('Notes')
    expect((await firstNote(token)).note.path).toBe('Read me.md')
  })

  test('is English for a language the app has no words for', async () => {
    const unknown = await firstNote(await signInFrom('is@b.dev', 'is-IS,is;q=0.9'))
    const none = await firstNote(await signInFrom('bare@b.dev', ''))

    expect(unknown.content).toContain('# Welcome to nibeditor')
    expect(unknown.content).toBe(none.content)
  })

  test('shows what markdown does here, which is what it is for', async () => {
    const { content } = await firstNote(await signIn(env, 'a@b.dev'))

    expect(content).toContain('**Bold**')
    expect(content).toContain('*italic*')
    expect(content).toContain('==highlight==')
    expect(content).toContain('$E = mc^2$')
    expect(content).toContain('```js')
    expect(content).toContain('| What | Where |')
  })

  test('comes down through the ordinary routes, like any other note', async () => {
    const token = await signIn(env, 'a@b.dev')
    const { note, content } = await firstNote(token)

    // The changes feed carries it at the space's first cursor, and the note
    // route hands back exactly the bytes that were counted.
    expect(note.seq).toBe(1)
    expect(note.deleted).toBe(false)
    expect(note.size).toBe(new TextEncoder().encode(content).length)
  })
})
