/** The ceilings, and what runs out: how much mail one machine can cause, how
 *  many people the service writes to in a day, how often an owner hears that
 *  somebody is waiting, how many may be waiting at all, and what the nightly
 *  sweep takes away once nobody is waiting for it any more.
 *
 *  Every gate here is about the service rather than about one account, so each
 *  case is driven the way the outside drives it: a request with a
 *  `CF-Connecting-IP` header, or the rows a day of sending would have left. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { expireGuests } from '../src/guests'
import { expireRequests } from '../src/spaces/share'
import { call, mail, signIn, testEnv, type JoinView, type ShareView, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => env.close())

/** Asking for a sign-in code, from a machine or from nowhere in particular. */
function askForACode(email: string, machine?: string) {
  return call(env, '/v1/auth/code', {
    body: { email },
    ...(machine ? { headers: { 'cf-connecting-ip': machine } } : {}),
  })
}

/** Which day the ceiling counts in, worked out the way limits.ts works it out. */
function today(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000))
}

/** A day's worth of sending already done, as the rows it would have left. */
function alreadyMailed(many: number): void {
  const insert = env.db.prepare('insert into mailed_days (day, email) values (?, ?)')
  for (let at = 0; at < many; at++) insert.run(today(), `already-${at}@example.com`)
}

function countedIn(scope: string): number {
  const row = env.db.prepare('select count(*) as held from limits where scope = ?').get(scope) as {
    held: number
  }
  return row.held
}

describe('mail from one machine', () => {
  test('stops at a number of messages an hour', async () => {
    for (let at = 0; at < 20; at++) {
      expect((await askForACode(`one-${at}@example.com`, '203.0.113.7')).status).toBe(200)
    }

    const refused = await askForACode('one-more@example.com', '203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too many messages from here - try again later')
  })

  test('counts the machine and not the address', async () => {
    for (let at = 0; at < 20; at++) await askForACode(`one-${at}@example.com`, '203.0.113.7')

    // Somebody else, somewhere else, is not held to what that machine spent.
    expect((await askForACode('elsewhere@example.com', '198.51.100.4')).status).toBe(200)
  })

  test('does not hold a resend against it, since no message goes out', async () => {
    await askForACode('same@example.com', '203.0.113.7')
    for (let at = 0; at < 30; at++) await askForACode('same@example.com', '203.0.113.7')

    // The address keeps its own gap, and the machine spent one message.
    expect((await askForACode('another@example.com', '203.0.113.7')).status).toBe(200)
  })

  test('is not counted at all where there is no machine to count', async () => {
    for (let at = 0; at < 25; at++) {
      expect((await askForACode(`nowhere-${at}@example.com`)).status).toBe(200)
    }
  })

  test('keeps one row per machine, cleared once its window has run out', async () => {
    await askForACode('one@example.com', '203.0.113.7')
    await askForACode('two@example.com', '203.0.113.7')
    expect(countedIn('mail')).toBe(1)

    env.db.prepare('update limits set until = ? where scope = ?').run(Date.now() - 1, 'mail')
    await askForACode('three@example.com', '198.51.100.4')

    expect(countedIn('mail')).toBe(1)
  })
})

describe('the people the service writes to in a day', () => {
  test('stops at a number of them', async () => {
    alreadyMailed(500)

    const refused = await askForACode('new@example.com', '203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')
  })

  test('still writes to somebody it has written to today', async () => {
    alreadyMailed(500)
    env.db.prepare('insert into mailed_days (day, email) values (?, ?)').run(today(), 'a@b.dev')

    // An address already in today's set is not one more person to write to.
    const sent = await mail(() => askForACode('a@b.dev', '203.0.113.7'))
    expect(sent).toMatch(/\d{3} \d{3}/)
  })

  test('forgets yesterday as today arrives', async () => {
    const insert = env.db.prepare('insert into mailed_days (day, email) values (?, ?)')
    for (let at = 0; at < 600; at++) insert.run(today() - 1, `yesterday-${at}@example.com`)

    expect((await askForACode('today@example.com', '203.0.113.7')).status).toBe(200)

    const left = env.db.prepare('select count(*) as held from mailed_days').get() as {
      held: number
    }
    expect(left.held).toBe(1)
  })

  test('holds an invitation to the same ceiling, before it writes anything', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json
      .space.id

    alreadyMailed(500)

    const refused = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: 'guest@example.com', role: 'write' },
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })

    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')

    // Nothing was written, so the sheet does not show somebody the owner was
    // told could not be reached.
    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.members).toEqual([])
  })
})

/** The thirty seconds an address keeps between two codes, moved on, the way a
 *  flood from outside waits it out. */
function gapPassed(): void {
  env.db.prepare('update login_codes set sent_at = 0').run()
  env.db.prepare('delete from mailed').run()
}

/** A machine each time, as a flood spread over several would arrive. */
function fromSomewhere(at: number): string {
  return `198.51.100.${at + 1}`
}

