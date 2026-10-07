/** Sync v2 for everybody: the service's switch, the accounts it starts on v2, the ones
 *  it moves by itself when a device says hello, and the way back for all. See
 *  src/sync2/rollout.ts and src/sync2/gate.ts. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { connect, type HubSocket, type Hubs, hubs, send } from './hub-fakes'

interface Rollout {
  error?: string
  mode: string
  min: string | null
  accounts: { v1: number; v2: number }
  moves: { email: string; from: number; to: number; why: string; min: string | null }[]
  moved?: number
}

const ADMIN = 'emil@example.com'
const MOVER = 'mover@example.com'
const MIN = '0.13.1-573'

let env: TestEnv
let running: Hubs
let admin: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 8, 12))
  env = testEnv()
  running = hubs(env)
  env.HUB = running.HUB
  admin = await signedIn(ADMIN)
  env.db.prepare("update online_service set value = ? where key = 'admin'").run(idOf(ADMIN))
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

/** A sign-in, with the clock moved past the gap a second code to one address waits. */
async function signedIn(email: string): Promise<string> {
  const token = await signIn(env, email)
  vi.setSystemTime(Date.now() + 31_000)
  return token
}

function idOf(email: string): string {
  return (env.db.prepare('select id from users where email = ?').get(email) as { id: string }).id
}

function versionOf(email: string): number {
  return (
    env.db.prepare('select sync_version from users where email = ?').get(email) as {
      sync_version: number
    }
  ).sync_version
}

interface Device {
  id: string
  user: string
  socket: HubSocket
}

/** A device of the account: its own sign-in, and a hub socket that said hello with
 *  this app. */
async function device(email: string, name: string, app: string): Promise<Device> {
  const token = await signedIn(email)
  const user = idOf(email)
  const { id: session } = env.db
    .prepare('select id from sessions where token_hash = ?')
    .get(await sha256(token)) as { id: string }
  const id = `device-${name}`
  const socket = connect(running.of(user).hub, { device: id, who: user, session })
  const one = { id, user, socket }
  await hello(one, app)
  return one
}

/** The device saying hello again, as it does after an update or a reconnect. */
async function hello(one: Device, app: string): Promise<void> {
  await send(running.of(one.user).hub, one.socket, {
    t: 'hello',
    device: one.id,
    name: one.id,
    platform: 'windows',
    app,
  })
}

function rollout(body: object, token = admin) {
  return call<Rollout>(env, '/v2/admin/sync-rollout', { token, body })
}

async function syncVersionSaid(token: string): Promise<number | undefined> {
  const me = await call<{ user?: { syncVersion?: number } }>(env, '/v1/me', { token })
  return me.json.user?.syncVersion
}

describe('the switch', () => {
  test('is off until somebody sets it, and moves nobody', async () => {
    const said = await call<Rollout>(env, '/v2/admin/sync-rollout', { token: admin })
    expect(said.json).toMatchObject({ mode: 'off', min: null })

    const token = await signedIn(MOVER)
    expect(versionOf(MOVER)).toBe(1)
    expect(await syncVersionSaid(token)).toBe(1)

    await device(MOVER, 'desktop', '0.14.0')
    expect(versionOf(MOVER)).toBe(1)
  })

  test('is the admin’s alone', async () => {
    const mover = await signedIn(MOVER)
    expect((await rollout({ mode: 'all', min: MIN }, mover)).status).toBe(404)
    expect((await call(env, '/v2/admin/sync-rollout', { token: mover })).status).toBe(404)
    expect((await rollout({ everyone: true }, mover)).status).toBe(404)
    const back = await call(env, '/v2/admin/sync-rollout/back', {
      token: mover,
      body: { everyone: true },
    })
    expect(back.status).toBe(404)
  })

  test('takes three modes, and all only with a min no older than the first v2 app', async () => {
    expect((await rollout({ mode: 'everybody' })).status).toBe(400)
    expect((await rollout({ mode: 'all' })).status).toBe(400)
    expect((await rollout({ mode: 'all', min: '0.11.0' })).status).toBe(400)
    expect((await rollout({ mode: 'all', min: 'latest' })).status).toBe(400)

    const set = await rollout({ mode: 'all', min: MIN })
    expect(set.status).toBe(200)
    expect(set.json).toMatchObject({ mode: 'all', min: MIN })

    // The min is kept, so going back to all needs none.
    expect((await rollout({ mode: 'new' })).json).toMatchObject({ mode: 'new', min: MIN })
    expect((await rollout({ mode: 'all' })).json).toMatchObject({ mode: 'all', min: MIN })
  })
})

describe('new accounts', () => {
  test('start on v2 under new, and /v1/me says so before their first pass', async () => {
    await rollout({ mode: 'new' })
    const token = await signedIn(MOVER)
    expect(versionOf(MOVER)).toBe(2)
    expect(await syncVersionSaid(token)).toBe(2)
  })

  test('start on v2 under all', async () => {
    await rollout({ mode: 'all', min: MIN })
    await signedIn(MOVER)
    expect(versionOf(MOVER)).toBe(2)
  })

  test('start on v1 again once it is off', async () => {
    await rollout({ mode: 'new' })
    await rollout({ mode: 'off' })
    await signedIn(MOVER)
    expect(versionOf(MOVER)).toBe(1)
  })
})

