/** Moving an account to sync v2 and back through the admin's route: refused while a
 *  device could still run an older app, never refused on the way back. See
 *  src/sync2/admin.ts. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { atLeastVersion } from '../src/sync2/gate'
import { call, signIn, type TestEnv, testEnv } from './harness'

interface Blocker {
  kind: string
  id: string
  why: string
}

interface Flip {
  error?: string
  version: number
  changed?: boolean
  blockers: Blocker[]
  devices: { id: string; live: boolean }[]
  sessions: { id: string; allowed: boolean }[]
}

const ADMIN = 'emil@example.com'
const MOVER = 'mover@example.com'

let env: TestEnv
let admin: string
let mover: string

beforeEach(async () => {
  env = testEnv()
  admin = await signIn(env, ADMIN)
  mover = await signIn(env, MOVER)
  env.db.prepare("update online_service set value = ? where key = 'admin'").run(idOf(ADMIN))
})

afterEach(() => env.close())

function idOf(email: string): string {
  return (env.db.prepare('select id from users where email = ?').get(email) as { id: string }).id
}

/** Every live session of an account, newest last. */
function sessionsOf(email: string): string[] {
  return (
    env.db
      .prepare('select id from sessions where user_id = ? order by created_at, rowid')
      .all(idOf(email)) as { id: string }[]
  ).map((one) => one.id)
}

/** A device that said hello with this app on this session. */
function device(id: string, email: string, session: string | null, app: string) {
  env.db
    .prepare(
      `insert into devices (id, user_id, session_id, name, platform, app, created_at, last_seen_at)
       values (?, ?, ?, ?, 'windows', ?, 1, 1)`,
    )
    .run(id, idOf(email), session, id, app)
}

function flip(body: object, token = admin) {
  return call<Flip>(env, '/v2/admin/sync-version', { token, body })
}

function versionOf(email: string): number {
  return (
    env.db.prepare('select sync_version from users where email = ?').get(email) as {
      sync_version: number
    }
  ).sync_version
}

describe('the version order', () => {
  test('a build of main sits below its release and above the one before', () => {
    expect(atLeastVersion('0.13.1-57', '0.13.0')).toBe(true)
    expect(atLeastVersion('0.13.1-57', '0.13.1')).toBe(false)
    expect(atLeastVersion('0.13.1', '0.13.1-57')).toBe(true)
    expect(atLeastVersion('0.13.1-60', '0.13.1-57')).toBe(true)
    expect(atLeastVersion('0.13.1-9', '0.13.1-57')).toBe(false)
    expect(atLeastVersion('0.14.0', '0.13.9')).toBe(true)
    expect(atLeastVersion('0.9.10', '0.12.0')).toBe(false)
    expect(atLeastVersion('99.0.0', '0.14.0')).toBe(true)
  })

  test('a version nobody can read is never enough', () => {
    expect(atLeastVersion('under test', '0.12.0')).toBe(false)
    expect(atLeastVersion('', '0.12.0')).toBe(false)
    expect(atLeastVersion(null, '0.12.0')).toBe(false)
  })
})

describe('the door', () => {
  test('is a 404 for anybody but the admin', async () => {
    expect((await flip({ email: MOVER, to: 2, min: '0.14.0' }, mover)).status).toBe(404)
    expect(
      (await call(env, `/v2/admin/sync-version?email=${MOVER}`, { token: mover })).status,
    ).toBe(404)
    expect(versionOf(MOVER)).toBe(1)
  })

  test('is closed to a program token, even the admin’s own', async () => {
    const minted = await call<{ token: string }>(env, '/v1/mcp/token', {
      token: admin,
      body: { readOnly: false },
    })
    const program = minted.json.token

    expect((await flip({ email: MOVER, to: 2, min: '0.14.0' }, program)).status).toBe(403)
    expect(versionOf(MOVER)).toBe(1)
  })

  test('says which account it does not know', async () => {
    const answer = await flip({ email: 'nobody@example.com', to: 2, min: '0.14.0' })
    expect(answer.status).toBe(404)
  })

  test('forward needs a min, and one no older than the first v2 app', async () => {
    expect((await flip({ email: MOVER, to: 2 })).status).toBe(400)
    expect((await flip({ email: MOVER, to: 2, min: '0.11.0' })).status).toBe(400)
    expect((await flip({ email: MOVER, to: 2, min: 'latest' })).status).toBe(400)
    expect((await flip({ email: MOVER, to: 3, min: '0.14.0' })).status).toBe(400)
    expect(versionOf(MOVER)).toBe(1)
  })
})

