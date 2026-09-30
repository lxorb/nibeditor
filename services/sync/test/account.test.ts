/** Deleting an account, through the routes: what it takes to be allowed, and what
 *  is left afterwards. The list of tables it empties is held to the schema in
 *  erase.test.ts; this file is about the door and about the people on either side
 *  of a share. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { codeAt } from '../src/second'
import { call, mail, signIn, type Answer, type TestEnv, testEnv } from './harness'

interface LeavingView {
  resendIn?: number
  second?: boolean
  ticket?: string
  ok?: boolean
  error?: string
  holding?: string
  token?: string
  user?: { id: string; email: string }
  space?: { id: string }
  spaces?: { id: string; name: string }[]
  deleted?: string[]
  note?: { id: string }
  notes?: { id: string; path: string }[]
  members?: { email: string | null }[]
}

/** The secret the second factor is kept under; see second.test.ts. */
const KEPT = { OPENAI_KEY_SECRET: 'a secret for the tests' }

const ME = 'leaving@example.com'
const OTHER = 'staying@example.com'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv(KEPT)
  token = await signIn(env, ME)
})

afterEach(() => env.close())

/** Step one, what it answered, and the six digits and the words it mailed. */
async function askToLeave(
  as = token,
): Promise<{ answer: Answer<LeavingView>; code: string; mailed: string }> {
  const answers: Answer<LeavingView>[] = []
  const mailed = await mail(async () => {
    answers.push(await call<LeavingView>(env, '/v1/account/delete/code', { token: as, body: {} }))
  })

  const found = /(\d{3}) (\d{3})/.exec(mailed)
  const answer = answers[0]
  if (!answer) throw new Error('step one answered nothing')
  return { answer, code: found ? `${found[1]}${found[2]}` : '', mailed }
}

function verify(code: string, second?: string, as = token) {
  return call<LeavingView>(env, '/v1/account/delete/verify', {
    token: as,
    body: { code, ...(second === undefined ? {} : { second }) },
  })
}

function confirm(ticket: string | undefined, as = token) {
  return call<LeavingView>(env, '/v1/account', {
    method: 'DELETE',
    token: as,
    body: ticket === undefined ? {} : { ticket },
  })
}

/** All three steps, for an account with no second factor. */
async function leave(as = token): Promise<Answer<LeavingView>> {
  const { code } = await askToLeave(as)
  const { json } = await verify(code, undefined, as)
  return await confirm(json.ticket, as)
}

/** Some other six digits than these. */
function wrong(code: string): string {
  return code.replace(/^./, (digit) => String((Number(digit) + 1) % 10))
}

async function me(as = token) {
  return await call<LeavingView>(env, '/v1/me', { token: as })
}

/** The second factor, turned on the way the pane turns it on; answers the secret. */
async function enrol(): Promise<string> {
  const begun = await call<LeavingView>(env, '/v1/second', { token, body: {} })
  const row = env.db
    .prepare("select value from cached where scope = 'second-pending' order by until desc limit 1")
    .get() as { value: string }
  const secret = row.value.split(':')[1] ?? ''

  await call(env, '/v1/second/confirm', {
    token,
    body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
  })

  return secret
}

function step(): number {
  return Math.floor(Date.now() / 30_000)
}

