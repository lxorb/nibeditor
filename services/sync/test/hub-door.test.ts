/** The door to a hub: which sockets it lets in, as whom, and to which hub. The
 *  namespace here leads nowhere and keeps what the door told it, the way the room
 *  door's tests watch it decide; see room.ts `doorway`. */

import { subprotocol } from '@nib/rooms'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'

const DEVICE = 'device-laptop'

/** A namespace that answers every ask and remembers what it was told. */
function doorway(): { HUB: DurableObjectNamespace; asked: { id: string; headers: Headers }[] } {
  const asked: { id: string; headers: Headers }[] = []
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({ id: String(id), headers: request.headers })
        // Not 101: a Response cannot be made with that status outside the runtime.
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    }),
  }
  return { HUB: namespace as unknown as DurableObjectNamespace, asked }
}

describe('the hub door', () => {
  let env: TestEnv
  let door: ReturnType<typeof doorway>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 30, 12))
    door = doorway()
    env = testEnv({ HUB: door.HUB })
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  /** A session for an address, with the clock moved past the gap between two codes
   *  to one address so the next sign-in can have one. */
  async function session(email: string): Promise<string> {
    const token = await signIn(env, email)
    vi.setSystemTime(Date.now() + 31_000)
    return token
  }

  const knock = (protocols: string[], upgrade = true) =>
    call(env, '/v2/hub', {
      headers: {
        ...(upgrade ? { upgrade: 'websocket' } : {}),
        'sec-websocket-protocol': protocols.join(', '),
      },
    })

  const userId = (email: string) =>
    (env.db.prepare('select id from users where email = ?').get(email) as { id: string }).id

  test('is a socket and nothing else', async () => {
    expect((await knock([], false)).status).toBe(426)
  })

  test('lets an account in to its own hub, as the device it names', async () => {
    const token = await session('a@example.com')
    const answer = await knock([subprotocol(token), `nib.device.${DEVICE}`])

    expect(answer.status).toBe(200)
    // The device's protocol is named back, and the token is not.
    expect(answer.headers.get('sec-websocket-protocol')).toBe(`nib.device.${DEVICE}`)

    const [asked] = door.asked
    expect(asked?.id).toBe(userId('a@example.com'))
    expect(asked?.headers.get('x-nib-hub')).toBe('join')
    expect(asked?.headers.get('x-nib-device')).toBe(DEVICE)
    expect(asked?.headers.get('x-nib-who')).toBe(userId('a@example.com'))
    expect(asked?.headers.get('x-nib-guest')).toBe('no')
    expect(asked?.headers.get('x-nib-session')).toBe(
      (
        env.db
          .prepare('select id from sessions where user_id = ?')
          .get(userId('a@example.com')) as {
          id: string
        }
      ).id,
    )
  })

  test('turns away a socket with no session, or a program’s token', async () => {
    expect((await knock([subprotocol('nope'), `nib.device.${DEVICE}`])).status).toBe(401)

    const token = await session('a@example.com')
    const minted = await call<{ token: string }>(env, '/v1/mcp/token', {
      token,
      body: { readOnly: false },
    })
    const program = await knock([subprotocol(minted.json.token), `nib.device.${DEVICE}`])
    expect(program.status).toBe(401)
    expect(door.asked).toEqual([])
  })

  test('wants the device named', async () => {
    const token = await session('a@example.com')
    expect((await knock([subprotocol(token)])).status).toBe(400)
    expect((await knock([subprotocol(token), 'nib.device.no/slash'])).status).toBe(400)
  })

  test('keeps a device to the account and the session it said hello with', async () => {
    const first = await session('a@example.com')
    const other = await session('b@example.com')
    env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, created_at)
         select ?, user_id, id, 'Laptop', 'windows', 1 from sessions where user_id = ?`,
      )
      .run(DEVICE, userId('a@example.com'))

    // Another account naming it.
    const theirs = await knock([subprotocol(other), `nib.device.${DEVICE}`])
    expect(theirs.status).toBe(403)

    // Another live session of the same account naming it.
    const again = await session('a@example.com')
    expect((await knock([subprotocol(again), `nib.device.${DEVICE}`])).status).toBe(409)

    // The session it said hello with.
    expect((await knock([subprotocol(first), `nib.device.${DEVICE}`])).status).toBe(200)
  })

  test('lets a device bind to its next session once the last one has ended', async () => {
    const first = await session('a@example.com')
    env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, created_at)
         select ?, user_id, id, 'Laptop', 'windows', 1 from sessions where user_id = ?`,
      )
      .run(DEVICE, userId('a@example.com'))
    await call(env, '/v1/auth/signout', { method: 'POST', token: first })

    const next = await session('a@example.com')
    expect((await knock([subprotocol(next), `nib.device.${DEVICE}`])).status).toBe(200)
  })

  test('lets a guest in to a hub of its own', async () => {
    const owner = await session('owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Shared' } })).json
      .space.id
    const link = await call<{ link: { url: string } }>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const joined = await call(
      env,
      `/v1/join/${/\/join\/([a-f0-9]+)/.exec(link.json.link.url)?.[1] ?? ''}`,
      {
        method: 'POST',
      },
    )
    const guest = joined.json.token

    const answer = await knock([subprotocol(guest), `nib.device.${DEVICE}`])
    expect(answer.status).toBe(200)

    const asked = door.asked.at(-1)
    expect(asked?.headers.get('x-nib-guest')).toBe('yes')
    expect(asked?.id).toBe(joined.json.guest.id)
    expect(asked?.id).not.toBe(userId('owner@example.com'))
  })

  test('says to come back when there is no hub to reach', async () => {
    delete env.HUB
    const token = await session('a@example.com')
    const answer = await knock([subprotocol(token), `nib.device.${DEVICE}`])
    expect(answer.status).toBe(503)
    expect(answer.headers.get('retry-after')).toBe('1')
  })
})