describe('forward', () => {
  test('is refused while a live device runs an older app, naming it', async () => {
    const [session] = sessionsOf(MOVER)
    device('laptop', MOVER, session ?? null, '0.13.0')

    const answer = await flip({ email: MOVER, to: 2, min: '0.14.0' })

    expect(answer.status).toBe(409)
    expect(answer.json.blockers).toEqual([
      { kind: 'device', id: 'laptop', name: 'laptop', app: '0.13.0', why: 'older' },
    ])
    expect(versionOf(MOVER)).toBe(1)
  })

  test('is refused by a live session no device stands behind, until it is allowed', async () => {
    const [session] = sessionsOf(MOVER)

    const refused = await flip({ email: MOVER, to: 2, min: '0.14.0' })
    expect(refused.status).toBe(409)
    expect(refused.json.blockers).toEqual([
      expect.objectContaining({ kind: 'session', id: session, why: 'no device' }),
    ])

    const allowed = await flip({ email: MOVER, to: 2, min: '0.14.0', allow: [session] })
    expect(allowed.status).toBe(200)
    expect(allowed.json.changed).toBe(true)
    expect(versionOf(MOVER)).toBe(2)
  })

  test('goes through once every live device is new enough, and /v1/me says so', async () => {
    const [session] = sessionsOf(MOVER)
    device('laptop', MOVER, session ?? null, '0.14.0')
    // Ended, and one whose session ran out: neither can sync, so neither holds it back.
    device('old', MOVER, null, '0.9.0')
    env.db.prepare("update devices set revoked_at = 5 where id = 'old'").run()
    device('drawer', MOVER, 'gone-session', '0.10.0')

    const answer = await flip({ email: MOVER, to: 2, min: '0.14.0' })

    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ version: 2, changed: true, blockers: [] })
    expect(answer.json.devices).toEqual([
      expect.objectContaining({ id: 'laptop', live: true }),
      expect.objectContaining({ id: 'drawer', live: false }),
    ])
    const me = await call<{ user: { syncVersion: number } }>(env, '/v1/me', { token: mover })
    expect(me.json.user.syncVersion).toBe(2)
  })

  test('an unreadable app version holds it back', async () => {
    const [session] = sessionsOf(MOVER)
    device('odd', MOVER, session ?? null, 'under test')

    const answer = await flip({ email: MOVER, to: 2, min: '0.14.0' })

    expect(answer.status).toBe(409)
    expect(answer.json.blockers[0]).toMatchObject({ id: 'odd', why: 'unreadable' })
  })

  test('the asking session never holds back the account it belongs to', async () => {
    const answer = await flip({ email: ADMIN, to: 2, min: '0.14.0' })

    expect(answer.status).toBe(200)
    expect(answer.json.sessions).toEqual([])
    expect(versionOf(ADMIN)).toBe(2)
  })

  test('a dry run writes nothing, and a flip to where it is changes nothing', async () => {
    const [session] = sessionsOf(MOVER)
    device('laptop', MOVER, session ?? null, '0.14.0')

    const dry = await flip({ email: MOVER, to: 2, min: '0.14.0', dry: true })
    expect(dry.json).toMatchObject({ changed: false, version: 1 })
    expect(versionOf(MOVER)).toBe(1)

    await flip({ email: MOVER, to: 2, min: '0.14.0' })
    const again = await flip({ email: MOVER, to: 2, min: '0.14.0' })
    expect(again.json).toMatchObject({ changed: false, version: 2 })
  })
})

describe('back', () => {
  test('is never refused, and names the devices too old to roll back cleanly', async () => {
    const [session] = sessionsOf(MOVER)
    env.db.prepare('update users set sync_version = 2 where email = ?').run(MOVER)
    device('laptop', MOVER, session ?? null, '0.12.0')

    const answer = await flip({ email: MOVER, to: 1, min: '0.14.0' })

    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ version: 1, changed: true })
    expect(answer.json.blockers).toEqual([expect.objectContaining({ id: 'laptop', why: 'older' })])
    expect(versionOf(MOVER)).toBe(1)
  })
})

describe('reading', () => {
  test('the status says the version, the devices and what holds a flip back', async () => {
    const [session] = sessionsOf(MOVER)
    device('phone', MOVER, session ?? null, '0.13.1-57')

    const answer = await call<Flip & { min: string }>(
      env,
      `/v2/admin/sync-version?email=${MOVER}&min=0.13.1-60`,
      { token: admin },
    )

    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ version: 1, min: '0.13.1-60' })
    expect(answer.json.blockers).toEqual([expect.objectContaining({ id: 'phone', why: 'older' })])
    expect(versionOf(MOVER)).toBe(1)
  })
})
