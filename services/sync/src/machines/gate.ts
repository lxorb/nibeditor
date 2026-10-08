/** Whether a machine may wake now (docs/online-terminal.md, 4.8, 4.9 and 4.15): the kill
 *  switches and the breakers, in the order they are pulled - the service, the account,
 *  a hold on the machine, the host being set up at all, the budget, the month's
 *  allowance.
 *
 *  Asked by the door before an owner's socket may wake a machine, by the Start route,
 *  and by `Machine` itself as it wakes, so the three can never disagree.
 *
 *  A Hetzner machine is always on and paid for by the month, so once its server exists
 *  neither the budget nor the allowance keeps it from its owner; the budget is asked
 *  before a server is made, with its price (hetzner-host.ts). Without the secrets that
 *  make one, it is refused as `off` and the admin route says which are missing. */

import type { Env } from '../types'
import { budgetLeft } from './budget'
import { ALLOWANCE } from '@nib/online'
import { hetznerMissing } from './hetzner-host'
import { DevHost } from './host'
import { usedOf } from './meter'
import type { Refusal } from '@nib/online/wire'
import { type Service, serviceOf } from './service'

/** `known` is the service's row where the caller has just read it (the door). */
export async function whyNotWake(
  env: Env,
  userId: string,
  at: number,
  known?: Service,
): Promise<Refusal | null> {
  const service = known ?? (await serviceOf(env))
  if (!service.on) return 'off'

  const row = await env.DB.prepare(
    `select u.online as online, m.held as held, m.host as host, m.server_id as server
       from users u left join machines m on m.user_id = u.id where u.id = ?`,
  )
    .bind(userId)
    .first<{ online: number; held: string | null; host: string | null; server: number | null }>()
  if (row?.online !== 1) return 'list'
  if (row.held) return 'flag'

  if (row.host === 'hetzner') {
    // A drive against a local nibd (DevHost) needs no Hetzner at all.
    if (hetznerMissing(env).length && !DevHost.of(env)) return 'off'
    if (row.server !== null) return null
  }

  if ((await budgetLeft(env, service.ceiling, at)) <= 0) return 'budget'
  if (row.host === 'hetzner') return null

  const used = await usedOf(env, userId, at)
  const spent =
    used.awakeS >= ALLOWANCE.awakeS ||
    used.cpuS >= ALLOWANCE.cpuS ||
    used.egressBytes >= ALLOWANCE.egressBytes
  return spent ? 'allowance' : null
}
