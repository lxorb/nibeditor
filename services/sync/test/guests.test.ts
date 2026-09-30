/** Getting in without signing in.
 *
 *  Three links and three ways through them, all at `POST /v1/join/:token`: an
 *  invitation, which is proof of the address it was mailed to; an open link,
 *  which is proof of nothing and hands out a guest; and a link that asks first,
 *  which is the same guest with the owner in front of it. Then what a guest can
 *  and cannot reach, and the two ways one turns into an account.
 *
 *  What is under test is that nobody types anything. Every case here that lands
 *  in a space lands in it with no code, no password and, but for the one field a
 *  link that asks first asks for, no form at all. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, mail, signIn, testEnv, type JoinView, type ShareView, type TestEnv } from './harness'

const OWNER = 'owner@example.com'
const GUEST = 'guest@example.com'
const STRANGER = 'nobody@example.com'
const SHARED = 'Plans'
/** A lease key, as a device makes one: an HMAC nobody but its computers can read. */
const WEB_KEY = 'k'.repeat(43)

let env: TestEnv
let owner: string
let space: string
let note: string

beforeEach(async () => {
  env = testEnv()
  owner = await signIn(env, OWNER)
  await call(env, '/v1/me', { method: 'PATCH', token: owner, body: { name: 'Emil' } })

  space = (await call(env, '/v1/spaces', { token: owner, body: { name: SHARED } })).json.space.id
  note = (
    await call(env, `/v1/spaces/${space}/notes`, {
      token: owner,
      body: { path: 'plan.md', content: '# Plan\n' },
    })
  ).json.note.id
})

afterEach(() => env.close())

/** The space's own link, set to hand out this role in this mode. */
async function shareLink(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
  const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
    method: 'PUT',
    token: owner,
    body: { role, mode },
  })

  const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
  if (!found?.[1]) throw new Error('no link was made')
  return found[1]
}

