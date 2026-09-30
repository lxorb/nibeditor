/** Leases, crashes and expiry: docs/sync-v2.md section 12, bullet by bullet.
 *
 *  The hub runs as the real class over a fake runtime (see hub-fakes.ts), against
 *  the real schema, on Vitest's clock. The runtime's two sources of time are stood
 *  in for explicitly - `beat` is the runtime answering a socket's `beat`, `fire` is
 *  the alarm going off once the clock has reached it - so every test says exactly
 *  which moments it is about. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFrame } from '../src/hub/frames'
import type { AccountHub } from '../src/hub/hub'
import { FENCED } from '../src/refused'
import { call, signIn, type TestEnv, testEnv } from './harness'
import {
  beat,
  beatAll,
  type Computer,
  computer,
  connect,
  fire,
  hangUp,
  hub,
  type Hubs,
  hubs,
  type HubSocket,
  type HubState,
  send,
} from './hub-fakes'

const T0 = Date.UTC(2026, 8, 30, 12)
const USER = 'user-hub'
const KEY = 'k'.repeat(43)
const LAPTOP = 'device-laptop'
const DESKTOP = 'device-desktop'
const TABLET = 'device-tablet'

const at = (ms: number) => vi.setSystemTime(T0 + ms)

describe('a lease', () => {
  let env: TestEnv
  let made: AccountHub
  let state: HubState

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    env.db.prepare('insert into users (id, email, created_at) values (?, ?, 1)').run(USER, 'a@b.c')
    ;({ hub: made, state } = hub(env))
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  /** A device of the account that holds the web key, connected, beating and
   *  having said hello, with its greeting taken. */
  async function device(id: string, name: string, keyed = true): Promise<HubSocket> {
    const session = `session-${id}`
    env.db
      .prepare(
        `insert into sessions (token_hash, user_id, created_at, expires_at, id)
         values (?, ?, 1, 9e15, ?)`,
      )
      .run(`hash-${id}`, USER, session)
    if (keyed) {
      env.db
        .prepare(
          `insert into devices (id, user_id, session_id, name, platform, created_at)
           values (?, ?, ?, ?, 'windows', 1)`,
        )
        .run(id, USER, session, name)
      env.db
        .prepare(
          'insert into web_keys (user_id, device_id, wrapped, generation) values (?, ?, ?, 1)',
        )
        .run(USER, id, 'w'.repeat(60))
    }

    const socket = connect(made, { device: id, who: USER, session })
    beat(state, socket)
    await send(made, socket, { t: 'hello', device: id, name, platform: 'windows', app: '0.9' })
    socket.take()
    return socket
  }

  const acquire = (socket: HubSocket, take = false) =>
    send(made, socket, { t: 'acquire', key: KEY, take })

  test('that is free is granted at once, under the first fence', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    await acquire(laptop)

    expect(laptop.take()).toEqual([{ t: 'granted', key: KEY, fence: 1, version: 0 }])
  })

  test('asked for again by its holder is the same grant', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    await acquire(laptop)
    await acquire(laptop)

    expect(laptop.take()).toEqual([
      { t: 'granted', key: KEY, fence: 1, version: 0 },
      { t: 'granted', key: KEY, fence: 1, version: 0 },
    ])
  })

  test('held by a device in use is busy, and says where', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    laptop.take()

    await acquire(desktop)

    expect(desktop.take()).toEqual([{ t: 'busy', key: KEY, device: LAPTOP, name: 'Laptop' }])
    expect(laptop.take()).toEqual([])
  })

  test('taken with Use here is flushed first, granted after, under the next fence', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    laptop.take()

    await acquire(desktop, true)
    expect(laptop.take()).toEqual([{ t: 'flush', key: KEY, fence: 1 }])
    // Nothing for the new device until the old one has handed over.
    expect(desktop.take()).toEqual([])

    await send(made, laptop, { t: 'flushed', key: KEY, version: 0 })
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
    expect(laptop.take()).toEqual([{ t: 'lost', key: KEY, device: DESKTOP, name: 'Desktop' }])
  })

  test('whose holder never answers the flush goes anyway after ten seconds', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop, true)
    laptop.take()

    at(5_000)
    beat(state, laptop)
    beat(state, desktop)

    at(9_999)
    expect(await fire(made, state)).toBe(false)
    expect(desktop.take()).toEqual([])

    at(10_000)
    expect(await fire(made, state)).toBe(true)
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
    expect(laptop.take()).toEqual([{ t: 'lost', key: KEY, device: DESKTOP, name: 'Desktop' }])
  })

  test('whose holder stops beating is free thirty seconds on, and a waiter is told', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop)
    desktop.take()

    // The alarm is at the laptop's last beat and thirty seconds, which it is not
    // sending any more: a crash is nothing arriving.
    expect(state.alarm).toBe(T0 + 30_000)

    at(20_000)
    beat(state, desktop)
    at(29_999)
    expect(await fire(made, state)).toBe(false)

    at(30_000)
    expect(await fire(made, state)).toBe(true)
    expect(desktop.take()).toEqual([{ t: 'free', key: KEY }])

    await acquire(desktop)
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
  })

  test('stays with a holder that keeps beating, however long somebody waits', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop)
    desktop.take()

    for (let second = 10; second <= 180; second += 10) {
      at(second * 1000)
      beat(state, laptop)
      beat(state, desktop)
      await fire(made, state)
    }

    expect(desktop.take()).toEqual([])
    // And the alarm still watches the holder's beats for the one who waits.
    expect(state.alarm).toBe(T0 + 180_000 + 30_000)
  })

  test('whose holder goes idle is handed to the one waiting, without Use here', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop)
    laptop.take()
    desktop.take()

    await send(made, laptop, { t: 'idle' })
    expect(desktop.take()).toEqual([{ t: 'free', key: KEY }])

    await acquire(desktop)
    expect(laptop.take()).toEqual([{ t: 'flush', key: KEY, fence: 1 }])

    await send(made, laptop, { t: 'flushed', key: KEY, version: 0 })
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
  })

  test('whose holder is in use again is busy again', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await send(made, laptop, { t: 'idle' })
    await send(made, laptop, { t: 'active' })
    laptop.take()

    await acquire(desktop)
    expect(desktop.take()).toEqual([{ t: 'busy', key: KEY, device: LAPTOP, name: 'Laptop' }])
    expect(laptop.take()).toEqual([])
  })

  test('whose holder closes its socket is free for the one waiting at once', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop)
    desktop.take()

    await hangUp(made, state, laptop)
    expect(desktop.take()).toEqual([{ t: 'free', key: KEY }])
  })

  test('released is free for the one waiting, and granted under a new fence', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop)
    desktop.take()

    await send(made, laptop, { t: 'release', key: KEY, version: 0 })
    expect(desktop.take()).toEqual([{ t: 'free', key: KEY }])

    await acquire(desktop)
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
  })

  test('goes to the last Use here while a handover is under way', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    const tablet = await device(TABLET, 'Tablet')
    await acquire(laptop)
    await acquire(desktop, true)
    laptop.take()

    await acquire(tablet, true)
    expect(desktop.take()).toEqual([{ t: 'busy', key: KEY, device: TABLET, name: 'Tablet' }])

    await send(made, laptop, { t: 'flushed', key: KEY, version: 0 })
    expect(tablet.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
    expect(laptop.take()).toEqual([{ t: 'lost', key: KEY, device: TABLET, name: 'Tablet' }])
  })

  test('stays with a holder who presses Use here during the handover', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop, true)
    laptop.take()

    await acquire(laptop, true)
    expect(laptop.take()).toEqual([{ t: 'granted', key: KEY, fence: 1, version: 0 }])
    expect(desktop.take()).toEqual([{ t: 'busy', key: KEY, device: LAPTOP, name: 'Laptop' }])
  })

  test('goes back to its holder when the device it was going to leaves', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')
    await acquire(laptop)
    await acquire(desktop, true)
    laptop.take()

    await hangUp(made, state, desktop)
    // The holder stopped its pages when it was asked to hand over; it is told to
    // carry on, under the fence it had.
    expect(laptop.take()).toEqual([{ t: 'granted', key: KEY, fence: 1, version: 0 }])
  })

  test('has a fence that only ever grows', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    const desktop = await device(DESKTOP, 'Desktop')

    const fences: number[] = []
    const granted = (socket: HubSocket) => {
      for (const said of socket.take()) if (said.t === 'granted') fences.push(said.fence)
    }

    await acquire(laptop)
    granted(laptop)
    await send(made, laptop, { t: 'release', key: KEY })
    await acquire(laptop)
    granted(laptop)
    await acquire(desktop, true)
    await send(made, laptop, { t: 'flushed', key: KEY })
    granted(desktop)
    await send(made, desktop, { t: 'release', key: KEY })
    await acquire(laptop)
    granted(laptop)

    expect(fences).toEqual([1, 2, 3, 4])
  })

  test('is only for a device that has the web key', async () => {
    const stranger = await device(TABLET, 'Tablet', false)
    await acquire(stranger)

    expect(stranger.take()).toEqual([
      {
        t: 'refused',
        to: 'acquire',
        key: KEY,
        error: 'this computer does not have your web logins yet',
      },
    ])
  })

  test('is asked for after hello, not before', async () => {
    const socket = connect(made, { device: LAPTOP, who: USER, session: 'session-x' })
    await acquire(socket)

    expect(socket.take()).toEqual([
      { t: 'refused', to: 'acquire', key: KEY, error: 'say hello first' },
    ])
  })

  test('is nothing a guest can hold', async () => {
    const guest = connect(made, { device: 'device-guest', who: 'guest-1', guest: true })
    await send(made, guest, {
      t: 'hello',
      device: 'device-guest',
      name: 'Owl',
      platform: 'web',
      app: '1',
    })
    await acquire(guest)
    await send(made, guest, { t: 'want-key', pub: 'p'.repeat(44) })

    expect(guest.take()).toEqual([
      { t: 'refused', to: 'acquire', key: KEY, error: 'sign in to do that' },
      { t: 'refused', to: 'want-key', error: 'sign in to do that' },
    ])
    // And a guest is never written down as a device of anybody's.
    expect(env.db.prepare('select count(*) as many from devices').get()).toEqual({ many: 0 })
  })

  test('is asked for at most thirty times a minute by one device', async () => {
    const laptop = await device(LAPTOP, 'Laptop')
    for (let asked = 0; asked < 30; asked++) await acquire(laptop)
    expect(laptop.take().every((one) => one.t === 'granted')).toBe(true)

    await acquire(laptop)
    expect(laptop.take()).toEqual([
      { t: 'refused', to: 'acquire', key: KEY, error: 'too many tries - try again in a minute' },
    ])

    at(61_000)
    beat(state, laptop)
    await acquire(laptop)
    expect(laptop.take()).toEqual([{ t: 'granted', key: KEY, fence: 1, version: 0 }])
  })
})

