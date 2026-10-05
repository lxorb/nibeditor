/** The online terminal's server side (docs/online-terminal.md, 4.4 to 4.9): the routes
 *  and the door against real SQL, and `Machine` driven through a fake host with the
 *  alarm moved by the clock. */

import { mayType } from '@nib/online'
import { subprotocol } from '@nib/rooms'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { askMachine } from '../src/machines/ask'
import { resumeOf } from '../src/machines/machine'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { doorway, fire, join, machine, nibd, say } from './machine-fakes'

const DEVICE = 'device-laptop'

/** Everybody 4.6's table is about: the machine's owner (who owns the space too), a
 *  writer and a reader of the space, and a guest at each role. */
const OWNER = 'owner@example.com'
const WRITER = 'writer@example.com'
const READER = 'reader@example.com'

let env: TestEnv
let door: ReturnType<typeof doorway>

const idOf = (email: string) =>
  (env.db.prepare('select id from users where email = ?').get(email) as { id: string }).id

async function session(email: string): Promise<string> {
  const token = await signIn(env, email)
  vi.setSystemTime(Date.now() + 31_000)
  return token
}

function serviceOn() {
  env.db.prepare("update online_service set value = 'on' where key = 'online'").run()
}

function allow(email: string) {
  env.db.prepare('update users set online = 1 where email = ?').run(email)
}

/** The owner's space with one `.term` file in it, a writer and a reader in it, and two
 *  guests let in by links. Answers the guests' tokens. */
async function world(): Promise<{
  owner: string
  writer: string
  reader: string
  guests: { write: string; read: string }
}> {
  const owner = await session(OWNER)
  const writer = await session(WRITER)
  const reader = await session(READER)
  const ownerId = idOf(OWNER)
  const run = (sql: string, ...values: (string | number)[]) => env.db.prepare(sql).run(...values)

  run(
    `insert into spaces (id, user_id, name, created_at, updated_at, blog_enabled)
     values ('space-1', ?, 'Team', 1, 1, 0)`,
    ownerId,
  )
  run(
    `insert into notes (id, space_id, path, seq, updated_at, size, hash)
     values ('term-1', 'space-1', 'Build.term', 1, 1, 0, 'h'),
            ('copy-1', 'space-1', 'Copy.term', 2, 1, 0, 'h')`,
  )
  run(
    `insert into space_members (space_id, email, item, role, created_at, joined_at)
     values ('space-1', ?, '', 'write', 1, 1), ('space-1', ?, '', 'read', 1, 1)`,
    WRITER,
    READER,
  )

  const guests = { write: 'guest-token-write', read: 'guest-token-read' }
  for (const [role, token] of Object.entries(guests)) {
    run(`insert into guests (id, name, created_at) values (?, 'Guest', 1)`, `guest-${role}`)
    run(
      'insert into guest_sessions (token_hash, guest_id, created_at, expires_at) values (?, ?, 1, 9e15)',
      await sha256(token),
      `guest-${role}`,
    )
    run(
      `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)
       values ('space-1', ?, '', ?, 1, 1)`,
      `guest-${role}`,
      role,
    )
  }
  return { owner, writer, reader, guests }
}

const knock = (term: string, token: string) =>
  call(env, `/v2/online/${term}/socket`, {
    headers: {
      upgrade: 'websocket',
      'sec-websocket-protocol': [subprotocol(token), `nib.device.${DEVICE}`].join(', '),
    },
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 5, 12))
  door = doorway()
  env = testEnv({ MACHINES: door.MACHINES })
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

describe('while the service is off', () => {
  test('every route and the socket answer 404, as routes that do not exist', async () => {
    const { owner } = await world()
    allow(OWNER)

    expect((await call(env, '/v2/online/machine', { token: owner })).status).toBe(404)
    expect(
      (await call(env, '/v2/online/terms', { token: owner, body: { term: 'term-1' } })).status,
    ).toBe(404)
    expect((await knock('term-1', owner)).status).toBe(404)
  })

  test('and without the Machine binding the switch alone does not turn it on', async () => {
    env = testEnv()
    const { owner } = await world()
    serviceOn()
    expect((await call(env, '/v2/online/machine', { token: owner })).status).toBe(404)
  })
})

