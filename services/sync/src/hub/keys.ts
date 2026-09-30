/** The web key's relay: a new computer asks, one that has the key approves, and
 *  the hub carries the two halves between them without ever holding the key.
 *
 *  The key only ever travels wrapped to a device's public key, so what passes
 *  through here is ciphertext; what the person compares is six digits worked out
 *  from the new computer's public key on both screens, which is what a hub that
 *  swapped in a key of its own could not match. Bitwarden's "log in with device" is
 *  the same shape, and its fifteen minutes is where a request's life comes from: a
 *  request lives while the asking computer is connected and fifteen minutes after,
 *  so an approval prompt never turns up long after anybody was waiting on it.
 *
 *  Three kinds of grant are told apart here. A computer on an account that has no
 *  key left makes one and wraps it to itself, and whatever was sealed under the
 *  key before is let go of, since nothing can open it. A computer with the key
 *  approves one that asked. And after a device was ended, the next computer to
 *  upload moves everybody left to a new generation, one grant each. See
 *  docs/sync-v2.md section 6.6. */

import { forgetMailed, mailer, mayMail, webKeyMessage } from '../email'
import { note } from '../failed'
import { mayAskForWebKey } from '../limits'
import { TRY_IN_AN_HOUR } from '../refused'
import type { Env } from '../types'
import { setPublicKey } from './devices'
import { type FromDevice, say } from './frames'
import { type Attached, attach, attachedTo, everySocket, socketOf, socketsOf } from './sockets'
import { wipeWebState } from './bucket'

/** How long a request for the key outlives the asking computer's socket. */
const WANT_FOR = 15 * 60 * 1000

const WANT = 'want:'

/** An Allow pressed after the request it answers has lapsed, or was answered. */
const NO_LONGER_WAITING = 'that computer is no longer waiting'

/** What the hub is, as much of it as the relay uses. `rotated` is told when a new
 *  key was made, which ends any rotation that was owed. */
export interface Relay {
  ctx: DurableObjectState
  env: Env
  rotated(): Promise<void>
}

interface Want {
  pub: string
  name: string
  at: number
}

function readWant(value: unknown): Want | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Partial<Want>
  return typeof one.pub === 'string' && typeof one.name === 'string' && typeof one.at === 'number'
    ? { pub: one.pub, name: one.name, at: one.at }
    : null
}

function stillWanted(relay: Relay, device: string, want: Want): boolean {
  return socketOf(relay.ctx, device) !== null || Date.now() - want.at < WANT_FOR
}

/** Says something to every device that holds the key, which are the ones that
 *  can answer a request. */
function toKeyHolders(relay: Relay, frame: Parameters<typeof say>[1], except?: string): void {
  for (const { socket, attached } of everySocket(relay.ctx)) {
    if (attached.keyed && attached.device !== except) say(socket, frame)
  }
}

/** A computer without the key asks for it. Asked again with the same public key
 *  it is the same request, carried to the key holders again and not counted twice:
 *  a computer on a flaky connection asks on every reconnect. */
export async function wantKey(
  relay: Relay,
  socket: WebSocket,
  me: Attached,
  pub: string,
): Promise<void> {
  if (me.keyed) return

  const held = readWant(await relay.ctx.storage.get(WANT + me.device))
  const again = held?.pub === pub && stillWanted(relay, me.device, held)

  if (!again && !(await mayAskForWebKey(relay.env, me.who))) {
    say(socket, { t: 'refused', to: 'want-key', error: TRY_IN_AN_HOUR })
    return
  }

  if (!(await setPublicKey(relay.env, me.who, me.device, pub))) return

  await relay.ctx.storage.put(WANT + me.device, { pub, name: me.name, at: Date.now() })
  toKeyHolders(relay, { t: 'key-wanted', device: me.device, name: me.name, pub }, me.device)
}

/** Every request still waiting, for a key holder that has just connected. */
export async function wantedOf(relay: Relay, socket: WebSocket, me: Attached): Promise<void> {
  if (!me.keyed) return

  const pending = await relay.ctx.storage.list({ prefix: WANT })
  for (const [name, value] of pending) {
    const device = name.slice(WANT.length)
    const want = readWant(value)
    if (!want || device === me.device) continue

    if (stillWanted(relay, device, want)) {
      say(socket, { t: 'key-wanted', device, name: want.name, pub: want.pub })
    } else {
      await relay.ctx.storage.delete(name)
    }
  }
}

/** What a grant is, given what the account holds. Null is a grant the hub
 *  refuses; `again` is one somebody else already gave (two computers pressing
 *  Allow at once), which changes nothing. */
export type GrantKind = 'made' | 'approved' | 'rotated' | 'again' | null

