/** People: a profile and its face, who may read it, whether somebody is here, and what
 *  they are called in a space. Routes against the real schema, the hub as the real class
 *  over its fakes. See src/people and docs/chats.md 4.9 and 4.10. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { presenceOf } from '../src/people/presence'
import { profileChanges, statusIn } from '../src/people/profile'
import { call, mail, signIn, testEnv, type TestEnv } from './harness'
import { connect, hangUp, hub, send } from './hub-fakes'

const OWNER = 'owner@example.com'
const MEMBER = 'member@example.com'
const OTHER = 'other@example.com'
const STRANGER = 'stranger@example.com'

/** What the people routes answer, as far as these tests read it. */
interface PeopleReply {
  people: Record<string, unknown>[]
  profile: { avatar: unknown }
  presence: Record<string, string>
  user: { nicks: Record<string, string> }
  spaces: { id: string; people?: string[] }[]
  link: { url: string }
}

describe('a profile change', () => {
  test('keeps what it names and leaves out what it does not', () => {
    expect(profileChanges({ pronouns: ' she / her ', bio: null })).toEqual({
      changes: { pronouns: 'she / her', bio: null },
    })
    expect(profileChanges({})).toEqual({ changes: {} })
  })

  test('keeps a bio on its lines and an empty one as none', () => {
    expect(profileChanges({ bio: 'Line one\nline two\u0007' })).toEqual({
      changes: { bio: 'Line one\nline two' },
    })
    expect(profileChanges({ bio: '   ' })).toEqual({ changes: { bio: null } })
  })

  test('says what is wrong with what it cannot keep', () => {
    expect(profileChanges({ pronouns: 'x'.repeat(41) })).toEqual({
      problem: 'use at most 40 characters',
    })
    expect(profileChanges({ bio: 'x'.repeat(191) })).toEqual({
      problem: 'use at most 190 characters',
    })
    expect(profileChanges({ pronouns: 3 })).toEqual({ problem: 'pronouns must be text' })
    expect(profileChanges({ accent: '#ff0000' })).toEqual({ problem: 'accent must be an accent' })
    expect(profileChanges({ zone: 'Mars/Olympus' })).toEqual({
      problem: 'zone must be a time zone',
    })
    expect(profileChanges({ hidden: 'yes' })).toEqual({ problem: 'hidden must be true or false' })
    expect(profileChanges({ status: 'busy' })).toEqual({ problem: 'status must be an object' })
  })

  test('takes a status as an emoji, a line, an end and quiet', () => {
    expect(
      profileChanges({ status: { emoji: '🌴', text: ' On  leave ', until: 5000, quiet: true } }),
    ).toEqual({ changes: { status: { emoji: '🌴', text: 'On leave', until: 5000, quiet: true } } })
  })
})

describe('a status', () => {
  const kept = JSON.stringify({ emoji: '🍝', text: 'Lunch', until: 1000, quiet: false })

  test('stands until its time', () => {
    expect(statusIn(kept, 999)).toEqual({ emoji: '🍝', text: 'Lunch', until: 1000, quiet: false })
  })

  test('is gone at its time, with nothing run to take it away', () => {
    expect(statusIn(kept, 1000)).toBeNull()
  })

  test('without an end stands for good', () => {
    const forever = JSON.stringify({ emoji: '🎧', text: 'Focus', until: null })
    expect(statusIn(forever, Number.MAX_SAFE_INTEGER)?.text).toBe('Focus')
  })

  test('that holds nothing is none', () => {
    expect(statusIn(JSON.stringify({ emoji: '', text: ' ', until: null }), 0)).toBeNull()
    expect(statusIn('not json', 0)).toBeNull()
  })
})

describe('presence, worked out', () => {
  test('is active with any device in use, away with one connected, offline with none', () => {
    expect(presenceOf([])).toBe('offline')
    expect(presenceOf([{ active: false, guest: false }])).toBe('away')
    expect(
      presenceOf([
        { active: false, guest: false },
        { active: true, guest: false },
      ]),
    ).toBe('active')
  })
})

