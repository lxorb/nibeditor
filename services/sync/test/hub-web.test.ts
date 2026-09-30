/** A site's web state as the account keeps it: the ceilings on one site and on
 *  the account, the chunks a state names, and letting go of the ones nothing
 *  names any more. See hub/web.ts and hub/bucket.ts. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MOST_BUNDLE, WEB_QUOTA } from '../src/hub/bucket'
import { call, type TestEnv, testEnv } from './harness'
import { type Computer, computer, type Hubs, hubs, send } from './hub-fakes'

const KEY = 'k'.repeat(43)
const ONE = 'a'.repeat(43)
const TWO = 'b'.repeat(43)

describe('web state', () => {
  let env: TestEnv
  let running: Hubs
  let laptop: Computer

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 30, 12))
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB
    laptop = await computer(env, running, 'web@example.com', 'Laptop')
    await send(running.of(laptop.user).hub, laptop.socket, { t: 'acquire', key: KEY, take: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  const chunk = (name: string, bytes: Uint8Array) =>
    call(env, `/v2/web/chunks/${name}`, { method: 'PUT', token: laptop.token, raw: bytes })

  const manifest = (chunks: string[], bytes = new Uint8Array([7])) =>
    call(env, `/v2/web/${KEY}`, {
      method: 'PUT',
      token: laptop.token,
      raw: bytes,
      headers: { 'x-nib-fence': '1', 'x-nib-generation': '1', 'x-nib-chunks': chunks.join(',') },
    })

  test('keeps a chunk once, by its name', async () => {
    const first = await chunk(ONE, new Uint8Array([1, 2]))
    expect(first.status).toBe(201)
    expect(first.json).toEqual({ name: ONE, stored: true })

    const again = await chunk(ONE, new Uint8Array([1, 2]))
    expect(again.status).toBe(200)
    expect(again.json).toEqual({ name: ONE, stored: false })

    const read = await call(env, `/v2/web/chunks/${ONE}`, { token: laptop.token })
    expect(read.status).toBe(200)
    expect([...new Uint8Array(await new Response(read.text).arrayBuffer())].length).toBe(2)
    expect(env.keys()).toContain(`web/${laptop.user}/chunks/${ONE}`)
  })

  test('takes a manifest only once the chunks it names are there', async () => {
    const early = await manifest([ONE])
    expect(early.status).toBe(400)

    await chunk(ONE, new Uint8Array([1]))
    expect((await manifest([ONE])).json).toEqual({ version: 1 })
  })

  test('refuses a name that could reach outside its own', async () => {
    for (const name of ['short', `${'a'.repeat(20)}.x`, `chunks%2F${'a'.repeat(20)}`]) {
      const answer = await call(env, `/v2/web/${name}`, { token: laptop.token })
      expect(answer.status, name).toBe(400)
    }
  })

  test('holds one site to thirty-two megabytes, manifest and chunks together', async () => {
    env.db
      .prepare('insert into web_chunks (user_id, name, size, at) values (?, ?, ?, ?)')
      .run(laptop.user, ONE, MOST_BUNDLE, Date.now())

    const over = await manifest([ONE])
    expect(over.status).toBe(413)
    expect(over.json.error).toBe('that is more than one site can keep')

    const alone = await call(env, `/v2/web/${KEY}`, {
      method: 'PUT',
      token: laptop.token,
      raw: new Uint8Array(MOST_BUNDLE + 1),
      headers: { 'x-nib-fence': '1', 'x-nib-generation': '1' },
    })
    expect(alone.status).toBe(413)

    const big = await chunk(TWO, new Uint8Array(MOST_BUNDLE + 1))
    expect(big.status).toBe(413)
  })

  test('holds the account to its own five hundred and twelve megabytes', async () => {
    const notes = (await call(env, '/v1/usage', { token: laptop.token })).json.used
    env.db
      .prepare('insert into web_chunks (user_id, name, size, at) values (?, ?, ?, ?)')
      .run(laptop.user, 'c'.repeat(43), WEB_QUOTA, Date.now())

    const refused = await chunk(ONE, new Uint8Array([1]))
    expect(refused.status).toBe(507)
    expect(refused.json.error).toBe('out of space')
    expect((await manifest([])).status).toBe(507)

    // And the notes' quota is none of this: a full web store takes nothing from it.
    const usage = await call(env, '/v1/usage', { token: laptop.token })
    expect(usage.json.used).toBe(notes)
  })

  test('counts the state being replaced as given back', async () => {
    await manifest([], new Uint8Array(1000))
    env.db
      .prepare('insert into web_chunks (user_id, name, size, at) values (?, ?, ?, ?)')
      .run(laptop.user, 'c'.repeat(43), WEB_QUOTA - 1000, Date.now())

    expect((await manifest([], new Uint8Array(1000))).status).toBe(200)
    expect((await manifest([], new Uint8Array(1001))).status).toBe(507)
  })

  test('lets go of chunks nothing names once they have been nobody’s for an hour', async () => {
    await chunk(ONE, new Uint8Array([1]))
    await chunk(TWO, new Uint8Array([2]))
    await manifest([ONE, TWO])

    // The next state names only the first; the second is nobody's from now.
    await manifest([ONE])
    expect(env.keys()).toContain(`web/${laptop.user}/chunks/${TWO}`)

    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    // A state written an hour on is when the hub looks.
    await send(running.of(laptop.user).hub, laptop.socket, { t: 'acquire', key: KEY, take: false })
    expect((await manifest([ONE])).status).toBe(200)

    expect(env.keys()).not.toContain(`web/${laptop.user}/chunks/${TWO}`)
    expect(env.keys()).toContain(`web/${laptop.user}/chunks/${ONE}`)
    expect(
      env.db
        .prepare('select name from web_chunks where user_id = ? order by name')
        .all(laptop.user),
    ).toEqual([{ name: ONE }])
  })

  test('keeps a chunk put up again for a state about to name it', async () => {
    await chunk(TWO, new Uint8Array([2]))
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    // Put up again just now: a device is about to name it.
    expect((await chunk(TWO, new Uint8Array([2]))).json.stored).toBe(false)

    await manifest([])
    expect(env.keys()).toContain(`web/${laptop.user}/chunks/${TWO}`)
  })

  test('is never a download for another account', async () => {
    await manifest([])
    const other = await computer(env, running, 'other@example.com', 'Other')

    const read = await call(env, `/v2/web/${KEY}`, { token: other.token })
    expect(read.status).toBe(404)
  })
})
