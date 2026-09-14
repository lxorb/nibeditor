import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MOST_MEMBERS } from '../src/spaces/share'
import { call, mail, signIn, testEnv, type JoinView, type ShareView, type TestEnv } from './harness'

const OWNER = 'owner@example.com'
const WRITER = 'writer@example.com'
const READER = 'reader@example.com'
const STRANGER = 'nobody@example.com'

let env: TestEnv
let owner: string
let writer: string
let reader: string
let stranger: string
let space: string
let note: string
/** Two guests with no account, one at each role a link can hand out. */
let guestWriter: string
let guestReader: string
/** A guest the owner has not answered yet, and one who is in, so that the three
 *  routes about a guest have somebody to work on. */
let waitingGuest: string
let readingGuest: string

/** Somebody given the space, and in it: invited, then having proved the address
 *  by signing in, which is the whole of what joining is. */
async function invite(email: string, role: 'write' | 'read'): Promise<string> {
  const link = await inviteLink(email, role)
  const token = await signIn(env, email)
  await call(env, `/v1/join/${link}`, { method: 'POST', token })
  return token
}

/** The token in the link the invitation mail carried. */
async function inviteLink(email: string, role: 'write' | 'read'): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite`, { token: owner, body: { email, role } }),
  )

  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)
  return found[1]
}

function shareView(as = owner) {
  return call<ShareView>(env, `/v1/spaces/${space}/share`, { token: as })
}

/** The space's own link, set to hand out this role in this mode, as a token. */
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

/** Somebody with no account who followed the link, and the session it handed
 *  them. Nothing is typed and nothing is proved: holding the link is the whole
 *  of it. */
async function guestAt(role: 'write' | 'read', device = 'Windows'): Promise<string> {
  const token = await shareLink(role, 'open')
  const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', body: { device } })

  return json.token
}

/** Which guest a session belongs to, as the guest itself is told. */
async function guestOf(token: string): Promise<string> {
  return (await call(env, '/v1/me', { token })).json.guest.id
}

/** Every account owns a space called `Notes` from the moment it is made; see
 *  src/spaces/first.ts. The space this file shares is named something else, so
 *  that a listing, a mail and a connector answer all say which one they mean. */
const SHARED = 'Plans'

beforeEach(async () => {
  env = testEnv()
  owner = await signIn(env, OWNER)
  stranger = await signIn(env, STRANGER)

  space = (await call(env, '/v1/spaces', { token: owner, body: { name: SHARED } })).json.space.id
  note = (
    await call(env, `/v1/spaces/${space}/notes`, {
      token: owner,
      body: { path: 'plan.md', content: '# Plan\n' },
    })
  ).json.note.id
})

afterEach(() => env.close())

/* ── The matrix ───────────────────────────────────────────────────────── */

interface Route {
  what: string
  needs: 'read' | 'write' | 'owner'
  go: (token: string) => Promise<{ status: number }>
}

const ROUTES: Route[] = [
  {
    what: 'reading what changed',
    needs: 'read',
    go: (token) => call(env, `/v1/spaces/${space}/changes?since=0`, { token }),
  },
  {
    what: 'reading a note',
    needs: 'read',
    go: (token) => call(env, `/v1/notes/${note}`, { token }),
  },
  {
    what: 'making a note',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'new.md', content: 'hi' } }),
  },
  {
    what: 'writing a note',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/notes/${note}`, { method: 'PUT', token, body: { content: 'changed' } }),
  },
  {
    what: 'deleting a note',
    needs: 'write',
    go: (token) => call(env, `/v1/notes/${note}`, { method: 'DELETE', token }),
  },
  {
    what: 'keeping bookmarks',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/bookmarks`, { method: 'PUT', token, body: { bookmarks: [] } }),
  },
  {
    what: 'dressing the folders',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/icons`, { method: 'PUT', token, body: { icons: {} } }),
  },
  {
    what: 'arranging the folders',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/arranged`, {
        method: 'PUT',
        token,
        body: { arranged: { '': ['b.md', 'a.md'] } },
      }),
  },
  {
    what: 'drawing the graph',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/graph`, { method: 'PUT', token, body: { graph: {} } }),
  },
  {
    what: 'leaving a note out of the search',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/excluded`, { method: 'PUT', token, body: { excluded: [] } }),
  },
  {
    what: 'keeping the files beside the notes',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/files`, { method: 'PUT', token, body: { files: [] } }),
  },
  {
    what: 'renaming the space',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}`, { method: 'PATCH', token, body: { name: 'X' } }),
  },
  {
    what: 'deleting the space',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}`, { method: 'DELETE', token }),
  },
  {
    what: 'publishing the space',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token, body: { subdomain: 'plans' } }),
  },
  {
    what: 'unpublishing the space',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token }),
  },
  {
    what: 'asking after the domain',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/blog/domain`, { token }),
  },
  {
    what: 'reading who else is in it',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/share`, { token }),
  },
  {
    what: 'inviting somebody',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token,
        body: { email: 'else@example.com', role: 'read' },
      }),
  },
  {
    what: "changing somebody's role",
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/members/${READER}`, {
        method: 'PATCH',
        token,
        body: { role: 'write' },
      }),
  },
  {
    what: 'taking somebody out',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/members/${READER}`, { method: 'DELETE', token }),
  },
  {
    what: 'making the link',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/link`, {
        method: 'PUT',
        token,
        body: { role: 'read', mode: 'open' },
      }),
  },
  {
    what: 'revoking the link',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token }),
  },
  {
    what: 'accepting a request',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, { method: 'POST', token }),
  },
  {
    what: 'declining a request',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, { method: 'DELETE', token }),
  },
  {
    what: 'letting a guest in',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${waitingGuest}`, { method: 'POST', token }),
  },
  {
    what: "changing a guest's role",
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${readingGuest}`, {
        method: 'PATCH',
        token,
        body: { role: 'write' },
      }),
  },
  {
    what: 'taking a guest out',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${readingGuest}`, { method: 'DELETE', token }),
  },
]

