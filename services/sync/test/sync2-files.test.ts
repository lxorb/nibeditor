/** Every file of a space, through sync v2 (docs/sync-v2.md section 5.8): bytes up as
 *  blobs by hash, in one request or in parts, checked against their name; an entry in
 *  the tree for each; the bytes back down to members of the space and nobody else;
 *  a replacement that the later arrival wins and that says so to a device that
 *  replaced it too. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { OpsResponse } from '@nib/sync-core'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { invited, live } from './sync2'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  live(env)
  token = await signIn(env, 'files@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Files' } })).json.space.id
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
})

afterEach(() => env.close())

async function hashOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytes(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, at) => (at * 31 + seed) % 251)
}

async function upload(data: Uint8Array, type = 'audio/webm', as = token) {
  return call(env, `/v2/blobs/${await hashOf(data)}`, {
    method: 'PUT',
    token: as,
    raw: data,
    headers: { 'content-type': type },
  })
}

let counter = 0
async function place(name: string, hash: string, as = token): Promise<OpsResponse> {
  counter += 1
  const id = `file-${String(counter)}`
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token: as,
    body: {
      ops: [{ op: `op-${id}`, t: 'create', id, kind: 'file', parent: null, name, hash, seen: 0 }],
    },
  })
  return answer.json
}

describe('bytes up', () => {
  test('any kind of file, in one request, kept under its own hash and counted against the account', async () => {
    const data = bytes(4096)
    const before = (await call(env, '/v1/usage', { token })).json.used

    const answer = await upload(data)
    expect(answer.status).toBe(201)
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(before + 4096)

    // Once is enough: the same bytes again are already kept.
    expect((await upload(data)).json.stored).toBe(false)
  })

  test('refused under a hash that is not theirs', async () => {
    const answer = await call(env, `/v2/blobs/${'0'.repeat(64)}`, {
      method: 'PUT',
      token,
      raw: bytes(10),
      headers: { 'content-type': 'audio/webm' },
    })
    expect(answer.status).toBe(400)
    expect(env.keys().some((key) => key.startsWith('blobs/'))).toBe(false)
  })

  test('in parts, put together, measured and hashed before they are kept', async () => {
    const data = bytes(20_000, 7)
    const hash = await hashOf(data)
    const started = await call<{ upload: string; part: number }>(env, '/v2/blobs/parts', {
      token,
      body: { hash, size: data.length, type: 'video/mp4' },
    })
    expect(started.status).toBe(201)

    const parts: { part: number; etag: string }[] = []
    for (const [at, from] of [0, 12_000].entries()) {
      const sent = await call<{ part: number; etag: string }>(
        env,
        `/v2/blobs/parts/${started.json.upload}/${String(at + 1)}`,
        { method: 'PUT', token, raw: data.slice(from, from + 12_000) },
      )
      parts.push(sent.json)
    }

    const done = await call(env, `/v2/blobs/parts/${started.json.upload}`, {
      token,
      body: { parts },
    })
    expect(done.status).toBe(201)
    expect(env.db.prepare('select size from blobs where hash = ?').get(hash)).toEqual({
      size: 20_000,
    })
  })

  test('in parts that are not the bytes named, thrown away', async () => {
    const data = bytes(1000, 3)
    const started = await call<{ upload: string }>(env, '/v2/blobs/parts', {
      token,
      body: { hash: await hashOf(data), size: 1000 },
    })
    const sent = await call<{ part: number; etag: string }>(
      env,
      `/v2/blobs/parts/${started.json.upload}/1`,
      { method: 'PUT', token, raw: bytes(1000, 4) },
    )
    const done = await call(env, `/v2/blobs/parts/${started.json.upload}`, {
      token,
      body: { parts: [sent.json] },
    })
    expect(done.status).toBe(400)
    expect(env.keys().some((key) => key.startsWith('blobs/'))).toBe(false)
  })
})

describe('bytes down', () => {
  test('to the space it is in, and to nobody by its hash alone', async () => {
    const data = bytes(512)
    const hash = await hashOf(data)
    await upload(data)
    const placed = await place('recording.webm', hash)
    const id = 'id' in (placed.results[0] ?? {}) ? (placed.results[0] as { id: string }).id : ''

    const reader = await invited(env, token, space, 'reader@example.com', 'read')
    for (const as of [token, reader]) {
      const got = await call(env, `/v2/files/${space}/${id}`, { token: as })
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toBe('application/octet-stream')
      expect(new TextEncoder().encode(got.text).length).toBeGreaterThan(0)
    }

    const stranger = await signIn(env, 'stranger@example.com')
    expect((await call(env, `/v2/files/${space}/${id}`, { token: stranger })).status).toBe(404)
    expect((await call(env, `/i/${hash}`)).status).toBe(404)
  })

  test('never for bytes only somebody outside the space keeps, whose hash is all anybody knows', async () => {
    const other = await signIn(env, 'other@example.com')
    const data = bytes(300, 9)
    await upload(data, 'application/pdf', other)

    const placed = await place('theirs.pdf', await hashOf(data))
    expect(placed.results[0]).toMatchObject({ refused: 'gone' })
  })
})

describe('a file replaced', () => {
  test('by the later arrival, and a device that replaced it too is told what it is now', async () => {
    const first = bytes(100, 1)
    const second = bytes(100, 2)
    const third = bytes(100, 3)
    for (const one of [first, second, third]) await upload(one)
    const placed = await place('picture.bin', await hashOf(first))
    const id = (placed.results[0] as { id: string }).id

    const laptop = await call(env, `/v2/files/${space}/${id}`, {
      method: 'PUT',
      token,
      body: { hash: await hashOf(second), base: await hashOf(first) },
    })
    expect(laptop.json).toMatchObject({ ok: true })

    const phone = await call<{ moved: { hash: string } }>(env, `/v2/files/${space}/${id}`, {
      method: 'PUT',
      token,
      body: { hash: await hashOf(third), base: await hashOf(first) },
    })
    expect(phone.json.moved.hash).toBe(await hashOf(second))
  })

  test('by nobody who may only read the space', async () => {
    const data = bytes(64)
    await upload(data)
    const placed = await place('a.bin', await hashOf(data))
    const id = (placed.results[0] as { id: string }).id
    const reader = await invited(env, token, space, 'reader2@example.com', 'read')

    const answer = await call(env, `/v2/files/${space}/${id}`, {
      method: 'PUT',
      token: reader,
      body: { hash: await hashOf(data), base: await hashOf(data) },
    })
    expect(answer.status).toBe(403)
  })
})
