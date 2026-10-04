/** Where a device can be pushed to: registered by the device, removed by it or by a
 *  service that says it is gone (send.ts).
 *
 *    GET    /v2/push/key           which services are on, and the VAPID public key
 *    POST   /v2/push/targets       {kind, token, p256dh?, auth?, zone?, device?}
 *    DELETE /v2/push/targets/:id
 *
 *  Behind the session guard, and not a program's or a guest's to reach (index.ts):
 *  a target is a person's own device. One row per token, so a device registering again
 *  replaces its own row rather than adding a second. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { newId, now } from '../crypto'
import type { Env, Variables } from '../types'
import { configured, type TargetKind } from './send'

const KINDS: readonly TargetKind[] = ['webpush', 'fcm', 'apns']

/** How long a token may be: a Web Push endpoint is an address, the rest are shorter. */
const LONGEST_TOKEN = 2048
const LONGEST_KEY = 200
const LONGEST_ZONE = 64

/** How many targets one account keeps; past this the oldest goes. */
const MOST_TARGETS = 20

/** Refusals a correct client never meets, left in English. */
const NOT_A_TARGET = 'not a push target'

/** Whether a zone is one this runtime can read a time in. */
function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const push = new Hono<{ Bindings: Env; Variables: Variables }>()

push.get('/key', (context) => context.json(configured(context.env)))

push.post('/targets', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const kind = body.text('kind', 10)
  const token = body.text('token', LONGEST_TOKEN)
  const p256dh = body.text('p256dh', LONGEST_KEY)
  const auth = body.text('auth', LONGEST_KEY)
  const zone = body.text('zone', LONGEST_ZONE)
  const device = body.text('device', 100)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const known = KINDS.find((one) => one === kind)
  if (!known || !token) return context.json({ error: NOT_A_TARGET }, 400)
  // A subscription is somebody's push service, never anywhere else on the internet,
  // and it cannot be encrypted to without its two keys.
  if (known === 'webpush' && (!token.startsWith('https://') || !p256dh || !auth)) {
    return context.json({ error: NOT_A_TARGET }, 400)
  }
  if (zone !== undefined && !isZone(zone)) return context.json({ error: NOT_A_TARGET }, 400)

  const keys = known === 'webpush' ? JSON.stringify({ p256dh, auth }) : null
  const id = newId()
  await context.env.DB.prepare(
    `insert into push_targets (id, user_id, device_id, kind, token, keys, zone, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (user_id, token) do update
       set kind = excluded.kind, keys = excluded.keys, zone = excluded.zone,
           device_id = excluded.device_id, created_at = excluded.created_at, failed_at = null`,
  )
    .bind(id, user.id, device ?? null, known, token, keys, zone ?? null, now())
    .run()
  // The oldest beyond the ceiling: a browser that subscribed and was never seen again.
  await context.env.DB.prepare(
    `delete from push_targets where user_id = ?1 and id not in
       (select id from push_targets where user_id = ?1 order by created_at desc limit ?2)`,
  )
    .bind(user.id, MOST_TARGETS)
    .run()

  const row = await context.env.DB.prepare(
    'select id from push_targets where user_id = ? and token = ?',
  )
    .bind(user.id, token)
    .first<{ id: string }>()
  return context.json({ id: row?.id ?? id })
})

push.delete('/targets/:id', async (context) => {
  const user = context.get('user')
  await context.env.DB.prepare('delete from push_targets where id = ? and user_id = ?')
    .bind(context.req.param('id'), user.id)
    .run()
  return context.json({ ok: true })
})