/** Which roles a route lets through, so each case below reads as one sentence. */
const RANK = { read: 0, write: 1, owner: 2 }

/** Everybody a route can be asked by, at the role they hold.
 *
 *  A guest is not a fourth role. It is either of the two a link hands out, held
 *  by somebody with no account at all, and no route may tell the difference:
 *  whether they proved an address or followed a link is how they arrived, and
 *  what they may do is their role. Which is why they are a column here rather
 *  than a file of their own. */
const HOLDERS: { as: string; role: 'read' | 'write' | 'owner'; token: () => string }[] = [
  { as: 'the owner', role: 'owner', token: () => owner },
  { as: 'a writer', role: 'write', token: () => writer },
  { as: 'a reader', role: 'read', token: () => reader },
  { as: 'a guest who may write', role: 'write', token: () => guestWriter },
  { as: 'a guest who may read', role: 'read', token: () => guestReader },
]

describe('every route that names a space', () => {
  beforeEach(async () => {
    writer = await invite(WRITER, 'write')
    reader = await invite(READER, 'read')

    guestWriter = await guestAt('write')
    guestReader = await guestAt('read')
    readingGuest = await guestOf(guestReader)

    // Somebody waiting to be let in, of each kind, so the routes about a request
    // and the routes about a guest have one to work on rather than answering
    // that there is nothing there.
    const asking = await shareLink('read', 'approval')
    await call(env, `/v1/join/${asking}`, { method: 'POST', token: stranger })

    const knocked = await call(env, `/v1/join/${asking}`, {
      method: 'POST',
      body: { name: 'Ada' },
    })
    waitingGuest = knocked.json.guest.id
  })

  for (const route of ROUTES) {
    for (const holder of HOLDERS) {
      const allowed = RANK[holder.role] >= RANK[route.needs]

      test(`${allowed ? 'lets' : 'refuses'} ${holder.as} through ${route.what}`, async () => {
        const { status } = await route.go(holder.token())

        if (allowed) expect(status).toBeLessThan(400)
        else expect(status).toBe(403)
      })
    }

    test(`answers a stranger asking about ${route.what} with nothing at all`, async () => {
      const { status } = await route.go(stranger)
      expect(status).toBe(404)
    })
  }
})

/* ── The listing ──────────────────────────────────────────────────────── */