describe('the routes', () => {
  let env: TestEnv
  let owner: string
  let member: string
  let other: string
  let stranger: string
  let space: string

  /** The account behind a session. */
  async function idOf(token: string): Promise<string> {
    return (await call(env, '/v1/me', { token })).json.user.id
  }

  /** Somebody invited into the space and in it. */
  async function invite(email: string): Promise<string> {
    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email, role: 'write' },
      }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    if (!link) throw new Error(`no invitation was sent:\n${sent}`)
    const token = await signIn(env, email)
    await call(env, `/v1/join/${link}`, { method: 'POST', token })
    return token
  }

  /** The people an account reads, by id. */
  async function seen(token: string, ids: string[]): Promise<Record<string, unknown>[]> {
    const { json } = await call<PeopleReply>(env, `/v2/people?ids=${ids.join(',')}`, { token })
    return json.people
  }

  /** A picture uploaded the way the app uploads a face: WebP, by its hash. */
  async function upload(token: string, bytes: string, type = 'image/webp'): Promise<string> {
    const hash = await sha256(bytes)
    const put = await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: bytes,
      headers: { 'content-type': type },
    })
    expect(put.status).toBeLessThan(300)
    return hash
  }

  beforeEach(async () => {
    env = testEnv()
    owner = await signIn(env, OWNER)
    stranger = await signIn(env, STRANGER)
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id
    member = await invite(MEMBER)
    other = await invite(OTHER)
  })

  afterEach(() => env.close())

  test('a profile is written and read back with the account', async () => {
    const put = await call(env, '/v2/me/profile', {
      method: 'PUT',
      token: member,
      body: {
        pronouns: 'they/them',
        bio: 'Thesis on sparse solvers.',
        accent: 'teal',
        zone: 'Europe/Zurich',
        status: { emoji: '🌴', text: 'Away', until: null },
      },
    })
    expect(put.status).toBe(200)

    const { json } = await call(env, '/v1/me', { token: member })
    expect(json.user).toMatchObject({
      pronouns: 'they/them',
      bio: 'Thesis on sparse solvers.',
      accent: 'teal',
      zone: 'Europe/Zurich',
      status: { emoji: '🌴', text: 'Away', until: null, quiet: false },
      avatar: null,
      hidden: false,
      nicks: {},
    })
  })

  test('a profile change that is wrong is refused with its sentence', async () => {
    const put = await call(env, '/v2/me/profile', {
      method: 'PUT',
      token: member,
      body: { bio: 'x'.repeat(191) },
    })
    expect(put.status).toBe(400)
    expect(put.json.error).toBe('use at most 190 characters')
  })

  test('is read by the people who share something with them, and by nobody else', async () => {
    const ownerId = await idOf(owner)
    const memberId = await idOf(member)
    const otherId = await idOf(other)
    const strangerId = await idOf(stranger)
    const all = [ownerId, memberId, otherId, strangerId]

    const names = async (token: string) => (await seen(token, all)).map((one) => one.id).sort()

    // The owner sees the two let in; each of them sees the owner and the other.
    expect(await names(owner)).toEqual([ownerId, memberId, otherId].sort())
    expect(await names(member)).toEqual([ownerId, memberId, otherId].sort())
    // Somebody who shares nothing sees themselves and nobody else.
    expect(await names(stranger)).toEqual([strangerId])
  })

  test('says a name, never an address', async () => {
    const memberId = await idOf(member)
    const [person] = await seen(owner, [memberId])
    expect(person).toMatchObject({ id: memberId, name: 'member', avatar: null })
    expect(JSON.stringify(person)).not.toContain('@')
  })

  test('an invitation not yet opened shows the face to its owner only', async () => {
    const late = await signIn(env, 'late@example.com')
    await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: 'late@example.com', role: 'read' },
      }),
    )
    const [ownerId, lateId] = await Promise.all([idOf(owner), idOf(late)])

    expect((await seen(owner, [lateId])).map((one) => one.id)).toEqual([lateId])
    expect(await seen(late, [ownerId])).toEqual([])
  })

  test('a face is two WebP pictures of the account, and the old one is given back', async () => {
    const small = await upload(member, 'small face')
    const large = await upload(member, 'large face')

    const put = await call<PeopleReply>(env, '/v2/me/avatar', {
      method: 'PUT',
      token: member,
      body: { s: small, l: large },
    })
    expect(put.json.profile.avatar).toEqual({ s: small, l: large })

    const [person] = await seen(owner, [await idOf(member)])
    expect(person?.avatar).toEqual({ s: small, l: large })

    // A new face: the first two are not this account's any more.
    const next = [await upload(member, 'small two'), await upload(member, 'large two')]
    await call(env, '/v2/me/avatar', {
      method: 'PUT',
      token: member,
      body: { s: next[0], l: next[1] },
    })
    const held = env.db
      .prepare('select hash from blobs where hash in (?, ?, ?, ?)')
      .all(small, large, ...next)
      .map((row) => (row as { hash: string }).hash)
    expect(held.sort()).toEqual([...next].sort())

    // And none: both given back.
    const gone = await call<PeopleReply>(env, '/v2/me/avatar', { method: 'DELETE', token: member })
    expect(gone.json.profile.avatar).toBeNull()
    expect(env.db.prepare('select count(*) as n from blobs').get()).toEqual({ n: 0 })
  })

  test('a face that is not WebP or JPEG, or not this account’s, is refused', async () => {
    const png = await upload(member, 'png bytes', 'image/png')
    const webp = await upload(member, 'webp bytes')
    const theirs = await upload(other, 'their bytes')

    for (const body of [
      { s: png, l: webp },
      { s: webp, l: theirs },
    ]) {
      const put = await call(env, '/v2/me/avatar', { method: 'PUT', token: member, body })
      expect(put.status).toBe(400)
      expect(put.json.error).toBe('upload both pictures first')
    }

    const bad = await call(env, '/v2/me/avatar', {
      method: 'PUT',
      token: member,
      body: { s: 'nope', l: webp },
    })
    expect(bad.json.error).toBe('that is not a hash')
  })

  test('a nickname is the account’s own in one space, and empty takes it away', async () => {
    const memberId = await idOf(member)
    const set = await call(env, `/v2/spaces/${space}/nick`, {
      method: 'PUT',
      token: member,
      body: { nick: '  Lu  ' },
    })
    expect(set.json).toEqual({ nick: 'Lu' })

    expect((await call(env, `/v2/spaces/${space}/nicks`, { token: owner })).json).toEqual({
      nicks: { [memberId]: 'Lu' },
    })
    expect((await call<PeopleReply>(env, '/v1/me', { token: member })).json.user.nicks).toEqual({
      [space]: 'Lu',
    })

    await call(env, `/v2/spaces/${space}/nick`, {
      method: 'PUT',
      token: member,
      body: { nick: '' },
    })
    expect((await call(env, `/v2/spaces/${space}/nicks`, { token: owner })).json).toEqual({
      nicks: {},
    })
  })

  test('a nickname is nothing to somebody outside the space', async () => {
    const put = await call(env, `/v2/spaces/${space}/nick`, {
      method: 'PUT',
      token: stranger,
      body: { nick: 'Me' },
    })
    expect(put.status).toBe(404)
    expect((await call(env, `/v2/spaces/${space}/nicks`, { token: stranger })).status).toBe(404)
  })

  test('the switcher is told up to three faces of the others in a shared space', async () => {
    const ownerId = await idOf(owner)
    const memberId = await idOf(member)
    const otherId = await idOf(other)
    const peopleIn = async (token: string) =>
      (await call<PeopleReply>(env, '/v1/spaces', { token })).json.spaces.find(
        (one) => one.id === space,
      )?.people

    expect(await peopleIn(owner)).toEqual([memberId, otherId])
    expect(await peopleIn(member)).toEqual([ownerId, otherId])
  })

  test('presence says offline for somebody who appears offline, to everybody but them', async () => {
    const memberId = await idOf(member)
    env.db
      .prepare("insert into presence (user_id, state, at) values (?, 'active', 1)")
      .run(memberId)

    const read = async (token: string) =>
      (await call<PeopleReply>(env, `/v2/presence?ids=${memberId}`, { token })).json.presence[
        memberId
      ]
    expect(await read(owner)).toBe('active')

    await call(env, '/v2/me/profile', { method: 'PUT', token: member, body: { hidden: true } })
    expect(await read(owner)).toBe('offline')
    expect(await read(member)).toBe('active')
  })

  test('a guest reaches none of it', async () => {
    const link = await call<PeopleReply>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const token = /\/join\/([a-f0-9]+)/.exec(link.json.link.url)?.[1] ?? ''
    const guest = (await call(env, `/v1/join/${token}`, { method: 'POST', body: {} })).json.token

    expect((await call(env, '/v2/people?ids=x', { token: guest })).status).toBe(403)
    expect(
      (await call(env, '/v2/me/profile', { method: 'PUT', token: guest, body: {} })).status,
    ).toBe(403)
  })
})