describe('an account on v1, under all', () => {
  test('moves when its only device says hello with a new enough app, and it is written down', async () => {
    const token = await signedIn(MOVER)
    await rollout({ mode: 'all', min: MIN })

    await device(MOVER, 'desktop', '0.13.1-580')

    expect(versionOf(MOVER)).toBe(2)
    // The session it was made with has no device behind it, like the Even plugin.
    expect(await syncVersionSaid(token)).toBe(2)
    const said = await call<Rollout>(env, '/v2/admin/sync-rollout', { token: admin })
    expect(said.json.moves).toEqual([
      { email: MOVER, at: expect.any(Number), from: 1, to: 2, why: 'hello', min: MIN },
    ])
  })

  test('stays on v1 while an old device is live, and moves once that device updates', async () => {
    const laptop = await device(MOVER, 'laptop', '0.13.0')
    await rollout({ mode: 'all', min: MIN })

    await device(MOVER, 'desktop', '0.13.1-600')
    expect(versionOf(MOVER)).toBe(1)
    // A phone's builds count on their own and lag behind: one that says less is older.
    await hello(laptop, '0.13.1-488')
    expect(versionOf(MOVER)).toBe(1)

    await hello(laptop, '0.13.1-601')
    expect(versionOf(MOVER)).toBe(2)
  })

  test('moves beside a session with no device, which is what the Even plugin is', async () => {
    const even = await signedIn(MOVER)
    await rollout({ mode: 'all', min: MIN })

    await device(MOVER, 'desktop', '0.14.0')

    expect(versionOf(MOVER)).toBe(2)
    // The plugin still reads the account on v1's routes.
    expect((await call(env, '/v1/spaces', { token: even })).status).toBe(200)
  })

  test('stays on v1 beside a device whose version nobody can read', async () => {
    await device(MOVER, 'odd', 'under test')
    await rollout({ mode: 'all', min: MIN })

    await device(MOVER, 'desktop', '0.14.0')
    expect(versionOf(MOVER)).toBe(1)
  })

  test('is not held back by a device that was ended, or whose session ran out', async () => {
    const ended = await device(MOVER, 'ended', '0.12.0')
    env.db.prepare('update devices set revoked_at = 1 where id = ?').run(ended.id)
    const drawer = await device(MOVER, 'drawer', '0.12.0')
    env.db
      .prepare(
        'update sessions set expires_at = 1 where id = (select session_id from devices where id = ?)',
      )
      .run(drawer.id)
    await rollout({ mode: 'all', min: MIN })

    await device(MOVER, 'desktop', '0.14.0')
    expect(versionOf(MOVER)).toBe(2)
  })

  test('does not move under off or new', async () => {
    await signedIn(MOVER)

    await rollout({ mode: 'all', min: MIN })
    await rollout({ mode: 'off' })
    await device(MOVER, 'desktop', '0.14.0')
    expect(versionOf(MOVER)).toBe(1)

    await rollout({ mode: 'new' })
    await device(MOVER, 'laptop', '0.14.0')
    expect(versionOf(MOVER)).toBe(1)
  })

  test('that a person moved back stays back until the mode is set again', async () => {
    const desktop = await device(MOVER, 'desktop', '0.13.0')
    await rollout({ mode: 'all', min: MIN })
    await hello(desktop, '0.14.0')
    expect(versionOf(MOVER)).toBe(2)

    const back = await call(env, '/v2/admin/sync-version', {
      token: admin,
      body: { email: MOVER, to: 1 },
    })
    expect(back.status).toBe(200)
    await hello(desktop, '0.14.0')
    expect(versionOf(MOVER)).toBe(1)

    vi.setSystemTime(Date.now() + 1000)
    await rollout({ mode: 'all' })
    await hello(desktop, '0.14.0')
    expect(versionOf(MOVER)).toBe(2)
  })
})

describe('the way back for everybody', () => {
  async function twoOnV2(): Promise<string> {
    const token = await signedIn(MOVER)
    await rollout({ mode: 'all', min: MIN })
    await device(MOVER, 'desktop', '0.14.0')
    await call(env, '/v2/admin/sync-version', {
      token: admin,
      body: { email: ADMIN, to: 2, min: MIN },
    })
    expect([versionOf(MOVER), versionOf(ADMIN)]).toEqual([2, 2])
    return token
  }

  function back(body: object) {
    return call<Rollout & { dry: boolean }>(env, '/v2/admin/sync-rollout/back', {
      token: admin,
      body,
    })
  }

  test('asks to be meant', async () => {
    await twoOnV2()
    expect((await back({})).status).toBe(400)
    expect((await back({ everyone: false })).status).toBe(400)
    expect([versionOf(MOVER), versionOf(ADMIN)]).toEqual([2, 2])
  })

  test('counts without moving anybody on a dry run', async () => {
    await twoOnV2()
    const dry = await back({ everyone: true, dry: true })
    expect(dry.json).toMatchObject({ moved: 2, dry: true, mode: 'all' })
    expect([versionOf(MOVER), versionOf(ADMIN)]).toEqual([2, 2])
  })

  test('moves every account to 1 and turns the switch off, so no hello moves one again', async () => {
    const token = await twoOnV2()

    const answer = await back({ everyone: true })

    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ moved: 2, mode: 'off', accounts: { v1: 2, v2: 0 } })
    expect([versionOf(MOVER), versionOf(ADMIN)]).toEqual([1, 1])
    // What the app reads at its next launch, and walks back by.
    expect(await syncVersionSaid(token)).toBe(1)
    expect(answer.json.moves.filter((one) => one.why === 'everyone')).toHaveLength(2)

    await device(MOVER, 'laptop', '0.14.0')
    expect(versionOf(MOVER)).toBe(1)

    // And setting all again is the decision to move them again.
    vi.setSystemTime(Date.now() + 1000)
    await rollout({ mode: 'all' })
    await device(MOVER, 'phone', '0.14.0')
    expect(versionOf(MOVER)).toBe(2)
  })

  test('setting the switch back by itself moves nobody', async () => {
    await twoOnV2()
    await rollout({ mode: 'off' })
    expect([versionOf(MOVER), versionOf(ADMIN)]).toEqual([2, 2])
  })
})
