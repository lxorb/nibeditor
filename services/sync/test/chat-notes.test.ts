/** A note dropped into a chat (docs/chats.md 4.13): who in the chat cannot open it, and
 *  the owner's one press that shares it with them to read, with nobody else let in and
 *  nobody asking about a note they cannot reach themselves. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { chatLogs } from './chat-fakes'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { hubs } from './hub-fakes'

const T0 = Date.UTC(2026, 9, 7, 12)
const at = (ms: number) => vi.setSystemTime(T0 + ms)

let env: TestEnv
let owner: string
let lucile: string
let mia: string
let lucileId: string
let chat: string
let thesis: string
let notes: string
let note: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(0)
  env = testEnv()
  env.CHATS = chatLogs(env).CHATS
  env.HUB = hubs(env).HUB

  owner = await signIn(env, 'owner@example.com')
  thesis = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Thesis' } })).json.space
    .id
  notes = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })).json.space.id
  for (const [email, step] of [
    ['lucile@example.com', 1],
    ['mia@example.com', 2],
  ] as const) {
    await call(env, `/v1/spaces/${thesis}/share/invite`, {
      token: owner,
      body: { email, role: 'write' },
    })
    at(31_000 * step)
  }
  lucile = await signIn(env, 'lucile@example.com')
  await call(env, '/v1/me', { method: 'PATCH', token: lucile, body: { name: 'Lucile' } })
  lucileId = (await call(env, '/v1/me', { token: lucile })).json.user.id
  mia = await signIn(env, 'mia@example.com')
  // Mia holds the notes' space too; Lucile does not.
  await call(env, `/v1/spaces/${notes}/share/invite`, {
    token: owner,
    body: { email: 'mia@example.com', role: 'read' },
  })
  at(100_000)

  chat = (await call<{ chat: string }>(env, '/v2/chats', { token: owner, body: { space: thesis } }))
    .json.chat
  note = (
    await call(env, `/v1/spaces/${notes}/notes`, {
      token: owner,
      body: { path: 'Plan.md', content: '# Plan\n' },
    })
  ).json.note.id
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

const ask = (token: string) =>
  call<{ missing: { who: string; name: string | null }[]; share: boolean; error?: string }>(
    env,
    `/v2/chats/${chat}/note?space=${notes}&note=${note}`,
    { token },
  )

describe('a note dropped into a chat', () => {
  test('names those in the chat who cannot open it, and that the owner may share it', async () => {
    const { json } = await ask(owner)
    expect(json).toEqual({ missing: [{ who: `user:${lucileId}`, name: 'Lucile' }], share: true })
    expect((await ask(mia)).json.share).toBe(false)
  })

  test('is shared to read with them in one press, and with nobody else', async () => {
    const shared = await call(env, `/v2/chats/${chat}/note`, {
      token: owner,
      body: { space: notes, note },
    })
    expect(shared.json).toEqual({ shared: 1 })
    expect((await ask(owner)).json.missing).toEqual([])
    const rows = env.db
      .prepare('select email, item, role from space_members where space_id = ? order by email')
      .all(notes)
    expect(rows).toEqual([
      { email: 'lucile@example.com', item: note, role: 'read' },
      { email: 'mia@example.com', item: '', role: 'read' },
    ])
  })

  test('is asked about only by somebody who reaches it, and shared only by its owner', async () => {
    expect((await ask(lucile)).status).toBe(404)
    const refused = await call(env, `/v2/chats/${chat}/note`, {
      token: mia,
      body: { space: notes, note },
    })
    expect(refused.status).toBe(403)
  })
})