describe('liveness', () => {
  let env: TestEnv
  let made: AccountHub
  let state: HubState

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    env.db.prepare('insert into users (id, email, created_at) values (?, ?, 1)').run(USER, 'a@b.c')
    for (const id of [LAPTOP, DESKTOP]) {
      env.db
        .prepare(
          `insert into devices (id, user_id, name, platform, created_at)
           values (?, ?, ?, 'windows', 1)`,
        )
        .run(id, USER, id)
      env.db
        .prepare(
          'insert into web_keys (user_id, device_id, wrapped, generation) values (?, ?, ?, 1)',
        )
        .run(USER, id, 'w'.repeat(60))
    }
    ;({ hub: made, state } = hub(env))
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  async function device(id: string): Promise<HubSocket> {
    const socket = connect(made, { device: id, who: USER })
    await send(made, socket, { t: 'hello', device: id, name: id, platform: 'mac', app: '1' })
    socket.take()
    return socket
  }

  test('is the runtime answering beats, and nothing a device says', async () => {
    const laptop = await device(LAPTOP)
    const desktop = await device(DESKTOP)
    beat(state, laptop)
    await send(made, laptop, { t: 'acquire', key: KEY, take: false })

    // A minute of the laptop talking - activity, asking again, a `beat` that
    // reached the hub instead of the runtime, frames carrying times far in the
    // future - and not one beat answered by the runtime.
    for (let second = 5; second <= 60; second += 5) {
      at(second * 1000)
      const future = Date.now() + 1e9
      await send(made, laptop, { t: 'active', at: future })
      await send(made, laptop, { t: 'acquire', key: KEY, take: false, at: future, beat: future })
      await send(made, laptop, 'beat')
      await send(made, laptop, { t: 'beat', at: future })
      beat(state, desktop)
    }

    // So the laptop is not alive, and the lease is the desktop's for the asking.
    desktop.take()
    await send(made, desktop, { t: 'acquire', key: KEY, take: false })
    expect(desktop.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 0 }])
  })

  test('holds for a device that beats and says nothing else', async () => {
    const laptop = await device(LAPTOP)
    const desktop = await device(DESKTOP)
    beat(state, laptop)
    await send(made, laptop, { t: 'acquire', key: KEY, take: false })

    for (let second = 10; second <= 120; second += 10) {
      at(second * 1000)
      beat(state, laptop)
      beat(state, desktop)
    }

    await send(made, desktop, { t: 'acquire', key: KEY, take: false })
    expect(desktop.take()).toEqual([{ t: 'busy', key: KEY, device: LAPTOP, name: LAPTOP }])
  })

  test('starts from the moment the hub let a socket in, by its own clock', async () => {
    const laptop = await device(LAPTOP)
    const desktop = await device(DESKTOP)
    // Never a beat from the laptop: it is alive for thirty seconds from joining.
    await send(made, laptop, { t: 'acquire', key: KEY, take: false })

    at(29_999)
    beat(state, desktop)
    await send(made, desktop, { t: 'acquire', key: KEY, take: false })
    expect(desktop.take()[0]?.t).toBe('busy')

    at(30_000)
    expect(await fire(made, state)).toBe(true)
    expect(desktop.take()).toEqual([{ t: 'free', key: KEY }])
  })

  test('reads no time off a frame', () => {
    expect(
      readFrame(JSON.stringify({ t: 'acquire', key: KEY, take: true, at: 1, now: 2 })),
    ).toEqual({ t: 'acquire', key: KEY, take: true })
    expect(readFrame(JSON.stringify({ t: 'flushed', key: KEY, version: 3, at: 1 }))).toEqual({
      t: 'flushed',
      key: KEY,
    })
    expect(readFrame(JSON.stringify({ t: 'idle', since: 5 }))).toEqual({ t: 'idle' })
    expect(readFrame('beat')).toBeNull()
  })

  test('asks the runtime to answer beats without waking the hub', () => {
    expect(state.autoResponse).toEqual({ request: 'beat', response: 'ok' })
  })
})

