import { describe, expect, test } from 'vitest'
import { unframe } from '@nib/sync-core/wire'
import { testDevice } from './test-device'
import { Refused } from './transport'

/** What a pass hears from the network (transport.ts): an answer, no answer - which stops
 *  the pass and keeps what this device made waiting, the light hollow - or a refusal,
 *  which is said and never read as being offline. */

const SPACE = 'space-1'

async function made(fetch: (request: Request) => Promise<Response>) {
  const files = { 'Plan.md': 'We ship on Monday.\n' }
  const device = await testDevice({ fetch, token: 'token-1', files })
  const core = device.engine.core
  await core.commit(core.addSpace(SPACE, device.root, 'owner'))
  await device.engine.created(`${device.root}/Plan.md`, false, 'We ship on Monday.\n')
  return device
}

describe('the engine over the network', () => {
  test.each([
    ['no network', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a busy account', () => Promise.resolve(new Response('', { status: 429 }))],
    ['a failing account', () => Promise.resolve(new Response('', { status: 503 }))],
  ])('%s is no answer: the pass stops and the new note waits', async (_said, fetch) => {
    const device = await made(fetch)

    expect(await device.engine.pass(SPACE)).toEqual({ pulled: 0, pushed: 0, finished: false })
    expect(device.engine.waiting(SPACE)).toBe(true)
    expect(device.store.rows('log')).toEqual([])
    expect(device.disk.files.get(`${device.root}/Plan.md`)).toBe('We ship on Monday.\n')
  })

  test('a refusal is said and written in the log, never read as offline', async () => {
    const device = await made(() =>
      Promise.resolve(Response.json({ error: 'session ended' }, { status: 401 })),
    )

    const passing = device.engine.pass(SPACE)
    await expect(passing).rejects.toBeInstanceOf(Refused)
    await expect(passing).rejects.toMatchObject({ status: 401, message: 'session ended' })
    expect(device.store.rows('log')).toEqual([
      expect.objectContaining({ space: SPACE, failed: 'session ended' }),
    ])
  })

  test('a request names the session and the device and carries the framed body', async () => {
    const asked: Request[] = []
    const device = await made((request) => {
      asked.push(request)
      return Promise.resolve(new Response('', { status: 503 }))
    })
    await device.engine.pass(SPACE)

    const [ops] = asked
    expect(ops?.method).toBe('POST')
    expect(new URL(ops?.url ?? '').pathname).toBe(`/v2/spaces/${SPACE}/ops`)
    expect(ops?.headers.get('authorization')).toBe('Bearer token-1')
    expect(ops?.headers.get('x-nib-device')).toBe('one')
    expect(ops?.headers.get('content-type')).toBe('application/octet-stream')
    const body = unframe(new Uint8Array(await ops!.arrayBuffer())) as {
      ops: { t: string; name: string }[]
    }
    expect(body.ops).toEqual([expect.objectContaining({ t: 'create', name: 'Plan.md' })])
  })
})