describe('the door', () => {
  test('a session alone deletes nothing', async () => {
    expect((await confirm(undefined)).status).toBe(400)
    expect((await confirm('f'.repeat(64))).status).toBe(400)
    expect((await me()).status).toBe(200)
  })

  test('mails a fresh code to the account’s own address, saying what it is for', async () => {
    const { answer, code, mailed } = await askToLeave()

    expect(answer.status).toBe(200)
    expect(answer.json.second).toBe(false)
    expect(code).toMatch(/^\d{6}$/)
    expect(mailed).toContain(ME)
    expect(mailed).toContain('delete your nibeditor account')
  })

  test('refuses a wrong code, and the account stays', async () => {
    const { code } = await askToLeave()
    const answer = await verify(wrong(code))

    expect(answer.status).toBe(400)
    expect(answer.json.ticket).toBeUndefined()
    expect((await me()).status).toBe(200)
  })

  test('refuses a code that has run out', async () => {
    const { code } = await askToLeave()
    env.db.exec('update login_codes set expires_at = 1')

    expect((await verify(code)).status).toBe(400)
  })

  test('takes a code once', async () => {
    const { code } = await askToLeave()

    expect((await verify(code)).status).toBe(200)
    expect((await verify(code)).status).toBe(400)
  })

  test('and deletes with the ticket the codes earned', async () => {
    const answer = await leave()

    expect(answer.status).toBe(200)
    expect(answer.json.ok).toBe(true)
    // The session that asked went with everything else.
    expect((await me()).status).toBe(401)
  })

  test('and says so to the address afterwards', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)

    const receipt = await mail(() => confirm(json.ticket))

    expect(receipt).toContain(ME)
    expect(receipt).toContain('Your nibeditor account has been deleted')
    // A receipt counts against nothing, so it writes nothing at the address.
    expect(env.db.prepare('select count(*) as many from limits where key = ?').get(ME)).toEqual({
      many: 0,
    })
  })

  test('a ticket runs out', async () => {
    const { code } = await askToLeave()
    const { json } = await verify(code)
    env.db.exec("update cached set until = 1 where scope = 'leaving'")

    expect((await confirm(json.ticket)).status).toBe(400)
    expect((await me()).status).toBe(200)
  })

  test('somebody else’s ticket deletes nobody', async () => {
    const other = await signIn(env, OTHER)
    const { code } = await askToLeave()
    const { json } = await verify(code)

    expect((await confirm(json.ticket, other)).status).toBe(400)
    expect((await me(other)).status).toBe(200)
    expect((await me()).status).toBe(200)

    // And it is still good for the account it was earned by.
    expect((await confirm(json.ticket)).status).toBe(200)
    expect((await me(other)).status).toBe(200)
  })

  test('somebody else’s mailed code proves nothing about this account', async () => {
    const other = await signIn(env, OTHER)
    const theirs = await askToLeave(other)
    await askToLeave()

    expect((await verify(theirs.code)).status).toBe(400)
  })

  test('with a second factor, the mailed code is half of it', async () => {
    const secret = await enrol()
    const { answer, code } = await askToLeave()
    expect(answer.json.second).toBe(true)

    expect((await verify(code)).status).toBe(400)
    expect((await verify(code, '000000')).status).toBe(400)

    // The mailed code survives a mistyped second one, as a sign-in's does.
    const right = await verify(code, await codeAt(secret, step()))
    expect(right.status).toBe(200)
    expect((await confirm(right.json.ticket)).status).toBe(200)
  })

  test('with a second factor, a stolen session and the mailbox are not enough', async () => {
    await enrol()
    const { code } = await askToLeave()

    for (const second of ['', '123456', 'aaaaa-bbbbb-ccccc-ddddd']) {
      expect((await verify(code, second)).status).toBe(400)
    }
    expect((await me()).status).toBe(200)
  })

  test('is shut to a guest and to a program', async () => {
    const minted = await call<LeavingView>(env, '/v1/mcp/token', {
      token,
      body: { readOnly: false },
    })
    const program = minted.json.token ?? ''

    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Open' } }))
      .json.space?.id
    const linked = await call<{ link: { url: string } }>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(linked.json.link.url)?.[1]
    const guest = (await call<LeavingView>(env, `/v1/join/${link}`, { method: 'POST', body: {} }))
      .json.token

    for (const as of [program, guest ?? '']) {
      expect((await call(env, '/v1/account/delete/code', { token: as, body: {} })).status).toBe(403)
      expect((await verify('123456', undefined, as)).status).toBe(403)
      expect((await confirm('x', as)).status).toBe(403)
    }
  })

  test('counts every ask, and stops at ten an hour', async () => {
    for (let ask = 0; ask < 10; ask++) {
      expect((await call(env, '/v1/account/delete/code', { token, body: {} })).status).toBe(200)
    }

    const refused = await call<LeavingView>(env, '/v1/account/delete/code', { token, body: {} })
    expect(refused.status).toBe(429)
    expect((await verify('123456')).status).toBe(429)
  })
})

