/** The door to an account's hub: who may open the socket, and which hub it leads to.
 *
 *  A socket carries no `Authorization` header, so it names its session token in
 *  the subprotocol the way a room's socket does (`nib.token.<token>`, see
 *  @nib/rooms), beside the device it is (`nib.device.<id>`), and it is let in ahead
 *  of the session guard. A session of an account leads to that account's hub, and a
 *  guest's to a hub of the guest's own, which hears the pokes of the spaces its
 *  links reach and nothing else. A program's `nib_` token opens nothing here.
 *
 *  A device is bound to the session it said hello with. The same id arriving on
 *  another session that is still alive is refused, and so is an id another account
 *  already has: a device id is not a secret, and without that any session of the
 *  account could speak for any of its devices. A device whose session ended - signed
 *  out, or ended from another - binds to its next one at its next hello. */

import { Hono } from 'hono'
import { tokenOf } from '@nib/rooms'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { SIGN_IN } from '../refused'
import type { Env } from '../types'
import { DEVICE } from './frames'
import { askHub, HUB_AWAY } from './reach'

const DEVICE_PROTOCOL = 'nib.device.'

/** The session behind the token, of either kind, and what the device it names is
 *  already bound to. One round trip, because a device is waiting on it. */
const WHO = `with me as (
  select s.user_id as user_id, s.id as session_id, null as guest_id
    from sessions s where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as session_id, g.guest_id as guest_id
    from guest_sessions g where g.token_hash = ?1 and g.expires_at > ?2
)
select me.user_id as user_id, me.session_id as session_id, me.guest_id as guest_id,
       d.user_id as owner, d.session_id as bound,
       (select 1 from sessions b where b.id = d.session_id and b.expires_at > ?2) as bound_alive
  from me left join devices d on d.id = ?3`

/** The device a socket says it is, off its subprotocols. */
function deviceProtocol(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const id = offered.find((one) => one.startsWith(DEVICE_PROTOCOL))?.slice(DEVICE_PROTOCOL.length)
  return id && DEVICE.test(id) ? id : null
}

export const hubDoor = new Hono<{ Bindings: Env }>()

hubDoor.get('/', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a hub is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered)
  const device = deviceProtocol(offered)

  const row = await context.env.DB.prepare(WHO)
    .bind(await sha256(token ?? ''), now(), device ?? '')
    .first<{
      user_id: string | null
      session_id: string | null
      guest_id: string | null
      owner: string | null
      bound: string | null
      bound_alive: number | null
    }>()

  const who = row?.user_id ?? row?.guest_id
  if (!row || !who) return context.json({ error: SIGN_IN }, 401)
  if (!device) return context.json({ error: 'a hub socket names its device' }, 400)

  if (row.user_id) {
    if (row.owner && row.owner !== row.user_id) {
      return context.json({ error: 'that device belongs to another account' }, 403)
    }
    if (row.bound && row.bound !== row.session_id && row.bound_alive) {
      return context.json({ error: 'that device is signed in with another session' }, 409)
    }
  }

  const answer = await askHub(context.env, who, 'join', {
    upgrade: 'websocket',
    'x-nib-device': device,
    'x-nib-who': who,
    'x-nib-session': row.session_id ?? '',
    'x-nib-guest': row.user_id ? 'no' : 'yes',
  })

  // A handshake with nothing on it cannot be passed on, and a hub that did not
  // answer is a moment to wait through: the app's socket comes back on its own
  // backoff, as it does for a room.
  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    if (context.env.HUB) note(`hub ${who}`, new Error('the hub did not take the socket'), null)
    return context.json({ error: HUB_AWAY }, 503, {
      'retry-after': '1',
    })
  }

  // The browser refuses the socket unless the server names one of the offered
  // subprotocols back. The device's, rather than the token's, so the token is not
  // written into one more response.
  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', `${DEVICE_PROTOCOL}${device}`)

  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})
