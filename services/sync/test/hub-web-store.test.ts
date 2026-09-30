/** Which web store a space's pages live in: the owner's choice, carried on the
 *  listing to everybody in the space. See spaces/web-store.ts and open question 3
 *  in docs/sync-v2.md. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'

interface Listed {
  spaces: { id: string; webStore: string }[]
  webStore: string
  error: string
}

describe('a space’s web store', () => {
  let env: TestEnv
  let owner: string
  let space: string

  beforeEach(async () => {
    env = testEnv()
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Work' } })).json.space.id
  })

  afterEach(() => env.close())

  const storeOf = async (token: string) =>
    (await call<Listed>(env, '/v1/spaces', { token })).json.spaces.find((one) => one.id === space)
      ?.webStore

  const choose = (token: string, store: unknown) =>
    call<Listed>(env, `/v2/spaces/${space}/web-store`, {
      method: 'PUT',
      token,
      body: { store },
    })

  test('is the shared one until the owner chooses', async () => {
    expect(await storeOf(owner)).toBe('global')
  })

  test('is chosen by the owner, and followed by everybody in the space', async () => {
    const member = await signIn(env, 'member@example.com')
    env.db
      .prepare(
        `insert into space_members (space_id, email, item, role, created_at, joined_at)
         values (?, 'member@example.com', '', 'write', 1, 1)`,
      )
      .run(space)

    const chosen = await choose(owner, 'site')
    expect(chosen.status).toBe(200)
    expect(chosen.json.webStore).toBe('site')

    expect(await storeOf(owner)).toBe('site')
    expect(await storeOf(member)).toBe('site')

    const theirs = await choose(member, 'space')
    expect(theirs.status).toBe(403)
    expect(theirs.json.error).toBe('only the owner can do that')
    expect(await storeOf(owner)).toBe('site')
  })

  test('is one of the three', async () => {
    for (const store of ['other', '', 3, null]) {
      expect((await choose(owner, store)).status, String(store)).toBe(400)
    }
    for (const store of ['global', 'space', 'site']) {
      expect((await choose(owner, store)).status, store).toBe(200)
    }
  })

  test('is nothing a program may choose', async () => {
    const minted = await call<{ token: string }>(env, '/v1/mcp/token', {
      token: owner,
      body: { readOnly: false },
    })
    expect((await choose(minted.json.token, 'site')).status).toBe(403)
  })
})