describe('the space listing', () => {
  /** The shared space as an account's rail shows it. By id, because the rail
   *  starts with the space that account was given. */
  async function inRail(as: string) {
    const { json } = await call(env, '/v1/spaces', { token: as })
    return json.spaces.find((one) => one.id === space)
  }

  test('says nothing is shared until somebody is in it', async () => {
    expect((await inRail(owner))?.role).toBe('owner')
    expect((await inRail(owner))?.shared).toBe(false)
  })

  test("marks the owner's space once somebody is in it", async () => {
    await invite(READER, 'read')

    expect((await inRail(owner))?.shared).toBe(true)
  })

  test('carries a shared space to the person it was shared with, with their role', async () => {
    reader = await invite(READER, 'read')

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => [one.name, one.role, one.shared])).toEqual([
      ['Notes', 'owner', false],
      [SHARED, 'read', true],
    ])
  })

  test('keeps a shared space after the ones the account owns', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, '/v1/spaces', { token: writer, body: { name: 'Mine' } })

    const { json } = await call(env, '/v1/spaces', { token: writer })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', 'Mine', SHARED])
  })

  test('leaves nothing of a space nobody shared', async () => {
    const { json } = await call(env, '/v1/spaces', { token: stranger })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('carries the marker for a shared space that was deleted', async () => {
    reader = await invite(READER, 'read')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token: owner })

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
    expect(json.deleted).toEqual([space])
  })

  test('drops the space the moment the membership is taken away', async () => {
    reader = await invite(READER, 'read')
    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'DELETE',
      token: owner,
    })

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('reorders only what the account owns, so a rail cannot move somebody else’s', async () => {
    writer = await invite(WRITER, 'write')
    const mine = (await call(env, '/v1/spaces', { token: writer, body: { name: 'Mine' } })).json
      .space.id

    await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token: writer,
      body: { order: [space, mine] },
    })

    const { json } = await call(env, '/v1/spaces', { token: owner })
    expect(json.spaces[0]?.position).toBe(0)
  })
})

/* ── Inviting ─────────────────────────────────────────────────────────── */

describe('an invitation', () => {
  test('puts the person in the space and mails them a link', async () => {
    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      }),
    )

    expect(sent).toContain(READER)
    expect(sent).toContain(`shared the space ${SHARED} with you`)
    expect(sent).toMatch(/https:\/\/nibeditor\.com\/join\/[a-f0-9]{64}/)

    const { json } = await shareView()
    expect(json.members).toEqual([
      { email: READER, guest: null, name: null, role: 'read', pending: true },
    ])
  })

  test('waits for the address to be proved before anybody has been in', async () => {
    const link = await inviteLink(READER, 'read')
    expect((await shareView()).json.members[0]?.pending).toBe(true)

    const token = await signIn(env, READER)
    await call(env, `/v1/join/${link}`, { method: 'POST', token })

    expect((await shareView()).json.members[0]?.pending).toBe(false)
  })

  test('is waiting for somebody who had no account when it was sent', async () => {
    // Nobody by this address has ever signed in, so there is no account for the
    // membership to point at - and it does not point at one.
    await inviteLink('later@example.com', 'write')

    const token = await signIn(env, 'later@example.com')
    const { json } = await call(env, '/v1/spaces', { token })

    expect(json.spaces.map((one) => [one.name, one.role])).toEqual([
      ['Notes', 'owner'],
      [SHARED, 'write'],
    ])
  })

  test('reads the address the way the sign-in does, so one spelling is one person', async () => {
    await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: '  Reader@Example.COM ', role: 'read' },
    })

    const token = await signIn(env, READER)
    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('says what is wrong with an address that is not one', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: 'not an address', role: 'read' },
    })

    expect(status).toBe(400)
    expect(json.error).toBe('enter a valid email address')
  })

  test('refuses a role that is not one to give', async () => {
    for (const role of ['owner', 'admin', '']) {
      const { status } = await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role },
      })
      expect(status, role).toBe(400)
    }
  })

  test('will not invite the owner to their own space', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: OWNER, role: 'write' },
    })

    expect(status).toBe(409)
    expect(json.error).toBe('this space is already yours')
  })

  test('mails one address at a time, the way a sign-in code is rate limited', async () => {
    const sent = await mail(async () => {
      await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      })
      await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'write' },
      })
    })

    expect(sent.match(/shared the space Plans with you/g)).toHaveLength(1)
    // The mail waited; the sharing did not.
    expect((await shareView()).json.members[0]?.role).toBe('write')
  })

  test('never says whether the mail went, which would say who else had mailed them', async () => {
    // The gate is per address across every space there is, so an answer here
    // would be a way to ask about somebody else's sharing.
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: READER, role: 'read' },
    })

    expect(json.mailed).toBeUndefined()
  })

  /** The other half of the live 500s: the same unguarded send, on the route that
   *  had already written the row. An owner was shown a fault of the provider's
   *  and told nothing had happened, while the person was in fact invited. */
  test('stands, and still says nothing, when the message cannot go', async () => {
    env.MAIL_FROM = 'Nib <nib@nibeditor.com>'
    env.EMAIL = { send: () => Promise.reject(new Error('the sender is not answering')) }

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await call<ShareView>(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: STRANGER, role: 'read' },
    })
    quiet.mockRestore()

    expect(response.status).toBe(200)
    // The invitation is the row, and the row is written: the owner can hand the
    // link over themselves.
    expect(response.json.members.some((one) => one.email === STRANGER)).toBe(true)

    // And the gap the send took is given up, so pressing the button again writes
    // to the address rather than being held behind a message that never went.
    const gap = env.db
      .prepare('select count(*) as many from mailed where email = ?')
      .get(STRANGER) as { many: number }
    expect(gap.many).toBe(0)
  })

  test('carries a space name that is one line, whatever the name holds', async () => {
    await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: owner,
      body: { name: 'Plans\r\nBcc: somebody@example.com' },
    })

    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      }),
    )

    const subject = /- (.*)/.exec(sent)?.[1] ?? ''
    expect(subject).toBe('owner shared PlansBcc: somebody@example.com with you')
  })

  test('opens nothing when it reaches somebody else', async () => {
    const link = await inviteLink(READER, 'read')

    const { status, json } = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      token: stranger,
    })

    expect(status).toBe(403)
    expect(json.error).toBe('that invitation was sent to another address')
  })

  test('says who it is from and what it offers, before anybody has signed in', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token: owner, body: { name: 'Emil' } })
    const link = await inviteLink(READER, 'read')

    const { status, json } = await call<JoinView>(env, `/v1/join/${link}`)

    expect(status).toBe(200)
    expect(json).toMatchObject({
      kind: 'invite',
      space: SHARED,
      role: 'read',
      email: READER,
      asks: false,
      from: 'Emil',
    })
  })

  test('names the owner by the front of their address until they choose a name', async () => {
    const link = await inviteLink(READER, 'read')
    expect((await call<JoinView>(env, `/v1/join/${link}`)).json.from).toBe('owner')
  })

  test('stops being a shortcut once it has run out', async () => {
    const link = await inviteLink(READER, 'read')
    env.db.exec('update space_members set expires_at = 1')

    expect((await call<JoinView>(env, `/v1/join/${link}`)).status).toBe(404)

    // The address still opens the space, because the address is what opens it.
    const token = await signIn(env, READER)
    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })
})