/** The token in the link an invitation mail carried. */
async function inviteLink(email: string, role: 'write' | 'read'): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite`, { token: owner, body: { email, role } }),
  )

  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)
  return found[1]
}

/** Following a link, as whoever is at the browser: nobody, a guest, an account. */
function follow(token: string, options: { as?: string; body?: unknown } = {}) {
  return call(env, `/v1/join/${token}`, {
    method: 'POST',
    ...(options.as ? { token: options.as } : {}),
    ...(options.body === undefined ? {} : { body: options.body }),
  })
}

function shareView() {
  return call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
}

function rail(as: string) {
  return call(env, '/v1/spaces', { token: as })
}

/* ── An invitation is its own proof ───────────────────────────────────── */

describe('the link in an invitation', () => {
  test('opens the space with nothing typed at all', async () => {
    const link = await inviteLink(GUEST, 'write')
    const { status, json } = await follow(link)

    expect(status).toBe(200)
    expect(json.token).toBeTruthy()
    expect(json.user.email).toBe(GUEST)
    expect(json.space.name).toBe(SHARED)
    expect(json.space.role).toBe('write')

    // And the session it handed back is a real one, on a real account.
    const { json: rails } = await rail(json.token)
    expect(rails.spaces.map((one) => [one.name, one.role])).toEqual([
      ['Notes', 'owner'],
      [SHARED, 'write'],
    ])
  })

  test('makes the account for an address that has never been used', async () => {
    const link = await inviteLink('later@example.com', 'read')
    const { json } = await follow(link)

    // Made on the spot, with the space every new account starts with.
    expect(json.user.email).toBe('later@example.com')
    const { json: rails } = await rail(json.token)
    expect(rails.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('opens the account that address already had', async () => {
    const already = await signIn(env, GUEST)
    const mine = (await call(env, '/v1/spaces', { token: already, body: { name: 'Mine' } })).json
      .space.id

    const { json } = await follow(await inviteLink(GUEST, 'read'))

    const { json: rails } = await rail(json.token)
    expect(rails.spaces.map((one) => one.id)).toContain(mine)
  })

  test('is in the space the moment it is followed, not pending', async () => {
    const link = await inviteLink(GUEST, 'read')
    expect((await shareView()).json.members[0]?.pending).toBe(true)

    await follow(link)
    expect((await shareView()).json.members[0]?.pending).toBe(false)
  })

  test('works once, and says so afterwards', async () => {
    const link = await inviteLink(GUEST, 'write')
    expect((await follow(link)).status).toBe(200)

    // A session for an address nobody typed a code for is spent when it works.
    expect((await follow(link)).status).toBe(404)
    const { status, json } = await call<JoinView>(env, `/v1/join/${link}`)
    expect(status).toBe(404)
    expect(json.error).toBe('that link has expired')
  })

  test('leaves the code as the way in once it has been used', async () => {
    const link = await inviteLink(GUEST, 'write')
    await follow(link)

    // The membership was never the link's to take away.
    const token = await signIn(env, GUEST)
    expect((await rail(token)).json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('opens nothing once it has run out', async () => {
    const link = await inviteLink(GUEST, 'write')
    env.db.exec('update space_members set expires_at = 1')

    expect((await follow(link)).status).toBe(404)
  })

  test('still refuses an account signed in as somebody else', async () => {
    const link = await inviteLink(GUEST, 'read')
    const stranger = await signIn(env, STRANGER)

    const { status, json } = await follow(link, { as: stranger })
    expect(status).toBe(403)
    expect(json.error).toBe('that invitation was sent to another address')
  })

  test('changes nothing on a GET, which is what a mail client follows', async () => {
    const link = await inviteLink(GUEST, 'read')
    await call(env, `/v1/join/${link}`)

    // Still pending, and the link still works.
    expect((await shareView()).json.members[0]?.pending).toBe(true)
    expect((await follow(link)).status).toBe(200)
  })
})

/* ── An open link asks nothing ────────────────────────────────────────── */

describe('a link anybody may follow', () => {
  test('hands out a guest, in the space, at once', async () => {
    const link = await shareLink('write', 'open')
    const { status, json } = await follow(link, { body: { device: 'iPhone' } })

    expect(status).toBe(200)
    expect(json.token).toBeTruthy()
    expect(json.space.name).toBe(SHARED)
    expect(json.space.role).toBe('write')
    // Named from the device, the way the carets name devices.
    expect(json.guest.name).toMatch(/^iPhone \w+$/)
  })

  test('takes a guest that names no device, and still names them', async () => {
    const { json } = await follow(await shareLink('read', 'open'))
    expect(json.guest.name).toMatch(/^Guest \w+$/)
  })

  test('lets that guest read the note, and write in it when the link says write', async () => {
    const { json } = await follow(await shareLink('write', 'open'))

    const read = await call(env, `/v1/notes/${note}`, { token: json.token })
    expect(read.status).toBe(200)
    expect(read.json.content).toBe('# Plan\n')

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: json.token,
      body: { content: 'from a guest' },
    })
    expect(wrote.status).toBe(200)
  })

  test('refuses the keystroke when the link says read', async () => {
    const { json } = await follow(await shareLink('read', 'open'))

    expect((await call(env, `/v1/notes/${note}`, { token: json.token })).status).toBe(200)
    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: json.token,
      body: { content: 'nope' },
    })
    expect(wrote.status).toBe(403)
    expect(wrote.json.error).toBe('you can only read this space')
  })

  test('lists the one space and nothing else', async () => {
    const { json } = await follow(await shareLink('read', 'open'))

    const { json: rails } = await rail(json.token)
    expect(rails.spaces.map((one) => [one.name, one.role, one.shared])).toEqual([
      [SHARED, 'read', true],
    ])
  })

  test('keeps the guest across requests, and says who they are', async () => {
    const { json } = await follow(await shareLink('read', 'open'), { body: { device: 'Android' } })

    const me = await call(env, '/v1/me', { token: json.token })
    expect(me.json.guest).toEqual({ id: json.guest.id, name: json.guest.name })
    // A guest is not an account and is never answered as one.
    expect(me.json.user).toBeUndefined()
  })

  test('lets the guest rename themselves, so a caret carries a real name', async () => {
    const { json } = await follow(await shareLink('write', 'open'))

    const named = await call(env, '/v1/me', {
      method: 'PATCH',
      token: json.token,
      body: { name: '  Ada   Lovelace ' },
    })
    expect(named.json.guest.name).toBe('Ada Lovelace')
    expect((await call(env, '/v1/me', { token: json.token })).json.guest.name).toBe('Ada Lovelace')
  })

  test('keeps the name they had when the field comes back empty', async () => {
    const { json } = await follow(await shareLink('write', 'open'))

    const named = await call(env, '/v1/me', {
      method: 'PATCH',
      token: json.token,
      body: { name: '   ' },
    })
    expect(named.json.guest.name).toBe(json.guest.name)
  })

  test('shows the guest to the owner, and marks the space as shared', async () => {
    const { json } = await follow(await shareLink('write', 'open'), { body: { device: 'Windows' } })

    const { json: who } = await shareView()
    expect(who.members).toEqual([
      { email: null, guest: json.guest.id, name: json.guest.name, role: 'write', pending: false },
    ])

    const { json: rails } = await rail(owner)
    expect(rails.spaces.find((one) => one.id === space)?.shared).toBe(true)
  })

  test('takes one guest per link followed, not one per request', async () => {
    const link = await shareLink('read', 'open')
    const first = await follow(link)
    const again = await follow(link, { as: first.json.token })

    expect(again.json.guest.id).toBe(first.json.guest.id)
    expect(again.json.space.name).toBe(SHARED)
    expect((await shareView()).json.members).toHaveLength(1)
  })

  /** Two tabs of the same guest arriving together. What `guestStanding` read a
   *  moment ago is not a lock on the row, so the second write met the first and
   *  came back as a 500. The other tab's row goes in at the one moment that
   *  matters; see `justBefore`. */
  test('one guest at the link twice at once is still one row', async () => {
    const link = await shareLink('read', 'open')
    const arrived = await follow(link)
    const guest = arrived.json.guest.id

    env.db.prepare('delete from guest_members where guest_id = ?').run(guest)
    env.justBefore(/insert into guest_members/, () => {
      env.db
        .prepare(
          'insert into guest_members (space_id, guest_id, role, joined_at, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(space, guest, 'read', Date.now(), Date.now())
    })

    const again = await follow(link, { as: arrived.json.token })
    expect(again.status).not.toBe(500)
    expect((await shareView()).json.members).toHaveLength(1)
  })

  test('opens nothing once it is revoked, and ends what it opened', async () => {
    const link = await shareLink('read', 'open')
    const { json } = await follow(link)

    await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: owner })

    // The link is gone. The guest keeps what it was given, the way a member does
    // when the link they came through is revoked.
    expect((await follow(link)).status).toBe(404)
    expect((await call(env, `/v1/notes/${note}`, { token: json.token })).status).toBe(200)
  })

  test('stops taking guests when it has taken a crowd in a minute', async () => {
    const link = await shareLink('read', 'open')

    let refused = 0
    for (let attempt = 0; attempt < 22; attempt++) {
      if ((await follow(link)).status === 429) refused++
    }

    expect(refused).toBeGreaterThan(0)
  })
})

/* ── A link that asks first asks one field ────────────────────────────── */

describe('a link that asks first', () => {
  test('says it will ask, before anybody has followed it', async () => {
    const link = await shareLink('read', 'approval')
    const { json } = await call<JoinView>(env, `/v1/join/${link}`)

    expect(json).toMatchObject({ kind: 'link', space: SHARED, asks: true, from: 'Emil' })
  })

  test('will not take somebody who says nothing about themselves', async () => {
    const link = await shareLink('read', 'approval')
    const { status, json } = await follow(link, { body: { device: 'Windows' } })

    expect(status).toBe(400)
    expect(json.error).toBe('say who you are')
  })

  test('takes a name, and leaves them waiting', async () => {
    const link = await shareLink('write', 'approval')
    const { json } = await follow(link, { body: { name: 'Ada' } })

    expect(json.waiting).toBe(true)
    expect(json.space).toBeUndefined()
    expect(json.token).toBeTruthy()

    // Waiting is not being in.
    expect((await call(env, `/v1/notes/${note}`, { token: json.token })).status).toBe(404)
    expect((await rail(json.token)).json.spaces).toEqual([])
  })

  test('shows the owner who is waiting, and what they said', async () => {
    const link = await shareLink('write', 'approval')
    const sent = await mail(() => follow(link, { body: { email: 'Ada@Example.com' } }))

    expect(sent).toContain(OWNER)
    expect(sent).toContain(`would like to join ${SHARED}`)

    const { json } = await shareView()
    expect(json.requests).toHaveLength(1)
    expect(json.requests[0]).toMatchObject({
      email: 'ada@example.com',
      name: 'ada@example.com',
      role: 'write',
    })
    expect(json.requests[0]?.guest).toBeTruthy()
    expect(json.members).toEqual([])
  })

  test('turns into the space when the owner accepts, at the role it promised', async () => {
    const link = await shareLink('write', 'approval')
    const { json } = await follow(link, { body: { name: 'Ada' } })

    // The link changes afterwards; what was promised stands.
    await shareLink('read', 'approval')
    const guest = (await shareView()).json.requests[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${guest}`, { method: 'POST', token: owner })

    // Asking again is how the page waiting on it finds out.
    const again = await follow(link, { as: json.token })
    expect(again.json.space.name).toBe(SHARED)
    expect(again.json.space.role).toBe('write')

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: json.token,
      body: { content: 'let in' },
    })
    expect(wrote.status).toBe(200)
  })

  test('says so when the owner declines', async () => {
    const link = await shareLink('read', 'approval')
    const { json } = await follow(link, { body: { name: 'Ada' } })

    const guest = (await shareView()).json.requests[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${guest}`, { method: 'DELETE', token: owner })

    const again = await follow(link, { as: json.token })
    expect(again.json.declined).toBe(true)
    expect(again.json.space).toBeUndefined()

    // And the owner is asked nothing further about them.
    const { json: who } = await shareView()
    expect(who.requests).toEqual([])
    expect(who.members).toEqual([])
  })

  test('leaves an account walking through it exactly where it did', async () => {
    const link = await shareLink('read', 'approval')
    const stranger = await signIn(env, STRANGER)

    const { json } = await follow(link, { as: stranger })
    expect(json.waiting).toBe(true)
    expect((await shareView()).json.requests[0]?.email).toBe(STRANGER)
  })
})

/* ── What a guest may reach ───────────────────────────────────────────── */

describe('a guest session', () => {
  let guest: string

  beforeEach(async () => {
    guest = (await follow(await shareLink('write', 'open'))).json.token
  })

  /** Everything account-wide, which is everything a guest is not. */
  const CLOSED: { what: string; go: (token: string) => Promise<{ status: number }> }[] = [
    { what: 'the storage it is using', go: (token) => call(env, '/v1/usage', { token }) },
    { what: 'the settings', go: (token) => call(env, '/v1/settings', { token }) },
    {
      what: 'writing a setting',
      go: (token) =>
        call(env, '/v1/settings', { method: 'PATCH', token, body: { attachments: 'beside' } }),
    },
    { what: 'Recently deleted', go: (token) => call(env, '/v1/trash', { token }) },
    { what: 'emptying it', go: (token) => call(env, '/v1/trash', { method: 'DELETE', token }) },
    { what: 'the connector', go: (token) => call(env, '/v1/mcp/token', { token }) },
    {
      what: 'issuing one',
      go: (token) => call(env, '/v1/mcp/token', { token, body: { readOnly: false } }),
    },
    {
      what: 'making a space of its own',
      go: (token) => call(env, '/v1/spaces', { token, body: { name: 'Mine' } }),
    },
    {
      what: 'reordering the rail',
      go: (token) => call(env, '/v1/spaces/order', { method: 'PUT', token, body: { order: [] } }),
    },
    {
      what: 'a blob of its own',
      go: (token) =>
        call(env, `/v1/blobs/${'a'.repeat(64)}`, {
          method: 'PUT',
          token,
          raw: new Uint8Array([1, 2, 3]),
          headers: { 'content-type': 'image/png' },
        }),
    },
    // The account's record of its own notes, and the whole space at once. See the
    // allowlist in guests.ts, which says why neither is a guest's.
    { what: 'the versions of a note', go: (token) => call(env, '/v1/notes/x/versions', { token }) },
    { what: 'one of them', go: (token) => call(env, '/v1/notes/x/versions/1', { token }) },
    {
      what: 'putting a space back to a moment',
      go: (token) => call(env, `/v1/spaces/${space}/rollback`, { token, body: { at: Date.now() } }),
    },
    // And anything about the second factor or the sessions, which are the account
    // itself: a guest has neither, and a token acting for somebody may not either.
    { what: 'the second factor', go: (token) => call(env, '/v1/second', { token }) },
    { what: 'turning it off', go: (token) => call(env, '/v1/second', { method: 'DELETE', token }) },
    { what: 'the sessions', go: (token) => call(env, '/v1/sessions', { token }) },
    {
      what: 'ending every other one',
      go: (token) => call(env, '/v1/sessions', { method: 'DELETE', token }),
    },
    // Sync v2's devices and web logins, which are an account's: a guest's hub socket
    // hears pokes and nothing else, and none of these routes is a guest's at all.
    { what: 'the devices', go: (token) => call(env, '/v2/devices', { token }) },
    {
      what: 'ending a device',
      go: (token) => call(env, '/v2/devices/device-x', { method: 'DELETE', token }),
    },
    { what: 'a site’s web state', go: (token) => call(env, `/v2/web/${WEB_KEY}`, { token }) },
    {
      what: 'writing one',
      go: (token) =>
        call(env, `/v2/web/${WEB_KEY}`, {
          method: 'PUT',
          token,
          raw: new Uint8Array([1]),
          headers: { 'x-nib-fence': '1', 'x-nib-generation': '1' },
        }),
    },
    {
      what: 'a chunk of one',
      go: (token) =>
        call(env, `/v2/web/chunks/${WEB_KEY}`, { method: 'PUT', token, raw: new Uint8Array([1]) }),
    },
    {
      what: 'the store a space’s pages live in',
      go: (token) =>
        call(env, `/v2/spaces/${space}/web-store`, {
          method: 'PUT',
          token,
          body: { store: 'site' },
        }),
    },
  ]

  for (const closed of CLOSED) {
    test(`is refused ${closed.what}`, async () => {
      const { status } = await closed.go(guest)
      expect(status).toBe(403)
    })
  }

  test('says the same thing about every one of them', async () => {
    const { json } = await call(env, '/v1/usage', { token: guest })
    expect(json.error).toBe('sign in to do that')
  })

  test('cannot share the space it was lent', async () => {
    for (const [path, method] of [
      [`/v1/spaces/${space}/share`, 'GET'],
      [`/v1/spaces/${space}/share/link`, 'DELETE'],
      [`/v1/spaces/${space}/share/invite`, 'POST'],
      [`/v1/spaces/${space}/share/members/${OWNER}`, 'DELETE'],
      [`/v1/spaces/${space}/share/guests/anybody`, 'DELETE'],
    ] as const) {
      const { status } = await call(env, path, { method, token: guest })
      expect(status, path).toBe(403)
    }
  })

  test('cannot publish it, rename it, or ask after its domain', async () => {
    for (const [path, method] of [
      [`/v1/spaces/${space}/blog`, 'PUT'],
      [`/v1/spaces/${space}/blog/domain`, 'GET'],
      [`/v1/spaces/${space}`, 'PATCH'],
      [`/v1/spaces/${space}`, 'DELETE'],
    ] as const) {
      const { status } = await call(env, path, { method, token: guest })
      expect(status, path).toBe(403)
    }
  })

  test('reaches no space no link gave it', async () => {
    const other = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Private' } })).json
      .space.id

    const { status } = await call(env, `/v1/spaces/${other}/changes?since=0`, { token: guest })
    expect(status).toBe(404)
  })

  test('is over once it has run out', async () => {
    env.db.exec('update guest_sessions set expires_at = 1')
    expect((await call(env, '/v1/me', { token: guest })).status).toBe(401)
  })

  test('ends when the owner takes them out, and is nobody afterwards', async () => {
    const who = (await shareView()).json.members[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${who}`, { method: 'DELETE', token: owner })

    expect((await shareView()).json.members).toEqual([])
    // A guest with nothing left to reach is nobody, so the session goes too and
    // the device is back to the app it had before the link.
    expect((await call(env, `/v1/notes/${note}`, { token: guest })).status).toBe(401)
    expect((await rail(guest)).status).toBe(401)
  })

  test('keeps the other space when one of two is taken away', async () => {
    const second = (await call(env, '/v1/spaces', { token: owner, body: { name: 'More' } })).json
      .space.id
    const { json } = await call<ShareView>(env, `/v1/spaces/${second}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const other = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    await follow(other, { as: guest })

    const who = (await shareView()).json.members[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${who}`, { method: 'DELETE', token: owner })

    expect((await rail(guest)).json.spaces.map((one) => one.name)).toEqual(['More'])
  })

  test('narrows the moment the owner narrows it', async () => {
    const who = (await shareView()).json.members[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${who}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'read' },
    })

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: guest,
      body: { content: 'not any more' },
    })
    expect(wrote.status).toBe(403)
  })

  test('costs the owner of the space the bytes it writes, as a writer does', async () => {
    const before = (await call(env, '/v1/usage', { token: owner })).json.used

    await call(env, `/v1/spaces/${space}/notes`, {
      token: guest,
      body: { path: 'theirs.md', content: 'x'.repeat(400) },
    })

    expect((await call(env, '/v1/usage', { token: owner })).json.used).toBe(before + 400)
  })

  test('keeps no bytes of its own, so its file list adds nothing', async () => {
    const { json } = await call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token: guest,
      body: { files: [{ path: 'paper.pdf', hash: 'a'.repeat(64) }] },
    })

    expect(json.files).toEqual([])
    expect(json.missing).toEqual(['a'.repeat(64)])
  })
})