describe('mail to one address', () => {
  test('stops at a few messages an hour, however many machines ask', async () => {
    for (let at = 0; at < 6; at++) {
      gapPassed()
      expect((await askForACode('victim@example.com', fromSomewhere(at))).status).toBe(200)
    }

    gapPassed()
    const refused = await askForACode('victim@example.com', fromSomewhere(6))
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too many tries - try again in an hour')
  })

  test('does not hold another address to what that one was sent', async () => {
    for (let at = 0; at < 10; at++) {
      gapPassed()
      await askForACode('victim@example.com', fromSomewhere(at))
    }

    // From one of the very machines that did the flooding, even.
    const sent = await mail(() => askForACode('bystander@example.com', fromSomewhere(0)))
    expect(sent).toMatch(/\d{3} \d{3}/)
  })

  test('and a day of them stops at a ceiling of its own', async () => {
    for (let hour = 0; hour < 4; hour++) {
      for (let at = 0; at < 6; at++) {
        gapPassed()
        expect((await askForACode('victim@example.com', fromSomewhere(at))).status).toBe(200)
      }
      // The hour ends and the day does not.
      env.db.prepare('update limits set until = ? where scope = ?').run(Date.now() - 1, 'mail-to')
    }

    gapPassed()
    const refused = await askForACode('victim@example.com', fromSomewhere(7))
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')
  })

  test('counts every kind of message, and keeps quiet to somebody inviting it', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json
      .space.id

    for (let at = 0; at < 6; at++) {
      gapPassed()
      await askForACode('victim@example.com', fromSomewhere(at))
    }

    gapPassed()
    let answer = { status: 0 }
    const sent = await mail(async () => {
      answer = await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: 'victim@example.com', role: 'write' },
      })
    })

    // The invitation stands and nothing went: the owner is not told that somebody
    // else has been writing to that address.
    expect(answer.status).toBe(200)
    expect(sent).not.toContain('shared Plans with you')
    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.members.map((one) => one.email)).toEqual(['victim@example.com'])
  })
})

/** Messages sent in the last day, as the hourly rows they would have left. */
function alreadySent(many: number, until = Date.now() + 60 * 60 * 1000): void {
  env.db
    .prepare(`insert into limits (scope, key, count, until) values ('mail-sent', 'earlier', ?, ?)`)
    .run(many, until)
}

function sentToday(): number {
  const row = env.db
    .prepare(`select coalesce(sum(count), 0) as sent from limits where scope = 'mail-sent'`)
    .get() as { sent: number }
  return row.sent
}

describe('the mail the service sends in a day', () => {
  test('is counted once for each message that goes', async () => {
    await askForACode('one@example.com', '203.0.113.7')
    await askForACode('two@example.com', '203.0.113.7')
    expect(sentToday()).toBe(2)
  })

  test('says no before the provider would, with when to come back', async () => {
    alreadySent(900)

    const refused = await askForACode('new@example.com', '203.0.113.7')
    expect(refused.status).toBe(503)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')

    const wait = Number(refused.headers.get('retry-after'))
    expect(wait).toBeGreaterThan(3500)
    expect(wait).toBeLessThanOrEqual(3600)
  })

  test('holds an invitation too, before it writes anything', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json
      .space.id

    alreadySent(900)

    const refused = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: 'guest@example.com', role: 'write' },
    })
    expect(refused.status).toBe(503)
    expect(refused.headers.get('retry-after')).toBeTruthy()

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.members).toEqual([])
  })

  test('is not spent by one address being flooded', async () => {
    for (let at = 0; at < 30; at++) {
      gapPassed()
      await askForACode('victim@example.com', fromSomewhere(at % 10))
    }

    // Six went, and only those six count against everybody else's sign-in.
    expect(sentToday()).toBe(6)
  })

  test('rolls on as the oldest hour stops counting', async () => {
    alreadySent(900, Date.now() - 1)

    expect((await askForACode('new@example.com', '203.0.113.7')).status).toBe(200)
  })
})

describe('telling an owner that somebody is waiting', () => {
  let owner: string
  let space: string
  let link: string

  beforeEach(async () => {
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id

    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })

    link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    expect(link).toBeTruthy()
  })

  /** Somebody following the link that asks first, with no session at all. */
  function knock(name: string) {
    return call(env, `/v1/join/${link}`, { method: 'POST', body: { name, device: 'Windows' } })
  }

  test('happens once an hour however many people knock', async () => {
    const sent = await mail(async () => {
      for (let at = 0; at < 5; at++) await knock(`Someone ${at}`)
    })

    expect(sent.match(/would like to join/g)).toHaveLength(1)
  })

  test('and every one of them is still waiting on the owner', async () => {
    await mail(async () => {
      for (let at = 0; at < 5; at++) expect((await knock(`Someone ${at}`)).json.waiting).toBe(true)
    })

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.requests).toHaveLength(5)
  })

  test('again once the hour has passed', async () => {
    await mail(() => knock('First'))

    // Both waits are moved on: the hour this ceiling keeps, and the thirty
    // seconds the owner's own address keeps between any two messages.
    env.db.prepare('update limits set until = ? where scope = ?').run(Date.now() - 1, 'waiting')
    env.db.prepare('delete from mailed').run()

    const sent = await mail(() => knock('Second'))
    expect(sent).toContain('would like to join')
  })
})