/* ── Roles, one person at a time ──────────────────────────────────────── */

describe('one person’s role', () => {
  beforeEach(async () => {
    reader = await invite(READER, 'read')
  })

  test('changes on its own, leaving everybody else where they were', async () => {
    writer = await invite(WRITER, 'write')

    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    const { json } = await shareView()
    expect(Object.fromEntries(json.members.map((one) => [one.email, one.role]))).toEqual({
      [WRITER]: 'write',
      [READER]: 'write',
    })
  })

  test('takes effect at once, so the next write is allowed', async () => {
    const before = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: 'mine' },
    })
    expect(before.status).toBe(403)

    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    const after = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: 'mine' },
    })
    expect(after.status).toBe(200)
  })

  test('cannot be raised to owner', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'owner' },
    })

    expect(status).toBe(400)
  })

  test('says so when nobody by that address is in the space', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/members/${STRANGER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    expect(status).toBe(404)
  })

  test('ends when they let themselves out, without asking the owner', async () => {
    const gone = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: reader,
    })
    expect(gone.status).toBe(200)

    expect((await shareView()).json.members).toEqual([])
    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('is not something the owner can do to their own space', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: owner,
    })

    expect(status).toBe(409)
    expect(json.error).toBe('this space is yours')
    // And nothing about the space changed.
    const { json: rail } = await call(env, '/v1/spaces', { token: owner })
    expect(rail.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('is nothing at all for somebody who was never in it', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: stranger,
    })

    expect(status).toBe(404)
  })

  test('goes when they are taken out, and the space goes with it', async () => {
    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect((await shareView()).json.members).toEqual([])
    expect((await call(env, `/v1/notes/${note}`, { token: reader })).status).toBe(404)
  })
})

