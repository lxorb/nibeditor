/** The machine's bundle (docs/online-terminal.md 4.15): what a Hetzner server fetches with
 *  no session, at its first boot and before every start of nibd, by its SHA-256. */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { carry } from '../src/machines/bundle'
import { call, type TestEnv, testEnv } from './harness'

const BYTES = new TextEncoder().encode('install.sh and nibd, gzipped')
const SHA = createHash('sha256').update('install.sh and nibd, gzipped').digest('hex')

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
})

describe('the machine bundle', () => {
  test('says its SHA-256 and serves its bytes by it, to anybody', async () => {
    carry(BYTES.slice().buffer)
    const current = await call(env, '/v2/online/machine/current')
    expect(current.status).toBe(200)
    expect(current.text).toBe(SHA)

    const bundle = await call(env, `/v2/online/machine/${SHA}.bin`)
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('cache-control')).toContain('immutable')
    expect(bundle.text).toBe('install.sh and nibd, gzipped')

    expect((await call(env, `/v2/online/machine/${'0'.repeat(64)}.bin`)).status).toBe(404)
  })
})