describe('the allow-list and the switches', () => {
  test('Emil is on the list from the migration, by his account id', () => {
    env.db
      .prepare(
        "insert into users (id, email, created_at) values ('78180341-d10b-4bea-92dc-f327035ebfac', 'e@x.ch', 1)",
      )
      .run()
    // The migration ran before the row existed here; on the real database the row was
    // there first. What it names is the id, which is what is checked.
    const admin = env.db.prepare("select value from online_service where key = 'admin'").get() as {
      value: string
    }
    expect(admin.value).toBe('78180341-d10b-4bea-92dc-f327035ebfac')
    const service = env.db
      .prepare("select value from online_service where key = 'online'")
      .get() as {
      value: string
    }
    expect(service.value).toBe('off')
  })

  test('an account not on the list can make no session and start nothing', async () => {
    const { owner } = await world()
    serviceOn()
    expect(
      (await call(env, '/v2/online/terms', { token: owner, body: { term: 'term-1' } })).json,
    ).toEqual({ error: 'list' })
    expect((await call(env, '/v2/online/machine/start', { token: owner, body: {} })).status).toBe(
      403,
    )
  })

  test('a guest reaches no route, and a reader cannot make a session in the space', async () => {
    const { reader, guests } = await world()
    serviceOn()
    allow(READER)
    expect((await call(env, '/v2/online/machine', { token: guests.write })).status).toBe(403)
    expect(
      (await call(env, '/v2/online/terms', { token: reader, body: { term: 'term-1' } })).json,
    ).toEqual({ error: 'role' })
  })

  test('the budget breaker refuses a start past the ceiling', async () => {
    const { owner } = await world()
    serviceOn()
    allow(OWNER)
    env.db
      .prepare(
        "insert into machine_usage (user_id, month, awake_s, mem_gib_s) values ('someone', '2026-10', 1, 1e9)",
      )
      .run()
    const answer = await call(env, '/v2/online/machine/start', { token: owner, body: {} })
    expect(answer.status).toBe(409)
    expect(answer.json).toEqual({ error: 'budget' })
  })

  test('the admin switches are Emil’s alone', async () => {
    const { owner } = await world()
    expect(
      (await call(env, '/v2/online/admin/service', { token: owner, body: { online: true } }))
        .status,
    ).toBe(404)

    env.db.prepare("update online_service set value = ? where key = 'admin'").run(idOf(OWNER))
    const on = await call(env, '/v2/online/admin/service', {
      token: owner,
      body: { online: true, ceiling: 12 },
    })
    expect(on.json).toEqual({ online: true, ceiling: 12 })
  })
})

