/** The switch that lets an account's web logins travel between its computers: off for
 *  every account until it is flipped, and said by `/v1/me`, which is where the app reads
 *  it as it starts. See migrations/0043_web_sync.sql and docs/sync-v2.md section 11. */

import { afterEach, beforeEach, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'

interface Me {
  user?: { id: string; email: string; webSync?: boolean }
  guest?: { id: string }
}

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'traveller@example.com')
})

afterEach(() => env.close())

test('is off for an account nobody has flipped', async () => {
  const { status, json } = await call<Me>(env, '/v1/me', { token })

  expect(status).toBe(200)
  expect(json.user?.webSync).toBe(false)
})

test('is on for the account it was flipped for, and no other', async () => {
  const other = await signIn(env, 'stayer@example.com')
  env.db.prepare("update users set web_sync = 1 where email = 'traveller@example.com'").run()

  expect((await call<Me>(env, '/v1/me', { token })).json.user?.webSync).toBe(true)
  expect((await call<Me>(env, '/v1/me', { token: other })).json.user?.webSync).toBe(false)
})
