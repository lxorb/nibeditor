/** No statement binds more parameters than D1 will take.
 *
 *  D1 refuses a query with more than a hundred bound parameters, and the SQLite
 *  the other tests run against takes tens of thousands. So every query whose
 *  parameter count grows with what an account holds is a query the tests run and
 *  the service would not: a rail of a hundred spaces, a space of a hundred PDFs,
 *  a purge of a space of five hundred notes. Each of those really was a 500 in
 *  production and a pass here.
 *
 *  Written as one file because it is one rule, and the rule is about every route
 *  rather than about any of them. `widest` on the environment is what enforces it;
 *  see test/harness.ts.
 */

import { afterEach, beforeEach, expect, test } from 'vitest'
import { purgeExpired } from '../src/trash'
import { MOST_BOUND } from '../src/bound'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let user: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  user = (env.db.prepare('select id from users limit 1').get() as { id: string }).id
})

afterEach(() => env.close())

/** Says which statement went over, so a failure names the query rather than only
 *  the number. */
function withinTheLimit() {
  const { count, sql } = env.widest()
  expect(count, sql.replace(/\s+/g, ' ').trim()).toBeLessThanOrEqual(MOST_BOUND)
}

/** A rail of `many` spaces, written straight in: what is measured is the width of
 *  the statements the routes make, not the route that makes a space. */
function fillRail(many: number): string[] {
  const ids: string[] = []
  for (let at = 0; at < many; at++) {
    const id = `space-${at}`
    ids.push(id)
    env.db
      .prepare(
        `insert into spaces (id, user_id, name, position, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, user, `Space ${at}`, at, Date.now(), Date.now())
  }
  return ids
}

test('listing a rail of many spaces', async () => {
  fillRail(150)

  const listed = await call(env, '/v1/spaces', { token })
  expect(listed.status).toBe(200)
  expect(listed.json.spaces.length).toBeGreaterThan(100)
  withinTheLimit()
})

test('listing a rail whose spaces are shared', async () => {
  const ids = fillRail(150)
  for (const id of ids) {
    env.db
      .prepare('insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)')
      .run(id, 'other@b.dev', 'read', 1)
  }

  const listed = await call(env, '/v1/spaces', { token })
  expect(listed.status).toBe(200)
  // The one the account was given holds nobody; every one written above does.
  expect(listed.json.spaces.filter((one) => one.shared)).toHaveLength(ids.length)
  withinTheLimit()
})

test('putting a rail of many spaces in order', async () => {
  const ids = fillRail(150)

  const ordered = await call(env, '/v1/spaces/order', {
    method: 'PUT',
    token,
    body: { order: [...ids].reverse() },
  })

  expect(ordered.status).toBe(200)
  withinTheLimit()

  // And the whole order really was applied, whatever it took to apply it: not
  // only the first chunk of it. The space the account was given was not in the
  // list, so it keeps its place at the end.
  const listed = await call(env, '/v1/spaces', { token })
  const rail = listed.json.spaces.map((one) => one.id)
  expect(rail.slice(0, ids.length)).toEqual([...ids].reverse())
  expect(rail).toHaveLength(ids.length + 1)
})

test('recording the many PDFs a space keeps', async () => {
  const space = (await call(env, '/v1/spaces', { token, body: { name: 'Papers' } })).json.space.id

  const files = Array.from({ length: 150 }, (_, at) => ({
    path: `papers/${at}.pdf`,
    hash: at.toString(16).padStart(64, '0'),
  }))
  for (const file of files) {
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(file.hash, user, 1, 'application/pdf', 1)
  }

  const recorded = await call(env, `/v1/spaces/${space}/files`, {
    method: 'PUT',
    token,
    body: { files },
  })

  expect(recorded.status).toBe(200)
  expect(recorded.json.files).toHaveLength(150)
  expect(recorded.json.missing).toEqual([])
  withinTheLimit()
})

test('purging a space of many notes', async () => {
  const space = (await call(env, '/v1/spaces', { token, body: { name: 'Big' } })).json.space.id

  for (let at = 0; at < 600; at++) {
    const id = `note-${at}`
    env.db
      .prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
         values (?, ?, ?, ?, 1, ?, 0, 1, 'h')`,
      )
      .run(id, space, `${at}.md`, at + 100, Date.now())
    await env.NOTES.put(`spaces/${space}/${id}`, 'x')
  }

  await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })
  await call(env, `/v1/trash/spaces/${space}`, { method: 'DELETE', token })
  withinTheLimit()

  // And the nightly job walks the same path.
  env.db.prepare('update spaces set deleted_at = 1 where id = ?').run(space)
  await purgeExpired(env, Date.now())
  withinTheLimit()
})

test('deleting an account of many spaces, notes and pictures', async () => {
  const spaces = fillRail(150)

  for (let at = 0; at < 600; at++) {
    const id = `note-${at}`
    const space = spaces[at % spaces.length] ?? ''
    env.db
      .prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
         values (?, ?, ?, ?, 1, ?, 0, 1, 'h')`,
      )
      .run(id, space, `${at}.md`, at + 100, Date.now())
    await env.NOTES.put(`spaces/${space}/${id}`, 'x')
    env.db
      .prepare(
        `insert into blobs (hash, user_id, size, type, created_at) values (?, ?, 1, 'image/png', 1)`,
      )
      .run(at.toString(16).padStart(64, '0'), user)
  }

  const { mail } = await import('./harness')
  const sent = await mail(() => call(env, '/v1/account/delete/code', { token, body: {} }))
  const code = /(\d{3}) (\d{3})/.exec(sent)
  const verified = await call<{ ticket: string }>(env, '/v1/account/delete/verify', {
    token,
    body: { code: `${code?.[1] ?? ''}${code?.[2] ?? ''}` },
  })
  const gone = await call(env, '/v1/account', {
    method: 'DELETE',
    token,
    body: { ticket: verified.json.ticket },
  })

  expect(gone.status).toBe(200)
  withinTheLimit()
  // More than one sweep's worth, so what is left waits for the nightly job.
  expect(env.db.prepare('select count(*) as many from leftovers').get()).not.toEqual({ many: 0 })
})