/* ── A guest that turns out to be somebody ────────────────────────────── */

describe('a guest becoming an account', () => {
  test('keeps what the device was given, when that device signs in', async () => {
    const { json } = await follow(await shareLink('write', 'open'))

    const token = await signIn(env, GUEST, json.token)
    const { json: rails } = await rail(token)
    expect(rails.spaces.map((one) => [one.name, one.role])).toEqual([
      ['Notes', 'owner'],
      [SHARED, 'write'],
    ])

    // And the sheet says one person, by address, rather than two.
    const { json: who } = await shareView()
    expect(who.members).toEqual([
      { email: GUEST, guest: null, name: null, role: 'write', pending: false },
    ])
  })

  test('leaves the guest session with nothing to reach afterwards', async () => {
    const { json } = await follow(await shareLink('read', 'open'))
    await signIn(env, GUEST, json.token)

    expect((await call(env, '/v1/me', { token: json.token })).status).toBe(401)
  })

  test('hands over what a guest said its address was, once that address is proved', async () => {
    const link = await shareLink('read', 'approval')
    await follow(link, { body: { email: GUEST } })

    const guest = (await shareView()).json.requests[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${guest}`, { method: 'POST', token: owner })

    // Somebody else's browser entirely: the address is what carries it over.
    const token = await signIn(env, GUEST)
    expect((await rail(token)).json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('hands over nothing the owner has not answered yet', async () => {
    await follow(await shareLink('read', 'approval'), { body: { email: GUEST } })

    const token = await signIn(env, GUEST)
    expect((await rail(token)).json.spaces.map((one) => one.name)).toEqual(['Notes'])
    // Still waiting, and still theirs to accept.
    expect((await shareView()).json.requests).toHaveLength(1)
  })

  test('keeps what it had when an invitation is what proves who is at the device', async () => {
    const open = await follow(await shareLink('write', 'open'))

    const second = (await call(env, '/v1/spaces', { token: owner, body: { name: 'More' } })).json
      .space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${second}/share/invite`, {
        token: owner,
        body: { email: GUEST, role: 'read' },
      }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1] ?? ''

    const { json } = await follow(link, { as: open.json.token })
    expect(json.user.email).toBe(GUEST)

    // Both spaces: the one the link gave the guest and the one the mail gave the
    // address.
    const { json: rails } = await rail(json.token)
    expect(rails.spaces.map((one) => one.name).sort()).toEqual(['More', 'Notes', SHARED])
  })

  test('is nobody once claimed, so the owner is not shown a ghost', async () => {
    const { json } = await follow(await shareLink('read', 'open'))
    await signIn(env, GUEST, json.token)

    const held = env.db.prepare('select count(*) as held from guests').get() as { held: number }
    expect(held.held).toBe(0)
  })
})