describe('how many people may be waiting on one space', () => {
  const MONTH = 30 * 24 * 60 * 60 * 1000

  let owner: string
  let space: string
  let link: string

  beforeEach(async () => {
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id

    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })

    link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
  })

  function knock(name: string) {
    return call(env, `/v1/join/${link}`, { method: 'POST', body: { name, device: 'Windows' } })
  }

  /** People already waiting, as the rows their knocking left. Guests, because a
   *  link that asks first is the way most of them arrive, and an hour ago by
   *  default so that the burst the link also bounds is not what answers. */
  function waiting(many: number, at = Date.now() - 60 * 60 * 1000) {
    const guest = env.db.prepare('insert into guests (id, name, created_at) values (?, ?, ?)')
    const member = env.db.prepare(
      `insert into guest_members (space_id, guest_id, role, joined_at, created_at)
       values (?, ?, 'read', null, ?)`,
    )

    for (let one = 0; one < many; one++) {
      guest.run(`guest-${one}`, `Someone ${one}`, at)
      member.run(space, `guest-${one}`, at)
    }
  }

  test('stops at as many as the sheet can show the owner', async () => {
    waiting(200)

    const refused = await mail(() => knock('One more'))
    const answer = await knock('One more again')
    expect(answer.status).toBe(429)
    expect(answer.json.error).toBe('that many people are already waiting to be let in')
    expect(refused).not.toContain('would like to join')
  })

  test('and counts an account that followed the same link', async () => {
    waiting(199)
    const guest = await signIn(env, 'guest@example.com')

    expect((await call(env, `/v1/join/${link}`, { method: 'POST', token: guest })).status).toBe(200)

    const another = await signIn(env, 'another@example.com')
    expect((await call(env, `/v1/join/${link}`, { method: 'POST', token: another })).status).toBe(
      429,
    )
  })

  test('lets the next person in once the waiting has run out', async () => {
    waiting(200, Date.now() - MONTH - 1000)

    expect(await expireGuests(env, Date.now())).toBe(400)
    expect((await knock('One more')).json.waiting).toBe(true)
  })

  test('and the guests nobody answered are nobody again', async () => {
    waiting(3, Date.now() - MONTH - 1000)
    await expireGuests(env, Date.now())

    const left = env.db.prepare('select count(*) as held from guests').get() as { held: number }
    expect(left.held).toBe(0)
  })

  test('keeps a guest who is in the space, however long ago they arrived', async () => {
    const long = Date.now() - 10 * MONTH
    env.db
      .prepare('insert into guests (id, name, created_at) values (?, ?, ?)')
      .run('resident', 'Resident', long)
    env.db
      .prepare(
        `insert into guest_members (space_id, guest_id, role, joined_at, created_at)
         values (?, 'resident', 'read', ?, ?)`,
      )
      .run(space, long, long)

    expect(await expireGuests(env, Date.now())).toBe(0)

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.members).toHaveLength(1)
  })

  test('lets go of a request an account made and nobody answered', async () => {
    const guest = await signIn(env, 'guest@example.com')
    await call(env, `/v1/join/${link}`, { method: 'POST', token: guest })

    expect(await expireRequests(env, Date.now())).toBe(0)

    env.db.prepare('update space_requests set created_at = ?').run(Date.now() - MONTH - 1000)
    expect(await expireRequests(env, Date.now())).toBe(1)

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.requests).toEqual([])
  })
})

describe('how many guests one space holds', () => {
  let owner: string
  let space: string
  let link: string

  beforeEach(async () => {
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id

    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })

    link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
  })

  /** Guests of the space, at whatever standing and whenever they arrived. */
  function guests(many: number, options: { joined: boolean; at?: number }) {
    const at = options.at ?? Date.now()
    const guest = env.db.prepare('insert into guests (id, name, created_at) values (?, ?, ?)')
    const member = env.db.prepare(
      `insert into guest_members (space_id, guest_id, role, joined_at, declined_at, created_at)
       values (?1, ?2, 'read', ?3, ?4, ?5)`,
    )

    for (let one = 0; one < many; one++) {
      guest.run(`guest-${one}`, `Someone ${one}`, at)
      member.run(space, `guest-${one}`, options.joined ? at : null, options.joined ? null : at, at)
    }
  }

  function follow() {
    return call<JoinView>(env, `/v1/join/${link}`, { method: 'POST', body: { device: 'Windows' } })
  }

  test('stops the link once that many are in it', async () => {
    guests(200, { joined: true, at: Date.now() - 60 * 60 * 1000 })

    const refused = await follow()
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('that link is busy, try again in a minute')
  })

  test('does not count the ones who were told no, which used to shut it for good', async () => {
    // Two hundred people knocked on this link a year ago and the owner said no to
    // every one of them. The link is not spent; nobody is in the space.
    guests(200, { joined: false, at: Date.now() - 60 * 60 * 1000 })

    expect((await follow()).status).toBe(200)
  })

  test('still stops a burst of them in one minute', async () => {
    guests(20, { joined: true })

    expect((await follow()).status).toBe(429)
  })
})
