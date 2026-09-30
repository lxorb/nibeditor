/** The account's devices: what each one is called, which session it signed in
 *  with, and ending one.
 *
 *  A device registers itself with its hub's `hello` rather than through a route,
 *  because the socket is the one thing every device opens anyway. Its name is the
 *  account's once written - a device announces what it works out about itself, and
 *  a name somebody chose in the Account pane is not the device's to take back - but
 *  its platform, its app's version and its public key are the device's to keep
 *  current.
 *
 *  Ending one is what somebody does about a laptop that has gone missing, the way
 *  Google's device list and Signal's linked devices do it: its sessions end, the web
 *  key wrapped to it is deleted and the next upload moves the account to a new one,
 *  its hub socket is closed, and so are its rooms. Ending its session from the
 *  sessions list does the same; see auth.ts. See docs/sync-v2.md section 6.6. */

import { Hono } from 'hono'
import { tokenIn } from '../auth'
import { readBody } from '../body'
import { chunks, places } from '../bound'
import { now, sha256 } from '../crypto'
import { roomsSignedOut } from '../rooms'
import type { Env, Variables } from '../types'
import { deviceIn } from '../versions'
import { askHub } from './reach'

/** A device's own words about itself, as `hello` brings them. */
export interface Hello {
  device: string
  name: string
  platform: string
  app: string
  pub?: string
}

/** The web key as the account holds it for one device. */
export interface WrappedKey {
  wrapped: string
  generation: number
}

const NO_SUCH_DEVICE = 'no such device'

/** The device this request's session belongs to, or null for a session no device
 *  has said hello with. What the web routes ask: a web state is written by a
 *  device, and the session is what proves which. */
export async function deviceOfSession(
  env: Env,
  user: string,
  header: string | undefined,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `select d.id as id from devices d join sessions s on s.id = d.session_id
      where s.token_hash = ? and d.user_id = ? and d.revoked_at is null`,
  )
    .bind(await sha256(tokenIn(header) ?? ''), user)
    .first<{ id: string }>()

  return row?.id ?? null
}

/** A device saying hello: made the first time, brought up to date after that, and
 *  bound to the session its socket carries. A public key that changed takes the key
 *  wrapped to the old one with it, because nothing can open that any more. Answers
 *  what the hub calls it, and the web key wrapped to it where there is one. */
export async function register(
  env: Env,
  user: string,
  session: string,
  hello: Hello,
): Promise<{ name: string; key: WrappedKey | null }> {
  const before = await env.DB.prepare('select public_key from devices where id = ? and user_id = ?')
    .bind(hello.device, user)
    .first<{ public_key: string | null }>()

  const at = now()
  const row = await env.DB.prepare(
    `insert into devices (id, user_id, session_id, name, platform, public_key, app, created_at,
                          last_seen_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     on conflict(id) do update set
       session_id = excluded.session_id, platform = excluded.platform, app = excluded.app,
       public_key = coalesce(excluded.public_key, devices.public_key),
       last_seen_at = excluded.last_seen_at, revoked_at = null
     where devices.user_id = excluded.user_id
     returning name`,
  )
    .bind(
      hello.device,
      user,
      session,
      deviceIn(hello.name) || hello.platform,
      hello.platform,
      hello.pub ?? null,
      hello.app,
      at,
    )
    .first<{ name: string }>()

  if (hello.pub && before?.public_key && before.public_key !== hello.pub) {
    await dropKey(env, user, hello.device)
  }

  return { name: row?.name ?? hello.name, key: await keyOf(env, user, hello.device) }
}

/** The public key a device asks for the web key with, written to its row. Answers
 *  false for a device the account does not have. */
export async function setPublicKey(
  env: Env,
  user: string,
  device: string,
  pub: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'select public_key from devices where id = ? and user_id = ? and revoked_at is null',
  )
    .bind(device, user)
    .first<{ public_key: string | null }>()
  if (!row) return false
  if (row.public_key === pub) return true

  await env.DB.prepare('update devices set public_key = ? where id = ? and user_id = ?')
    .bind(pub, device, user)
    .run()
  await dropKey(env, user, device)
  return true
}

async function keyOf(env: Env, user: string, device: string): Promise<WrappedKey | null> {
  return await env.DB.prepare(
    'select wrapped, generation from web_keys where user_id = ? and device_id = ?',
  )
    .bind(user, device)
    .first<WrappedKey>()
}

function dropKey(env: Env, user: string, device: string) {
  return env.DB.prepare('delete from web_keys where user_id = ? and device_id = ?')
    .bind(user, device)
    .run()
}

/** When a device was last connected, written as its socket closes. */
export async function markSeen(env: Env, user: string, device: string): Promise<void> {
  await env.DB.prepare('update devices set last_seen_at = ? where id = ? and user_id = ?')
    .bind(now(), device, user)
    .run()
}