export function grantKind(grant: {
  toSelf: boolean
  /** How many devices hold the key at all. */
  holders: number
  /** Whether the granting device holds it. */
  mine: boolean
  /** The account's newest generation, and the target's own, where it has one. */
  current: number | null
  held: number | null
  wanted: boolean
  generation: number
}): GrantKind {
  if (grant.holders === 0) return grant.toSelf ? 'made' : null
  if (!grant.mine || grant.current === null) return null

  if (grant.generation === grant.current + 1) return 'rotated'
  if (grant.generation !== grant.current) return null

  if (grant.held === grant.current) return 'again'
  if (grant.held !== null) return 'rotated'
  return grant.wanted ? 'approved' : null
}

export async function grantKey(
  relay: Relay,
  socket: WebSocket,
  me: Attached,
  grant: Extract<FromDevice, { t: 'grant-key' }>,
): Promise<void> {
  const { env } = relay
  const row = await env.DB.prepare(
    `select d.name as name,
            (select generation from web_keys k where k.user_id = d.user_id and k.device_id = d.id)
              as held,
            (select max(generation) from web_keys k where k.user_id = d.user_id) as current,
            (select count(*) from web_keys k where k.user_id = d.user_id) as holders,
            (select 1 from web_keys k where k.user_id = d.user_id and k.device_id = ?3) as mine
       from devices d where d.id = ?1 and d.user_id = ?2 and d.revoked_at is null`,
  )
    .bind(grant.to, me.who, me.device)
    .first<{
      name: string
      held: number | null
      current: number | null
      holders: number
      mine: number | null
    }>()
  if (!row) return

  const want = readWant(await relay.ctx.storage.get(WANT + grant.to))
  const kind = grantKind({
    toSelf: grant.to === me.device,
    holders: row.holders,
    mine: row.mine === 1,
    current: row.current,
    held: row.held,
    wanted: want !== null && stillWanted(relay, grant.to, want),
    generation: grant.generation,
  })

  if (kind === null) {
    const lapsed = row.mine === 1 && row.held === null && grant.generation === row.current
    say(socket, {
      t: 'refused',
      to: 'grant-key',
      error: lapsed ? NO_LONGER_WAITING : 'that key is out of date',
    })
    return
  }
  if (kind === 'again') return

  // A fresh key on an account that had one: what was sealed under the old one can
  // never be opened again, and would only sit in the quota.
  if (kind === 'made') {
    await wipeWebState(env, me.who)
    await relay.rotated()
  }

  await env.DB.prepare(
    `insert into web_keys (user_id, device_id, wrapped, generation) values (?, ?, ?, ?)
     on conflict(user_id, device_id) do update set
       wrapped = excluded.wrapped, generation = excluded.generation`,
  )
    .bind(me.who, grant.to, grant.wrapped, grant.generation)
    .run()

  for (const target of socketsOf(relay.ctx, grant.to)) {
    const attached = attachedTo(target)
    if (attached) attach(target, { ...attached, keyed: true })
    say(target, { t: 'key', wrapped: grant.wrapped, generation: grant.generation })
  }

  if (want) await settled(relay, grant.to)
  if (kind === 'approved') await tellTheAddress(env, me.who, row.name)
}

/** A key holder says no. */
export async function denyKey(relay: Relay, me: Attached, to: string): Promise<void> {
  if (!me.keyed) return
  if (!readWant(await relay.ctx.storage.get(WANT + to))) return

  for (const target of socketsOf(relay.ctx, to)) say(target, { t: 'key-denied' })
  await settled(relay, to)
}

/** A device ended while it was asking: its request goes with it. */
export async function forgetWant(relay: Relay, device: string): Promise<void> {
  if (readWant(await relay.ctx.storage.get(WANT + device))) await settled(relay, device)
}

/** A request answered, one way or the other: it is forgotten, and every other key
 *  holder's prompt about it closes. */
async function settled(relay: Relay, device: string): Promise<void> {
  await relay.ctx.storage.delete(WANT + device)
  toKeyHolders(relay, { t: 'key-settled', device }, device)
}

/** The mail that says a computer was given the key, on the same gap and ceilings
 *  as every other message. Never a throw and never a reason to take the grant
 *  back: the key has already gone to the device the person approved. */
async function tellTheAddress(env: Env, user: string, device: string): Promise<void> {
  try {
    const row = await env.DB.prepare('select email from users where id = ?')
      .bind(user)
      .first<{ email: string }>()
    if (!row) return

    const allowed = await mayMail(env, row.email, null)
    if (!allowed.ok) return

    const message = webKeyMessage(device, env.APP_ORIGIN)
    if (!(await mailer(env).send(row.email, message.subject, message))) {
      await forgetMailed(env, row.email)
    }
  } catch (error) {
    note('web key mail', error, null)
  }
}