/* ── The link ─────────────────────────────────────────────────────────── */

/** The number is on the space rather than on the route that lets somebody in.
 *  An invitation held itself to it and a link did not, so the link was the way
 *  round it - and a space past the number is one whose sheet cannot list the
 *  people in it, which means an owner who can neither see nor take out whoever
 *  came in last. */
describe('as many people as one space holds', () => {
  /** Fills the space to the brim, leaving room for `spare` more. */
  function fillMembers(spare = 0) {
    const at = Date.now()
    for (let one = 0; one < MOST_MEMBERS - spare; one++) {
      env.db
        .prepare(
          'insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)',
        )
        .run(space, `filler${one}@example.com`, 'read', at + one)
    }
  }

  test('an invitation is refused past it', async () => {
    fillMembers()
    const response = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: STRANGER, role: 'read' },
    })

    expect(response.status).toBe(409)
    expect(response.json.error).toBe('that is as many people as one space holds')
  })

  test('an open link is refused past it too', async () => {
    const token = await shareLink('write', 'open')
    fillMembers()

    const joined = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })
    expect(joined.status).toBe(409)
    expect(joined.json.error).toBe('that is as many people as one space holds')

    // And nothing was written, so the space still holds what it held.
    expect((await shareView()).json.members).toHaveLength(MOST_MEMBERS)
  })

  test('somebody already in is still let in when it is full', async () => {
    const token = await shareLink('read', 'open')
    fillMembers(1)
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    // Full now, and the same person comes back to the same link.
    const again = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })
    expect(again.status).toBe(200)
    expect(again.json.space.role).toBe('read')
  })

  test('an invitation already written is still redeemable when it is full', async () => {
    const link = await inviteLink(STRANGER, 'write')
    fillMembers(1)

    const joined = await call(env, `/v1/join/${link}`, { method: 'POST', token: stranger })
    expect(joined.status).toBe(200)
    expect(joined.json.space.role).toBe('write')
  })
})