describe('the door', () => {
  async function made() {
    const people = await world()
    serviceOn()
    allow(OWNER)
    const term = await call<{ v: number; machine: string; session: string }>(
      env,
      '/v2/online/terms',
      { token: people.owner, body: { term: 'term-1' } },
    )
    expect(term.status).toBe(200)
    return { ...people, term: term.json }
  }

  test('a session is made once per file, on the maker’s own machine', async () => {
    const { owner, term } = await made()
    expect(term.v).toBe(1)
    const again = await call(env, '/v2/online/terms', { token: owner, body: { term: 'term-1' } })
    expect(again.json).toEqual(term)
  })

  test('lets in all five holders as what they are, and nobody may type but the owner', async () => {
    const { owner, writer, reader, guests, term } = await made()
    const seen: Record<string, { role: string; owns: string; guest: string; typing: string }> = {}

    for (const [name, token] of Object.entries({
      owner,
      writer,
      reader,
      guestWrite: guests.write,
      guestRead: guests.read,
    })) {
      door.asked.length = 0
      expect((await knock('term-1', token)).status, name).toBe(200)
      const [asked] = door.asked
      expect(asked?.id).toBe(term.machine)
      expect(asked?.headers.get('x-nib-session')).toBe(term.session)
      seen[name] = {
        role: asked?.headers.get('x-nib-role') ?? '',
        owns: asked?.headers.get('x-nib-owns') ?? '',
        guest: asked?.headers.get('x-nib-guest') ?? '',
        typing: asked?.headers.get('x-nib-typing') ?? '',
      }
    }

    expect(seen).toEqual({
      owner: { role: 'owner', owns: 'yes', guest: 'no', typing: 'owner' },
      writer: { role: 'write', owns: 'no', guest: 'no', typing: 'owner' },
      reader: { role: 'read', owns: 'no', guest: 'no', typing: 'owner' },
      guestWrite: { role: 'write', owns: 'no', guest: 'yes', typing: 'owner' },
      guestRead: { role: 'read', owns: 'no', guest: 'yes', typing: 'owner' },
    })

    // 4.6's table, both settings of `typing`, for each of the five.
    const types = (typing: 'owner' | 'writers') =>
      Object.fromEntries(
        Object.entries(seen).map(([name, one]) => [
          name,
          mayType(
            one.role as 'owner' | 'write' | 'read',
            one.guest === 'yes',
            one.owns === 'yes',
            typing,
          ),
        ]),
      )
    expect(types('owner')).toEqual({
      owner: true,
      writer: false,
      reader: false,
      guestWrite: false,
      guestRead: false,
    })
    expect(types('writers')).toEqual({
      owner: true,
      writer: true,
      reader: false,
      guestWrite: false,
      guestRead: false,
    })
  })

  test('only the owner’s socket may wake the machine', async () => {
    const { owner, writer } = await made()
    await knock('term-1', owner)
    expect(door.asked.at(-1)?.headers.get('x-nib-wake')).toBe('yes')
    await knock('term-1', writer)
    expect(door.asked.at(-1)?.headers.get('x-nib-wake')).toBe('no')
  })

  test('with no file id (a device on sync v1), a session of the owner’s alone', async () => {
    const { owner, writer } = await made()
    const alone = await call<{ v: number; machine: string; session: string }>(
      env,
      '/v2/online/terms',
      { token: owner, body: {} },
    )
    expect(alone.status).toBe(200)
    expect(alone.json.v).toBe(1)

    door.asked.length = 0
    expect((await knock(alone.json.session, owner)).status).toBe(200)
    expect(door.asked[0]?.headers.get('x-nib-owns')).toBe('yes')
    expect(door.asked[0]?.headers.get('x-nib-session')).toBe(alone.json.session)
    expect((await knock(alone.json.session, writer)).status).toBe(404)

    // Not on the list, not even that.
    const stranger = await session('stranger@example.com')
    expect((await call(env, '/v2/online/terms', { token: stranger, body: {} })).json).toEqual({
      error: 'list',
    })
  })

  test('a copied .term reaches nothing: access is the file’s id, never its text', async () => {
    const { owner } = await made()
    expect((await knock('copy-1', owner)).status).toBe(404)
  })

  test('a trashed file closes to everybody but the machine’s owner', async () => {
    const { owner, writer } = await made()
    env.db.prepare("update notes set deleted = 1 where id = 'term-1'").run()
    expect((await knock('term-1', writer)).status).toBe(404)
    expect((await knock('term-1', owner)).status).toBe(200)
  })

  test('a socket with no session is told to sign in, one with no role is told nothing', async () => {
    await made()
    expect((await knock('term-1', 'nobody')).status).toBe(401)
    const stranger = await session('stranger@example.com')
    expect((await knock('term-1', stranger)).status).toBe(404)
  })

  test('typing switched to writers is the owner’s to switch, and the machine is told', async () => {
    const { owner, writer, term } = await made()
    expect(
      (
        await call(env, '/v2/online/terms/term-1', {
          method: 'PATCH',
          token: writer,
          body: { typing: 'writers' },
        })
      ).status,
    ).toBe(404)
    door.asked.length = 0
    await call(env, '/v2/online/terms/term-1', {
      method: 'PATCH',
      token: owner,
      body: { typing: 'writers' },
    })
    expect(door.asked[0]?.headers.get('x-nib-machine')).toBe('typing')
    expect(door.asked[0]?.id).toBe(term.machine)
  })

  test('taking a writer out of the space tells the machine in the same request', async () => {
    const { owner, term } = await made()
    door.asked.length = 0
    const out = await call(env, `/v1/spaces/space-1/share/members/${encodeURIComponent(WRITER)}`, {
      method: 'DELETE',
      token: owner,
    })
    expect(out.status).toBeLessThan(300)
    const revoked = door.asked.find((one) => one.headers.get('x-nib-machine') === 'revoke')
    expect(revoked?.id).toBe(term.machine)
    expect(revoked?.headers.get('x-nib-who')).toBe(idOf(WRITER))
    expect(revoked?.headers.get('x-nib-terms')).toBe('term-1')
  })

  test('a ninth session is refused with the list of the eight', async () => {
    const { owner } = await made()
    for (let at = 2; at <= 9; at++) {
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, updated_at, size, hash)
           values (?, 'space-1', ?, ?, 1, 0, 'h')`,
        )
        .run(`term-${String(at)}`, `T${String(at)}.term`, at + 10)
    }
    for (let at = 2; at <= 8; at++) {
      const made_ = await call(env, '/v2/online/terms', {
        token: owner,
        body: { term: `term-${String(at)}` },
      })
      expect(made_.status).toBe(200)
    }
    const ninth = await call<{ error: string; sessions: string[] }>(env, '/v2/online/terms', {
      token: owner,
      body: { term: 'term-9' },
    })
    expect(ninth.status).toBe(409)
    expect(ninth.json.error).toBe('sessions')
    expect(ninth.json.sessions).toHaveLength(8)
  })
})

describe('a machine', () => {
  const ID = 'm_test'
  let user: string

  beforeEach(async () => {
    await world()
    serviceOn()
    allow(OWNER)
    user = idOf(OWNER)
    env.db.prepare('insert into machines (id, user_id, created_at) values (?, ?, 1)').run(ID, user)
    env.db
      .prepare(
        `insert into term_sessions (term, machine, session, user_id, created_at)
         values ('term-1', ?, 'session-1', ?, 1)`,
      )
      .run(ID, user)
  })

  const machineRow = () =>
    env.db.prepare('select * from machines where id = ?').get(ID) as Record<string, unknown>

  test('wakes for its owner’s socket, links nibd and opens the session', async () => {
    const running = await machine(env, ID, user)
    const socket = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')

    expect(await running.machine.state()).toBe('awake')
    expect(running.host.calls).toEqual(['start machine', 'link'])
    expect(socket.of('machine').at(-1)).toEqual({ t: 'machine', state: 'awake' })
    expect(machineRow().state).toBe('awake')

    // Woken before the socket said its size, so the session opens at the default and
    // takes the owner's size from their hello, before anybody typed.
    await say(running, socket, { t: 'hello', cols: 120, rows: 40 })
    expect(running.host.link_?.take()).toEqual([
      { t: 'open', session: 'session-1', cols: 80, rows: 24 },
      { t: 'want', session: 'session-1', since: 0 },
      { t: 'size', session: 'session-1', cols: 120, rows: 40 },
      { t: 'want', session: 'session-1', since: 0 },
    ])
  })

  test('does not wake for a watcher, nor for an owner the gate refuses', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: 'someone' })
    expect(await running.machine.state()).toBe('asleep')

    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'budget')
    expect(await running.machine.state()).toBe('asleep')
    expect(owner.of('refused')).toEqual([{ t: 'refused', error: 'budget' }])
  })

  test('fans output out, each socket from where it is, and a late joiner gets a screen', async () => {
    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    await say(running, owner, { t: 'hello', cols: 80, rows: 24 })
    const bytes = (text: string) => new TextEncoder().encode(text)

    await nibd(running, { t: 'out', session: 'session-1', seq: 0, data: bytes('hello') })
    await nibd(running, { t: 'out', session: 'session-1', seq: 5, data: bytes(' world') })
    expect(owner.bytes).toHaveLength(2)

    // A reader arriving later, having drawn nothing, gets a screen from nibd, then what
    // follows it, and nothing twice.
    const reader = await join(running, { who: 'reader' })
    await say(running, reader, { t: 'hello', cols: 80, rows: 24 })
    await nibd(running, {
      t: 'screen',
      session: 'session-1',
      seq: 11,
      cols: 80,
      rows: 24,
      data: 'hello world',
    })
    await nibd(running, { t: 'out', session: 'session-1', seq: 11, data: bytes('!') })
    expect(reader.of('screen')).toEqual([
      { t: 'screen', seq: 11, cols: 80, rows: 24, data: 'hello world' },
    ])
    expect(reader.bytes).toHaveLength(1)
    expect(owner.bytes).toHaveLength(3)
    // The owner, there from the start, was sent a cleared screen before the stream
    // from its first byte, and not the reader's screen.
    expect(owner.of('screen')).toEqual([{ t: 'screen', seq: 0, cols: 80, rows: 24, data: '' }])
  })

  test('refuses a reader’s keys and sends nothing of them down', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    const reader = await join(running, { who: 'reader', role: 'read' })
    running.host.link_?.take()

    await say(running, reader, { t: 'in', data: 'rm -rf ~\r' })
    expect(reader.of('refused')).toEqual([{ t: 'refused', error: 'role' }])
    expect(running.host.link_?.take()).toEqual([])
  })

  test('a writer types once typing is writers, and the pty takes the typist’s size', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    const writer = await join(running, { who: 'writer', role: 'write', cols: 60, rows: 20 })
    expect(writer.of('role').at(-1)).toEqual({ t: 'role', type: false })

    await running.machine.fetch(
      new Request('https://machine.invalid/typing', {
        headers: { 'x-nib-machine': 'typing', 'x-nib-term': 'term-1', 'x-nib-typing': 'writers' },
      }),
    )
    expect(writer.of('role').at(-1)).toEqual({ t: 'role', type: true })

    running.host.link_?.take()
    await say(running, writer, { t: 'in', data: 'ls\r' })
    const sent = running.host.link_?.take() ?? []
    expect(sent.find((one) => one.t === 'size')).toEqual({
      t: 'size',
      session: 'session-1',
      cols: 60,
      rows: 20,
    })
    expect(sent.find((one) => one.t === 'in')).toMatchObject({ t: 'in', session: 'session-1' })
    expect(writer.of('size').at(-1)).toEqual({ t: 'size', cols: 60, rows: 20, by: 'writer' })
  })

  test('revocation closes a socket at once, and a reader’s typing is taken away', async () => {
    const running = await machine(env, ID, user)
    const writer = await join(running, { who: 'writer', role: 'write', typing: 'writers' })
    const other = await join(running, { who: 'other', role: 'write', typing: 'writers' })

    await running.machine.fetch(
      new Request('https://machine.invalid/revoke', {
        headers: {
          'x-nib-machine': 'revoke',
          'x-nib-who': 'writer',
          'x-nib-role': 'none',
          'x-nib-terms': 'term-1',
        },
      }),
    )
    expect(writer.closedWith?.code).toBe(4403)

    await running.machine.fetch(
      new Request('https://machine.invalid/revoke', {
        headers: {
          'x-nib-machine': 'revoke',
          'x-nib-who': 'other',
          'x-nib-role': 'read',
          'x-nib-terms': 'term-1',
        },
      }),
    )
    expect(other.closedWith).toBeNull()
    expect(other.of('role').at(-1)).toEqual({ t: 'role', type: false })
  })

  test('the minute closes what the rows no longer let in, even when nobody said', async () => {
    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    const reader = await join(running, { who: idOf(READER), role: 'read' })
    env.db.prepare('delete from space_members where email = ?').run(READER)

    // Keep it busy so the minute does not also put it to sleep.
    await nibd(running, {
      t: 'activity',
      activity: { at: Date.now(), output: 10, cpu: 0, net: 0, homeBytes: 1000 },
    })
    vi.setSystemTime(Date.now() + 60_000)
    expect(await fire(running)).toBe(true)
    expect(reader.closedWith?.code).toBe(4403)
    expect(owner.closedWith).toBeNull()
  })

  test('sleeps 15 idle minutes after the last sign of use, saving as it goes', async () => {
    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    await nibd(running, {
      t: 'activity',
      activity: { at: Date.now(), output: 10, cpu: 0.5, net: 0, homeBytes: 4096 },
    })

    // Working, then watched: awake each minute until fifteen minutes of neither.
    for (let minute = 1; minute <= 15; minute++) {
      vi.setSystemTime(Date.now() + 60_000)
      await fire(running)
      expect(await running.machine.state(), `minute ${String(minute)}`).toBe('awake')
    }
    vi.setSystemTime(Date.now() + 60_000)
    await fire(running)

    expect(await running.machine.state()).toBe('asleep')
    expect(owner.of('machine').at(-1)).toEqual({ t: 'machine', state: 'asleep', reason: 'idle' })
    expect(running.host.calls).toEqual([
      'start machine',
      'link',
      'backup /home/nib',
      'snapshot',
      'stop',
    ])
    const row = machineRow()
    expect(row.snapshot).toBe('snap-1')
    expect(row.backup_key).toBe('backup-1.tar.zst')
    expect(row.home_bytes).toBe(4096)

    const usage = env.db.prepare('select * from machine_usage where user_id = ?').get(user) as {
      awake_s: number
      cpu_s: number
    }
    expect(usage.awake_s).toBe(16 * 60)
    expect(usage.cpu_s).toBeGreaterThan(0)

    const kinds = (
      env.db.prepare('select kind from machine_events where machine = ? order by id').all(ID) as {
        kind: string
      }[]
    ).map((one) => one.kind)
    expect(kinds).toEqual(expect.arrayContaining(['open', 'wake', 'backup', 'snapshot', 'sleep']))
  })

  test('wakes from its snapshot when it is good, and from the backup when it is not', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    await running.machine.sleep('stopped')
    running.host.calls.length = 0

    await running.machine.wake()
    expect(running.host.calls).toEqual(['restore snapshot snap-1', 'start machine', 'link'])

    await running.machine.sleep('stopped')
    running.host.calls.length = 0
    // Thirty-one days on, the snapshot is gone: a fresh system, the home put back.
    env.db
      .prepare('update machines set snapshot_at = ? where id = ?')
      .run(Date.now() - 31 * 24 * 3600_000, ID)
    await running.machine.wake()
    expect(running.host.calls[0]).toBe('start machine')
    expect(running.host.calls[1]).toMatch(/^restore backup .*backup-1/)
  })

  test('the service switched off stops every machine at its next minute', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    env.db.prepare("update online_service set value = 'off' where key = 'online'").run()
    vi.setSystemTime(Date.now() + 60_000)
    await fire(running)
    expect(await running.machine.state()).toBe('asleep')
  })

  test('the account taken off the list stops its machine at its next minute', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    env.db.prepare('update users set online = 0 where id = ?').run(user)
    vi.setSystemTime(Date.now() + 60_000)
    await fire(running)
    expect(await running.machine.state()).toBe('asleep')
  })

  test('a hold stops it and keeps it stopped', async () => {
    const running = await machine(env, ID, user)
    await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    env.db.prepare("update machines set held = 'flag' where id = ?").run(ID)
    vi.setSystemTime(Date.now() + 60_000)
    await fire(running)
    expect(await running.machine.state()).toBe('asleep')

    await running.machine.wake()
    expect(await running.machine.state()).toBe('asleep')
  })

  test('the budget breaker gives an awake machine ten minutes and a line, then sleeps it', async () => {
    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    env.db
      .prepare(
        "insert into machine_usage (user_id, month, awake_s, mem_gib_s) values ('someone', '2026-10', 1, 1e9)",
      )
      .run()

    vi.setSystemTime(Date.now() + 60_000)
    await fire(running)
    expect(await running.machine.state()).toBe('awake')
    expect(owner.of('machine').at(-1)).toEqual({ t: 'machine', state: 'awake', reason: 'budget' })

    for (let minute = 0; minute < 10; minute++) {
      vi.setSystemTime(Date.now() + 60_000)
      await fire(running)
    }
    expect(await running.machine.state()).toBe('asleep')
    expect(owner.of('machine').at(-1)).toEqual({ t: 'machine', state: 'asleep', reason: 'budget' })
  })

  test('Resume types the agent’s own continue command, for the owner alone', async () => {
    expect(resumeOf('claude')).toBe('claude --continue\r')
    expect(resumeOf('codex')).toBe('codex resume --last\r')
    expect(resumeOf('bash')).toBeNull()

    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    const writer = await join(running, { who: 'writer', role: 'write', typing: 'writers' })
    await nibd(running, {
      t: 'screen',
      session: 'session-1',
      seq: 0,
      cols: 80,
      rows: 24,
      data: '',
      restored: { at: 1, program: 'claude' },
    })
    running.host.link_?.take()

    await say(running, writer, { t: 'resume' })
    expect(writer.of('refused')).toEqual([{ t: 'refused', error: 'role' }])

    await say(running, owner, { t: 'resume' })
    const typed = running.host.link_?.take().find((one) => one.t === 'in')
    expect(typed && 'data' in typed && new TextDecoder().decode(typed.data)).toBe(
      'claude --continue\r',
    )
  })

  test('the audit never holds what anybody typed or saw', async () => {
    const secret = 'sk-ant-THIS-IS-A-SECRET-0123456789'
    const running = await machine(env, ID, user)
    const owner = await join(running, { who: user, owns: true, role: 'owner' }, 'yes')
    await say(running, owner, { t: 'hello', cols: 80, rows: 24 })
    await say(running, owner, { t: 'in', data: `export KEY=${secret}\r` })
    await running.machine.webSocketMessage(
      owner as unknown as WebSocket,
      new TextEncoder().encode(secret).buffer as ArrayBuffer,
    )
    await nibd(running, {
      t: 'out',
      session: 'session-1',
      seq: 0,
      data: new TextEncoder().encode(secret),
    })
    await running.machine.sleep('stopped')

    const tables = (
      env.db.prepare("select name from sqlite_master where type = 'table'").all() as {
        name: string
      }[]
    ).map((one) => one.name)
    for (const table of tables) {
      if (table.startsWith('sqlite_') || table.includes('_search')) continue
      const rows = JSON.stringify(env.db.prepare(`select * from ${table}`).all())
      expect(rows.includes('THIS-IS-A-SECRET'), table).toBe(false)
    }
    for (const value of running.state.kept.values()) {
      expect(JSON.stringify(value).includes('THIS-IS-A-SECRET')).toBe(false)
    }
  })

  test('a route reaches the machine in the EU jurisdiction where there is one', async () => {
    const asked: string[] = []
    const eu = {
      idFromName: (name: string) => name,
      get: (id: unknown) => ({
        fetch: () => {
          asked.push(`eu ${String(id)}`)
          return Promise.resolve(new Response(null, { status: 204 }))
        },
      }),
    }
    const namespace = { ...eu, jurisdiction: (where: string) => (where === 'eu' ? eu : null) }
    const placed = testEnv({ MACHINES: namespace as unknown as DurableObjectNamespace })
    await askMachine(placed, ID, 'state')
    expect(asked).toEqual([`eu ${ID}`])
    placed.close()
  })
})

describe('the hub’s machine frame', () => {
  test('reaches every device of the owner, and no guest', async () => {
    const { hub, connect } = await import('./hub-fakes')
    const { hub: made } = hub(env)
    const laptop = connect(made, { device: 'device-laptop', who: 'owner-id' })
    const guest = connect(made, { device: 'device-guest', who: 'owner-id', guest: true })

    await made.fetch(
      new Request('https://hub.invalid/machine', {
        headers: { 'x-nib-hub': 'machine', 'x-nib-state': 'starting' },
      }),
    )
    expect(laptop.take()).toEqual([{ t: 'machine', state: 'starting' }])
    expect(guest.take()).toEqual([])

    const { hubFrameOf } = await import('@nib/sync-core/wire')
    expect(hubFrameOf({ t: 'machine', state: 'awake' })).toEqual({ t: 'machine', state: 'awake' })
    expect(hubFrameOf({ t: 'machine', state: 'melting' })).toBeNull()
  })
})

describe('the dev host', () => {
  test('drives a nibd on this computer and refuses any other address', async () => {
    const { DevHost } = await import('../src/machines/host')
    const local = testEnv({ MACHINE_DEV_NIBD: 'http://127.0.0.1:8080', MACHINE_DEV_SECRET: 's' })
    const remote = testEnv({ MACHINE_DEV_NIBD: 'http://203.0.113.9:8080' })
    expect(DevHost.of(local)).toBeInstanceOf(DevHost)
    expect(DevHost.of(remote)).toBeNull()
    expect(DevHost.of(env)).toBeNull()
    local.close()
    remote.close()
  })
})