describe('what is left', () => {
  test('nothing of the account, and the address signs up as somebody new', async () => {
    const before = (await me()).json.user?.id
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Work' } }))
      .json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# Plan\n' },
    })

    const held = (await call<LeavingView>(env, '/v1/spaces', { token })).json.spaces ?? []
    expect(held.map((one) => one.name)).toEqual(['Notes', 'Work'])
    expect(env.keys().some((key) => key.includes(space ?? '-'))).toBe(true)

    expect((await leave()).status).toBe(200)
    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
    expect(env.keys().filter((key) => held.some((one) => key.includes(one.id)))).toEqual([])

    const again = await signIn(env, ME)
    const fresh = await me(again)
    expect(fresh.json.user?.email).toBe(ME)
    expect(fresh.json.user?.id).not.toBe(before)

    const listed = await call<LeavingView>(env, '/v1/spaces', { token: again })
    expect(listed.json.spaces?.map((one) => one.name)).toEqual(['Notes'])
    // Not even as a marker: a fresh account has no deleted spaces to tell a
    // machine about.
    expect(listed.json.deleted).toEqual([])
  })

  test('a space somebody shared with it stays theirs, with its notes, without it', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    await call(env, `/v1/join/${link}`, { method: 'POST', token })

    const wrote = await call<LeavingView>(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'mine in theirs.md', content: 'written by the one leaving' },
    })
    expect(wrote.status).toBe(201)

    expect((await leave()).status).toBe(200)

    const listed = await call<LeavingView>(env, '/v1/spaces', { token: other })
    expect(listed.json.spaces?.map((one) => one.id)).toContain(theirs)

    const changes = await call<LeavingView>(env, `/v1/spaces/${theirs}/changes?since=0`, {
      token: other,
    })
    expect(changes.json.notes?.map((one) => one.path)).toContain('mine in theirs.md')

    const shared = await call<LeavingView>(env, `/v1/spaces/${theirs}/share`, { token: other })
    expect(shared.json.members?.map((one) => one.email)).not.toContain(ME)
  })

  test('its own space goes for everybody it was shared with', async () => {
    const other = await signIn(env, OTHER)
    const mine = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Mine' } }))
      .json.space?.id
    const note = (
      await call<LeavingView>(env, `/v1/spaces/${mine}/notes`, {
        token,
        body: { path: 'shared.md', content: 'x' },
      })
    ).json.note?.id

    const sent = await mail(() =>
      call(env, `/v1/spaces/${mine}/share/invite`, { token, body: { email: OTHER, role: 'read' } }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    await call(env, `/v1/join/${link}`, { method: 'POST', token: other })
    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(200)

    expect((await leave()).status).toBe(200)

    expect((await call(env, `/v1/notes/${note}`, { token: other })).status).toBe(404)
    const listed = await call<LeavingView>(env, '/v1/spaces', { token: other })
    expect(listed.json.spaces?.map((one) => one.id)).not.toContain(mine)
  })

  test('a picture another account holds too stays; its own goes', async () => {
    const other = await signIn(env, OTHER)
    const both = 'c'.repeat(64)
    const alone = 'a'.repeat(64)

    for (const [hash, as] of [
      [both, token],
      [both, other],
      [alone, token],
    ] as const) {
      await call(env, `/v1/blobs/${hash}`, {
        method: 'PUT',
        token: as,
        raw: new Uint8Array([1, 2, 3]),
        headers: { 'content-type': 'image/png' },
      })
    }

    expect((await leave()).status).toBe(200)

    expect((await call(env, `/i/${both}.png`)).status).toBe(200)
    expect((await call(env, `/i/${alone}.png`)).status).toBe(404)
    expect(env.keys()).toContain(`blobs/${both}`)
    expect(env.keys()).not.toContain(`blobs/${alone}`)
  })

  test('a picture it put into a space that stays is handed to that space’s owner', async () => {
    const other = await signIn(env, OTHER)
    const theirs = (
      await call<LeavingView>(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    ).json.space?.id

    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: other,
        body: { email: ME, role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })

    const pasted = 'd'.repeat(64)
    const kept = 'e'.repeat(64)
    for (const hash of [pasted, kept]) {
      await call(env, `/v1/blobs/${hash}`, {
        method: 'PUT',
        token,
        raw: new Uint8Array([4, 5, 6]),
        headers: { 'content-type': 'image/png' },
      })
    }

    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'with a picture.md', content: `![](https://nibeditor.com/i/${pasted}.png)` },
    })

    expect((await leave()).status).toBe(200)

    expect((await call(env, `/i/${pasted}.png`)).status).toBe(200)
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(pasted)).toEqual([
      { user_id: (await me(other)).json.user?.id },
    ])
    // Only what that space shows: the one it never used went with the account.
    expect((await call(env, `/i/${kept}.png`)).status).toBe(404)
  })

  test('a published site stops answering', async () => {
    const space = (await call<LeavingView>(env, '/v1/spaces', { token, body: { name: 'Site' } }))
      .json.space?.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'index.md', content: '# Hello' },
    })
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'leaving' },
    })

    const host = 'leaving.nibeditor.com'
    expect((await call(env, '/', { host })).status).toBe(200)

    expect((await leave()).status).toBe(200)

    expect((await call(env, '/', { host })).status).toBe(302)
  })
})
