/** Whether a machine may wake now (docs/online-terminal.md, 4.8 and 4.9): the kill
 *  switches and the breakers, in the order they are pulled - the service, the account,
 *  a hold on the machine, the budget, the month's allowance.
 *
 *  Asked by the door before an owner's socket may wake a machine, by the Start route,
 *  and by `Machine` itself as it wakes, so the three can never disagree. */

import type { Env } from '../types'
import { budgetLeft } from './budget'
import { FREE } from '@nib/online'
import { usedOf } from './meter'
import type { Refusal } from '@nib/online/wire'
import { serviceOf } from './service'

export async function whyNotWake(env: Env, userId: string, at: number): Promise<Refusal | null> {
  const service = await serviceOf(env)
  if (!service.on) return 'off'

  const row = await env.DB.prepare(
    `select u.online as online, m.held as held
       from users u left join machines m on m.user_id = u.id where u.id = ?`,
  )
    .bind(userId)
    .first<{ online: number; held: string | null }>()
  if (row?.online !== 1) return 'list'
  if (row.held) return 'flag'

  if ((await budgetLeft(env, service.ceiling, at)) <= 0) return 'budget'

  const used = await usedOf(env, userId, at)
  const spent =
    used.awakeS >= FREE.awakeS || used.cpuS >= FREE.cpuS || used.egressBytes >= FREE.egressBytes
  return spent ? 'allowance' : null
}