describe('a share link', () => {
  async function link(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role, mode },
    })

    const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
    if (!found?.[1]) throw new Error('no link was made')
    return found[1]
  }

  test('is not there until it is asked for', async () => {
    expect((await shareView()).json.link).toBeNull()
  })

  test('lets anybody who proves an address in, when it is open', async () => {
    const token = await link('write', 'open')
    const joined = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(joined.status).toBe(200)
    expect(joined.json.space.role).toBe('write')

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: stranger,
      body: { content: 'from the link' },
    })
    expect(wrote.status).toBe(200)
  })

  test('says what it offers to somebody who has not signed in', async () => {
    const token = await link('read', 'open')
    const { json } = await call<JoinView>(env, `/v1/join/${token}`)

    expect(json).toMatchObject({ kind: 'link', space: SHARED, role: 'read', asks: false })
    // Whoever has it, so it names nobody.
    expect(json.email).toBeNull()
  })

  test('asks first when it is set to, and tells the owner somebody is waiting', async () => {
    const token = await link('read', 'approval')

    const sent = await mail(() =>
      call(env, `/v1/join/${token}`, { method: 'POST', token: stranger }),
    )
    expect(sent).toContain(OWNER)
    expect(sent).toContain(`would like to join ${SHARED}`)

    const { json } = await shareView()
    expect(json.requests.map((one) => [one.email, one.role])).toEqual([[STRANGER, 'read']])
    expect(json.members).toEqual([])

    // Waiting is not being in.
    expect((await call(env, `/v1/notes/${note}`, { token: stranger })).status).toBe(404)
  })

  test('says it is waiting rather than handing back a space', async () => {
    const token = await link('read', 'approval')
    const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(json.waiting).toBe(true)
    expect(json.space).toBeUndefined()
  })

  test('lets somebody in once the owner accepts, at the role the link offered', async () => {
    const token = await link('write', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([
      { email: STRANGER, guest: null, name: null, role: 'write', pending: false },
    ])

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: stranger,
      body: { content: 'let in' },
    })
    expect(wrote.status).toBe(200)
  })

  test('leaves them outside when the owner declines', async () => {
    const token = await link('read', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'DELETE',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([])
  })

  /** Accepting is the one thing that settles whether somebody has been in, and it
   *  wrote the role onto a row that was already there without saying so. No route
   *  reaches that pair today - an invitation takes any waiting request away, and
   *  the link hands back the space rather than making a request when a membership
   *  exists - so the state is arranged here, which is what a clause written for a
   *  conflict has to be held to. */
  test('accepting says they have arrived even over a membership that was waiting', async () => {
    const at = Date.now()
    env.db
      .prepare('insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)')
      .run(space, STRANGER, 'read', at)
    env.db
      .prepare('insert into space_requests (space_id, email, role, created_at) values (?, ?, ?, ?)')
      .run(space, STRANGER, 'write', at)

    expect((await shareView()).json.members[0]?.pending).toBe(true)

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([
      { email: STRANGER, guest: null, name: null, role: 'write', pending: false },
    ])
  })

  test('keeps what a request was promised when the link changes afterwards', async () => {
    const token = await link('write', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })
    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    expect((await shareView()).json.members[0]?.role).toBe('write')
  })

  test('stays the same link when what it hands out changes', async () => {
    const first = await link('read', 'open')
    const second = await link('write', 'approval')

    expect(second).toBe(first)
    expect((await shareView()).json.link).toMatchObject({ role: 'write', mode: 'approval' })
  })

  test('opens nothing once it is revoked', async () => {
    const token = await link('read', 'open')
    await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: owner })

    expect((await shareView()).json.link).toBeNull()
    expect((await call(env, `/v1/join/${token}`)).status).toBe(404)
    expect((await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })).status).toBe(
      404,
    )
  })

  test('is a fresh one when a revoked space is shared again', async () => {
    const first = await link('read', 'open')
    await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: owner })
    const second = await link('read', 'open')

    expect(second).not.toBe(first)
  })

  test('hands the owner their own space rather than making them a member of it', async () => {
    const token = await link('read', 'open')
    const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', token: owner })

    expect(json.space.role).toBe('owner')
    expect((await shareView()).json.members).toEqual([])
  })

  test('refuses a mode that is not one', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'sometimes' },
    })

    expect(status).toBe(400)
  })

  test('is nothing at all when the token names nothing', async () => {
    expect((await call(env, '/v1/join/deadbeef')).status).toBe(404)
    expect((await call(env, '/v1/join/deadbeef', { method: 'POST', token: stranger })).status).toBe(
      404,
    )
  })

  test('needs no session at all: it hands out a guest instead', async () => {
    const token = await link('read', 'open')
    const { status, json } = await call(env, `/v1/join/${token}`, { method: 'POST' })

    expect(status).toBe(200)
    expect(json.token).toBeTruthy()
    expect(json.guest.name).toBeTruthy()
  })
})

/* ── What a shared space costs, and who pays ──────────────────────────── */

describe('a note written in a space somebody shared', () => {
  test('counts against the owner of the space rather than the writer', async () => {
    writer = await invite(WRITER, 'write')

    const before = (await call(env, '/v1/usage', { token: owner })).json.used
    const theirs = (await call(env, '/v1/usage', { token: writer })).json.used
    await call(env, `/v1/spaces/${space}/notes`, {
      token: writer,
      body: { path: 'theirs.md', content: 'x'.repeat(500) },
    })

    const after = await call(env, '/v1/usage', { token: owner })
    const mine = await call(env, '/v1/usage', { token: writer })

    expect(after.json.used).toBe(before + 500)
    // Their own account holds what it was given and not a byte of the note.
    expect(mine.json.used).toBe(theirs)
  })

  test('is refused once the owner has no room for it, whoever is writing', async () => {
    writer = await invite(WRITER, 'write')
    env.db.exec(
      `insert into blobs (hash, user_id, size, type, created_at)
       values ('${'f'.repeat(64)}', (select id from users where email = '${OWNER}'),
               1073741824, 'image/png', 1)`,
    )

    const { status } = await call(env, `/v1/spaces/${space}/notes`, {
      token: writer,
      body: { path: 'theirs.md', content: 'more' },
    })

    expect(status).toBe(507)
  })
})

/* ── The files beside the notes ───────────────────────────────────────── */