describe('an upload', () => {
  let env: TestEnv
  let running: Hubs

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  /** Two computers of one account, both alive now. */
  async function two(): Promise<[Computer, Computer, AccountHub]> {
    const laptop = await computer(env, running, 'web@example.com', 'Laptop')
    const desktop = await computer(env, running, 'web@example.com', 'Desktop')
    const { hub: made, state } = running.of(laptop.user)
    beatAll(state)
    return [laptop, desktop, made]
  }

  const upload = (token: string, fence: number, bytes = new Uint8Array([1, 2, 3])) =>
    call(env, `/v2/web/${KEY}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: {
        'content-type': 'application/octet-stream',
        'x-nib-fence': String(fence),
        'x-nib-generation': '1',
      },
    })

  test('under an older fence is refused, and writes nothing', async () => {
    const [laptop, desktop, made] = await two()

    await send(made, laptop.socket, { t: 'acquire', key: KEY, take: false })
    await send(made, desktop.socket, { t: 'acquire', key: KEY, take: true })
    await send(made, laptop.socket, { t: 'flushed', key: KEY })

    // The laptop slept through all of that, and wakes to upload under fence 1.
    const late = await upload(laptop.token, 1)
    expect(late.status).toBe(409)
    expect(late.json.error).toBe(FENCED)
    expect(env.keys().filter((one) => one.startsWith('web/'))).toEqual([])
    expect(env.db.prepare('select count(*) as many from web_states').get()).toEqual({ many: 0 })

    const landed = await upload(desktop.token, 2)
    expect(landed.status).toBe(200)
    expect(landed.json).toEqual({ version: 1 })
  })

  test('by the holder lands, moves the version on, and tells the other devices', async () => {
    const [laptop, desktop, made] = await two()
    await send(made, laptop.socket, { t: 'acquire', key: KEY, take: false })
    laptop.socket.take()

    expect((await upload(laptop.token, 1)).json).toEqual({ version: 1 })
    expect((await upload(laptop.token, 1, new Uint8Array([9]))).json).toEqual({ version: 2 })

    expect(desktop.socket.take()).toEqual([
      { t: 'state', key: KEY, version: 1 },
      { t: 'state', key: KEY, version: 2 },
    ])
    expect(laptop.socket.take()).toEqual([])
    expect(
      env.db.prepare('select fence, version, generation, size, device_id from web_states').get(),
    ).toEqual({ fence: 1, version: 2, generation: 1, size: 1, device_id: laptop.id })

    // And the next grant names the newest version.
    await send(made, laptop.socket, { t: 'release', key: KEY })
    await send(made, desktop.socket, { t: 'acquire', key: KEY, take: false })
    expect(desktop.socket.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 2 }])

    // A download is the bucket and nothing else.
    const asked = running.asked.length
    const got = await call(env, `/v2/web/${KEY}`, { token: desktop.token })
    expect(got.status).toBe(200)
    expect(got.headers.get('x-nib-version')).toBe('2')
    expect(got.headers.get('x-nib-fence')).toBe('1')
    expect(got.headers.get('x-nib-generation')).toBe('1')
    expect(running.asked.length).toBe(asked)
  })

  test('the bucket cannot take is a moment to wait, and changes nothing', async () => {
    const [laptop, desktop, made] = await two()
    await send(made, laptop.socket, { t: 'acquire', key: KEY, take: false })

    const bucket = env.NOTES as unknown as { put: (...args: unknown[]) => Promise<void> }
    const real = bucket.put.bind(bucket)
    bucket.put = () => Promise.reject(new Error('the bucket is unwell'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await upload(laptop.token, 1)
    quiet.mockRestore()
    bucket.put = real

    expect(failed.status).toBe(503)
    expect(desktop.socket.take()).toEqual([])
    expect(laptop.socket.closedWith).toBeNull()
    // The version was not spent on bytes that never landed.
    expect((await upload(laptop.token, 1)).json).toEqual({ version: 1 })
  })

  test('by a device that holds no lease is refused', async () => {
    const [laptop] = await two()
    const answer = await upload(laptop.token, 1)
    expect(answer.status).toBe(409)
    expect(answer.json.error).toBe(FENCED)
  })

  test('by a session no device said hello with is refused before the hub', async () => {
    const token = await signIn(env, 'web@example.com')
    const asked = running.asked.length
    expect((await upload(token, 1)).status).toBe(409)
    expect(running.asked.length).toBe(asked)
  })

  test('happens at most sixty times an hour for one site', async () => {
    const [laptop, , made] = await two()
    await send(made, laptop.socket, { t: 'acquire', key: KEY, take: false })

    for (let one = 0; one < 60; one++) expect((await upload(laptop.token, 1)).status).toBe(200)

    const refused = await upload(laptop.token, 1)
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too many tries - try again in an hour')
  })
})

describe('ending a device', () => {
  let env: TestEnv
  let running: Hubs

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  test('closes its socket, drops its key, frees its lease and asks for a new key', async () => {
    const laptop = await computer(env, running, 'end@example.com', 'Laptop')
    const desktop = await computer(env, running, 'end@example.com', 'Desktop')
    const { hub: made, state } = running.of(laptop.user)
    beatAll(state)

    await send(made, laptop.socket, { t: 'acquire', key: KEY, take: false })
    await send(made, desktop.socket, { t: 'acquire', key: KEY, take: false })
    desktop.socket.take()

    const ended = await call(env, `/v2/devices/${laptop.id}`, {
      method: 'DELETE',
      token: desktop.token,
    })
    expect(ended.status).toBe(200)

    expect(laptop.socket.closedWith).toEqual({ code: 1008, reason: 'this device was signed out' })
    expect(
      env.db.prepare('select device_id from web_keys where user_id = ?').all(laptop.user),
    ).toEqual([{ device_id: desktop.id }])
    // Its session is over too.
    expect((await call(env, '/v1/me', { token: laptop.token })).status).toBe(401)

    // The one waiting hears the lease is free, and is granted it under a new fence
    // with the account asked to move to a new key generation.
    expect(desktop.socket.take()).toEqual([{ t: 'free', key: KEY }])
    await send(made, desktop.socket, { t: 'acquire', key: KEY, take: false })
    expect(desktop.socket.take()).toEqual([
      { t: 'granted', key: KEY, fence: 2, version: 0, rotate: true },
    ])

    // An upload under the next generation is the rotation done.
    const up = await call(env, `/v2/web/${KEY}`, {
      method: 'PUT',
      token: desktop.token,
      raw: new Uint8Array([1]),
      headers: { 'x-nib-fence': '2', 'x-nib-generation': '2' },
    })
    expect(up.status).toBe(200)
    await send(made, desktop.socket, { t: 'acquire', key: KEY, take: false })
    expect(desktop.socket.take()).toEqual([{ t: 'granted', key: KEY, fence: 2, version: 1 }])
  })

  test('is what ending its session from the sessions list does', async () => {
    const laptop = await computer(env, running, 'list@example.com', 'Laptop')
    const desktop = await computer(env, running, 'list@example.com', 'Desktop')

    const ended = await call(env, `/v1/sessions/${laptop.session}`, {
      method: 'DELETE',
      token: desktop.token,
    })
    expect(ended.status).toBe(200)

    expect(laptop.socket.closedWith?.code).toBe(1008)
    expect(
      env.db
        .prepare('select revoked_at is not null as ended from devices where id = ?')
        .get(laptop.id),
    ).toEqual({ ended: 1 })
    expect(
      env.db.prepare('select count(*) as many from web_keys where device_id = ?').get(laptop.id),
    ).toEqual({ many: 0 })
  })

  test('is what ending every other session does, and signing out', async () => {
    const laptop = await computer(env, running, 'all@example.com', 'Laptop')
    const desktop = await computer(env, running, 'all@example.com', 'Desktop')
    const tablet = await computer(env, running, 'all@example.com', 'Tablet')

    const others = await call(env, '/v1/sessions', { method: 'DELETE', token: tablet.token })
    expect(others.status).toBe(200)
    expect(laptop.socket.closedWith?.code).toBe(1008)
    expect(desktop.socket.closedWith?.code).toBe(1008)
    expect(tablet.socket.closedWith).toBeNull()

    const out = await call(env, '/v1/auth/signout', { method: 'POST', token: tablet.token })
    expect(out.status).toBe(200)
    expect(tablet.socket.closedWith?.code).toBe(1008)
    expect(env.db.prepare('select count(*) as many from web_keys').get()).toEqual({ many: 0 })
  })

  test('is unknown for a device the account does not have', async () => {
    const token = await signIn(env, 'none@example.com')
    const answer = await call(env, '/v2/devices/device-nobody', { method: 'DELETE', token })
    expect(answer.status).toBe(404)
    expect(answer.json.error).toBe('no such device')
  })
})