/** Ends one device: its session, the web key wrapped to it, its hub socket and its
 *  rooms. Answers false for a device the account does not have, or has already
 *  ended. */
async function revokeDevice(env: Env, user: string, device: string): Promise<boolean> {
  if (!(await endDevice(env, user, device))) return false

  // Its rooms, through the one door that closes somebody's rooms: every room of the
  // account, since the rooms know people rather than devices, and the account's
  // other devices rejoin at once. See `roomsSignedOut`.
  await roomsSignedOut(env, user)
  return true
}

/** The device's half of ending it, for a caller that closes the rooms itself. The
 *  hub is told the account's key generation when the device held the key, so the
 *  next upload moves everybody left to a new one. */
async function endDevice(env: Env, user: string, device: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `select d.session_id as session,
            (select 1 from web_keys k where k.user_id = d.user_id and k.device_id = d.id) as keyed,
            (select max(generation) from web_keys k where k.user_id = d.user_id) as generation
       from devices d where d.id = ? and d.user_id = ? and d.revoked_at is null`,
  )
    .bind(device, user)
    .first<{ session: string | null; keyed: number | null; generation: number | null }>()
  if (!row) return false

  await env.DB.batch([
    env.DB.prepare('delete from web_keys where user_id = ? and device_id = ?').bind(user, device),
    env.DB.prepare(
      'update devices set revoked_at = ?, session_id = null where id = ? and user_id = ?',
    ).bind(now(), device, user),
    env.DB.prepare('delete from sessions where user_id = ? and id = ?').bind(
      user,
      row.session ?? '',
    ),
  ])

  await askHub(env, user, 'revoke', {
    'x-nib-device': device,
    ...(row.keyed && row.generation ? { 'x-nib-rotate': String(row.generation) } : {}),
  })
  return true
}

/** The devices signed in with these sessions, ended with them. What ending a
 *  session from the sessions list, or signing out, does to the device behind it;
 *  the session rows are already gone, and the caller has closed the rooms. */
export async function devicesEnded(
  env: Env,
  user: string,
  sessions: readonly string[],
): Promise<void> {
  for (const chunk of chunks(sessions)) {
    const { results } = await env.DB.prepare(
      `select id from devices
        where user_id = ? and revoked_at is null and session_id in (${places(chunk.length)})`,
    )
      .bind(user, ...chunk)
      .all<{ id: string }>()

    for (const { id } of results) await endDevice(env, user, id)
  }
}

export const devices = new Hono<{ Bindings: Env; Variables: Variables }>()

devices.get('/', async (context) => {
  const user = context.get('user')
  const mine = await sha256(tokenIn(context.req.header('authorization')) ?? '')

  const { results } = await context.env.DB.prepare(
    `select d.id, d.name, d.platform, d.app, d.created_at, d.last_seen_at,
            (select 1 from sessions s where s.id = d.session_id and s.token_hash = ?2) as current,
            (select 1 from web_keys k where k.user_id = d.user_id and k.device_id = d.id) as keyed
       from devices d
      where d.user_id = ?1 and d.revoked_at is null
      order by d.last_seen_at desc, d.created_at desc`,
  )
    .bind(user.id, mine)
    .all<{
      id: string
      name: string
      platform: string
      app: string | null
      created_at: number
      last_seen_at: number | null
      current: number | null
      keyed: number | null
    }>()

  return context.json({
    devices: results.map((one) => ({
      id: one.id,
      name: one.name,
      platform: one.platform,
      app: one.app ?? '',
      createdAt: one.created_at,
      lastSeenAt: one.last_seen_at,
      // Which row is the one asking, so the app can say "this device".
      current: one.current === 1,
      // Whether it holds the web key: what a new computer reads to know whether
      // anybody can approve it, or whether it makes the key itself.
      webKey: one.keyed === 1,
    })),
  })
})

devices.patch('/:id', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const given = body.text('name', 400)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const name = deviceIn(given ?? '')
  if (!name) return context.json({ error: 'give the device a name' }, 400)

  const id = context.req.param('id')
  const changed = await context.env.DB.prepare(
    'update devices set name = ? where id = ? and user_id = ? and revoked_at is null',
  )
    .bind(name, id, user.id)
    .run()
  if (!changed.meta.changes) return context.json({ error: NO_SUCH_DEVICE }, 404)

  // And the name the hub gives it when it tells another device where a site is open.
  await askHub(context.env, user.id, 'renamed', {
    'x-nib-device': id,
    'x-nib-name': encodeURIComponent(name),
  })
  return context.json({ ok: true, name })
})

devices.delete('/:id', async (context) => {
  const user = context.get('user')
  const ended = await revokeDevice(context.env, user.id, context.req.param('id'))
  if (!ended) return context.json({ error: NO_SUCH_DEVICE }, 404)
  return context.json({ ok: true })
})