describe('presence, kept by the hub', () => {
  const USER = 'user-presence'
  const T0 = Date.UTC(2026, 9, 7, 9)
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    env = testEnv()
    env.db.prepare('insert into users (id, email, created_at) values (?, ?, 1)').run(USER, 'p@q.r')
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  const row = () =>
    env.db.prepare('select state, at from presence where user_id = ?').get(USER) as
      { state: string; at: number } | undefined

  async function device(made: ReturnType<typeof hub>['hub'], id: string) {
    env.db
      .prepare(
        `insert into sessions (token_hash, user_id, created_at, expires_at, id)
         values (?, ?, 1, 9e15, ?)`,
      )
      .run(`hash-${id}`, USER, `session-${id}`)
    const socket = connect(made, { device: id, who: USER, session: `session-${id}` })
    await send(made, socket, { t: 'hello', device: id, name: id, platform: 'windows', app: '1' })
    return socket
  }

  test('is written when it changes, and only then', async () => {
    const { hub: made, state } = hub(env)

    const laptop = await device(made, 'device-laptop')
    expect(row()).toEqual({ state: 'active', at: T0 })

    // A second device in use changes nothing, so nothing is written.
    vi.setSystemTime(T0 + 1000)
    const phone = await device(made, 'device-phone')
    expect(row()).toEqual({ state: 'active', at: T0 })

    // Both idle: away, once.
    vi.setSystemTime(T0 + 2000)
    await send(made, laptop, { t: 'idle' })
    expect(row()?.state).toBe('active')
    await send(made, phone, { t: 'idle' })
    expect(row()).toEqual({ state: 'away', at: T0 + 2000 })

    // Both gone: offline.
    vi.setSystemTime(T0 + 3000)
    await hangUp(made, state, laptop)
    expect(row()?.state).toBe('away')
    await hangUp(made, state, phone)
    expect(row()).toEqual({ state: 'offline', at: T0 + 3000 })
  })

  test('is nothing a guest’s socket says', async () => {
    const { hub: made } = hub(env)
    connect(made, { device: 'g', who: 'guest-1', guest: true })
    await send(made, connect(made, { device: 'g2', who: 'guest-1', guest: true }), {
      t: 'hello',
      device: 'g2',
      name: 'Firefox',
      platform: 'web',
      app: '1',
    })
    expect(env.db.prepare('select count(*) as n from presence').get()).toEqual({ n: 0 })
  })
})