describe('the PDFs a shared space keeps', () => {
  /** A PDF on somebody's account, as the blob store holds it. */
  function blobOf(email: string, hash: string) {
    env.db.exec(
      `insert into blobs (hash, user_id, size, type, created_at)
       values ('${hash}', (select id from users where email = '${email}'), 10, 'application/pdf', 1)`,
    )
  }

  function files(as: string, list: { path: string; hash: string }[]) {
    return call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token: as,
      body: { files: list },
    })
  }

  const theirs = { path: 'paper.pdf', hash: 'a'.repeat(64) }
  const mine = { path: 'notes.pdf', hash: 'b'.repeat(64) }

  test('are not dropped by a writer who does not hold their bytes', async () => {
    blobOf(OWNER, theirs.hash)
    await files(owner, [theirs])

    writer = await invite(WRITER, 'write')
    blobOf(WRITER, mine.hash)

    // The writer sends the list as their machine sees it: the owner's paper,
    // which they are keeping no bytes for, and one of their own.
    const { json } = await files(writer, [theirs, mine])

    expect(json.files).toEqual([theirs, mine])
    expect(json.missing).toEqual([])
  })

  test('still leave out one nobody in the space is keeping', async () => {
    writer = await invite(WRITER, 'write')
    const { json } = await files(writer, [mine])

    expect(json.files).toEqual([])
    expect(json.missing).toEqual([mine.hash])
  })
})

/* ── Recently deleted ─────────────────────────────────────────────────── */

describe('recently deleted in a shared space', () => {
  test('stays the owner’s, whoever deleted the note', async () => {
    // What Recently deleted gives back is storage, and the storage a shared
    // space uses is its owner's. A writer emptying their own would otherwise
    // take away somebody else's notes for good.
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: writer })

    expect((await call(env, '/v1/trash', { token: writer })).json.notes).toEqual([])
    expect(
      (await call(env, '/v1/trash', { token: owner })).json.notes.map((one) => one.path),
    ).toEqual(['plan.md'])
  })

  test('is not a way into somebody else’s notes', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: writer })

    for (const [path, method] of [
      [`/v1/trash/notes/${note}/restore`, 'POST'],
      [`/v1/trash/notes/${note}`, 'DELETE'],
    ] as const) {
      expect((await call(env, path, { method, token: writer })).status, path).toBe(404)
    }

    // And emptying their own takes nothing of the owner's with it.
    await call(env, '/v1/trash', { method: 'DELETE', token: writer })
    expect((await call(env, '/v1/trash', { token: owner })).json.notes).toHaveLength(1)

    const back = await call(env, `/v1/trash/notes/${note}/restore`, {
      method: 'POST',
      token: owner,
    })
    expect(back.status).toBe(200)
  })

  test('keeps the space itself the owner’s to restore', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token: owner })

    expect((await call(env, '/v1/trash', { token: writer })).json.spaces).toEqual([])
  })
})

/* ── The connector ────────────────────────────────────────────────────── */

describe('the connector in a shared space', () => {
  async function connector(session: string): Promise<string> {
    const { json } = await call(env, '/v1/mcp/token', { token: session, body: { readOnly: false } })
    return json.token
  }

  function tool(session: string, name: string, args: Record<string, unknown>) {
    return call<{ result: { content: { text: string }[] } }>(env, '/mcp', {
      token: session,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
  }

  test('lists a space somebody shared alongside the account’s own', async () => {
    writer = await invite(WRITER, 'write')
    const said = await tool(await connector(writer), 'list_spaces', {})

    expect(said.json.result.content[0]?.text).toBe(`Notes\n${SHARED}`)
  })

  test('reads a note in it', async () => {
    reader = await invite(READER, 'read')
    const said = await tool(await connector(reader), 'read_note', {
      space: SHARED,
      path: 'plan.md',
    })

    expect(said.json.result.content[0]?.text).toBe('# Plan\n')
  })

  test('writes in one that was shared to write in', async () => {
    writer = await invite(WRITER, 'write')
    const said = await tool(await connector(writer), 'write_note', {
      space: SHARED,
      path: 'plan.md',
      content: 'rewritten',
    })

    expect(said.json.result.content[0]?.text).toBe('Saved plan.md.')
  })

  test('refuses to write in one that was shared to read', async () => {
    reader = await invite(READER, 'read')
    const said = await tool(await connector(reader), 'write_note', {
      space: SHARED,
      path: 'plan.md',
      content: 'rewritten',
    })

    expect(said.json.result.content[0]?.text).toBe(
      `${SHARED} was shared with you to read, not to write.`,
    )
  })

  test('cannot see a space nobody shared', async () => {
    const said = await tool(await connector(stranger), 'list_spaces', {})
    // Their own space, and no sign of the one nobody shared with them.
    expect(said.json.result.content[0]?.text).toBe('Notes')
  })
})
