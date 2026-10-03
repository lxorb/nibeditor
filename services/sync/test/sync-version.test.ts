/** The switch that moves an account's devices to sync v2: 1 for every account until it
 *  is flipped, and said by `/v1/me`, which is where the app reads it as it starts. See
 *  migrations/0040_sync2_tree.sql and docs/sync-v2.md section 11. */

import { afterEach, beforeEach, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'

interface Me {
  user?: { id: string; syncVersion?: number }
}

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'mover@example.com')
})

afterEach(() => env.close())

test('is 1 for an account nobody has flipped', async () => {
  const { status, json } = await call<Me>(env, '/v1/me', { token })

  expect(status).toBe(200)
  expect(json.user?.syncVersion).toBe(1)
})

test('is 2 for the account it was flipped for, and no other, and back again', async () => {
  const other = await signIn(env, 'stayer@example.com')
  env.db.prepare("update users set sync_version = 2 where email = 'mover@example.com'").run()

  expect((await call<Me>(env, '/v1/me', { token })).json.user?.syncVersion).toBe(2)
  expect((await call<Me>(env, '/v1/me', { token: other })).json.user?.syncVersion).toBe(1)

  env.db.prepare("update users set sync_version = 1 where email = 'mover@example.com'").run()
  expect((await call<Me>(env, '/v1/me', { token })).json.user?.syncVersion).toBe(1)
})
