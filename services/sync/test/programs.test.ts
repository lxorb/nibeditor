import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { call, signIn, type TestEnv, testEnv } from './harness'
import { programMayReach } from '../src/programs'

interface ProgramView {
  token?: string
  spaces?: { id: string; name: string }[]
  notes?: { id: string; path: string; version: number }[]
  note?: { id: string; version: number }
  content?: string
  cursor?: number
  error?: string
  space?: { id: string }
}

describe('what a program may reach', () => {
  test('is the sync surface and nothing else', () => {
    expect(programMayReach('GET', '/v1/spaces', false)).toBe(true)
    expect(programMayReach('GET', '/v1/spaces/abc/changes', false)).toBe(true)
    expect(programMayReach('GET', '/v1/notes/abc', false)).toBe(true)
    expect(programMayReach('PUT', '/v1/notes/abc', false)).toBe(true)
    expect(programMayReach('POST', '/v1/spaces/abc/notes', false)).toBe(true)
    expect(programMayReach('GET', '/v1/notes/abc/versions', false)).toBe(true)
  })

  test('and not the account, the sharing, the trash or a delete', () => {
    expect(programMayReach('GET', '/v1/me', false)).toBe(false)
    expect(programMayReach('PATCH', '/v1/settings', false)).toBe(false)
    expect(programMayReach('GET', '/v1/trash', false)).toBe(false)
    expect(programMayReach('POST', '/v1/spaces', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/notes/abc', false)).toBe(false)
    expect(programMayReach('PUT', '/v1/spaces/abc/blog', false)).toBe(false)
  })

  test('and nothing about the second factor or the sessions', () => {
    // A token in a CI secret that could see the sessions could end them, and one
    // that could reach the factor could take it off: both are the account
    // defending itself against a stolen credential, which is what this is.
    for (const path of ['/v1/second', '/v1/second/confirm', '/v1/second/recovery']) {
      expect(programMayReach('GET', path, false)).toBe(false)
      expect(programMayReach('POST', path, false)).toBe(false)
      expect(programMayReach('DELETE', path, false)).toBe(false)
    }

    expect(programMayReach('GET', '/v1/sessions', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/sessions', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/sessions/abc', false)).toBe(false)
  })

  /** A rollback is an edit rather than a removal: every note it changes keeps what
   *  it said as a version, so a bad argument is another rollback away from being
   *  undone. Which is the difference between it and the delete above, and why a
   *  headless job may reach it. */
  test('and a rollback, which writes versions rather than taking anything away', () => {
    expect(programMayReach('POST', '/v1/spaces/abc/rollback', false)).toBe(true)
    // A token that may only read reaches nothing that writes, this included.
    expect(programMayReach('POST', '/v1/spaces/abc/rollback', true)).toBe(false)
    // And nothing that only looks like it.
    expect(programMayReach('POST', '/v1/spaces/abc/rollback/all', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/rollback', false)).toBe(false)
  })

  test('and no path that only looks like one on the list', () => {
    expect(programMayReach('GET', '/v1/notes/abc/', false)).toBe(false)
    expect(programMayReach('GET', '/v1/notes/abc/versions/1/more', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/changes/x', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/notes', false)).toBe(false)
  })

  test('and a token that may only read reaches nothing that writes', () => {
    expect(programMayReach('GET', '/v1/notes/abc', true)).toBe(true)
    expect(programMayReach('PUT', '/v1/notes/abc', true)).toBe(false)
    expect(programMayReach('POST', '/v1/spaces/abc/notes', true)).toBe(false)
  })
})

describe('a token acting for somebody', () => {
  let env: TestEnv
  let token: string
  let program: string
  let space: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    // Read-only unless writing is asked for in as many words; see mcp/tokens.ts.
    const minted = await call<ProgramView>(env, '/v1/mcp/token', {
      token,
      body: { readOnly: false },
    })
    program = minted.json.token ?? ''

    const made = await call<ProgramView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const wrote = await call<ProgramView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# One' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('lists the spaces it may write in', async () => {
    const listed = await call<ProgramView>(env, '/v1/spaces', { token: program })

    expect(listed.status).toBe(200)
    expect(listed.json.spaces?.some((one) => one.name === 'Work')).toBe(true)
  })

  test('reads the change feed and a note out of it', async () => {
    const changes = await call<ProgramView>(env, `/v1/spaces/${space}/changes?since=0`, {
      token: program,
    })

    expect(changes.status).toBe(200)
    const listed = changes.json.notes?.find((one) => one.path === 'plan.md')
    expect(listed).toBeDefined()

    const said = await call<ProgramView>(env, `/v1/notes/${listed?.id ?? ''}`, { token: program })
    expect(said.json.content).toBe('# One')
  })

  test('writes a note back', async () => {
    const put = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: program,
      body: { content: '# Two', baseVersion: 1 },
    })

    expect(put.status).toBe(200)

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(said.json.content).toBe('# Two')
  })

  /** The rescue a headless job needs: a build that wrote a thousand notes wrong is
   *  not something to undo by hand in a settings pane. `dry` first, because that is
   *  the shape the pane uses and the shape a job should use. */
  test('and puts a space back to how it read at a moment', async () => {
    const before = Date.now()

    // Something to put back, written the way the job that went wrong would have.
    await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: program,
      body: { content: '# Wrong', baseVersion: 1 },
    })

    const dry = await call<{ notes: number; paths: string[] }>(
      env,
      `/v1/spaces/${space}/rollback`,
      { token: program, body: { at: before, dry: true } },
    )

    expect(dry.status).toBe(200)
    expect(dry.json.notes).toBe(1)
    expect(dry.json.paths).toEqual(['plan.md'])

    const put = await call<{ notes: number; partial: boolean }>(
      env,
      `/v1/spaces/${space}/rollback`,
      { token: program, body: { at: before } },
    )

    expect(put.status).toBe(200)
    expect(put.json.notes).toBe(1)

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(said.json.content).toBe('# One')
  })

  test('and a read-only token cannot, because a rollback writes', async () => {
    const minted = await call<ProgramView>(env, '/v1/mcp/token', { token, body: {} })
    const refused = await call<ProgramView>(env, `/v1/spaces/${space}/rollback`, {
      token: minted.json.token ?? '',
      body: { at: Date.now(), dry: true },
    })

    expect(refused.status).toBe(403)
  })

  test('and is refused everything else, in as many words', async () => {
    const me = await call<ProgramView>(env, '/v1/me', { token: program })
    expect(me.status).toBe(403)
    expect(me.json.error).toBe('that is not something a token can do')

    const gone = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'DELETE',
      token: program,
    })
    expect(gone.status).toBe(403)

    const still = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(still.status).toBe(200)
  })

  test('a read-only token reads and does not write', async () => {
    // Nothing said, so read-only, which is the mint's own default.
    const minted = await call<ProgramView>(env, '/v1/mcp/token', { token, body: {} })
    const reader = minted.json.token ?? ''

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token: reader })
    expect(said.status).toBe(200)

    const put = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: '# Three', baseVersion: 1 },
    })
    expect(put.status).toBe(403)
  })

  test('and a token nobody minted is nobody', async () => {
    const said = await call<ProgramView>(env, '/v1/spaces', { token: 'nib_nonsense' })

    expect(said.status).toBe(401)
    expect(said.json.error).toBe('sign in first')
  })
})
