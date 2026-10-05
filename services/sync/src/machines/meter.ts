/** The meter's rows (docs/online-terminal.md, 4.9): what each account's machine used,
 *  per month, in `machine_usage`.
 *
 *  `Machine` adds to the month's row every minute it is awake and once more as it
 *  sleeps, so the allowance and the budget breaker read numbers at most a minute old.
 *  The arithmetic is `@nib/online`'s (`accrue`, `usedOf`, `spend`); this is the SQL. */

import { accrue, monthOf, NONE, SMALL, type Usage, usedOf as asAllowance } from '@nib/online'
import type { Allowance } from '@nib/online'
import type { Env } from '../types'

const USAGE = `awake_s as awakeS, cpu_s as cpuS, mem_gib_s as memGibS, disk_gb_s as diskGbS,
  egress_bytes as egressBytes`

/** One awake stretch added to its month's row. */
export async function meter(
  env: Env,
  userId: string,
  at: number,
  stretch: { awakeS: number; cpuS: number; egressBytes: number },
): Promise<void> {
  const added = accrue(NONE, stretch.awakeS, SMALL, stretch.cpuS, stretch.egressBytes)
  if (added.awakeS <= 0 && added.cpuS <= 0 && added.egressBytes <= 0) return
  await env.DB.prepare(
    `insert into machine_usage (user_id, month, awake_s, cpu_s, mem_gib_s, disk_gb_s, egress_bytes)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     on conflict(user_id, month) do update set
       awake_s = awake_s + ?3, cpu_s = cpu_s + ?4, mem_gib_s = mem_gib_s + ?5,
       disk_gb_s = disk_gb_s + ?6, egress_bytes = egress_bytes + ?7`,
  )
    .bind(
      userId,
      monthOf(at),
      Math.round(added.awakeS),
      added.cpuS,
      added.memGibS,
      added.diskGbS,
      Math.round(added.egressBytes),
    )
    .run()
}

/** What an account has used this month, against the allowance's four lines. */
export async function usedOf(env: Env, userId: string, at: number): Promise<Allowance> {
  const usage = await env.DB.prepare(
    `select ${USAGE} from machine_usage where user_id = ? and month = ?`,
  )
    .bind(userId, monthOf(at))
    .first<Usage>()
  const home = await env.DB.prepare('select home_bytes from machines where user_id = ?')
    .bind(userId)
    .first<{ home_bytes: number }>()
  return asAllowance(usage ?? NONE, home?.home_bytes ?? 0)
}

/** The whole service's month, and the homes it keeps: what the breaker prices. */
export async function serviceMonth(
  env: Env,
  at: number,
): Promise<{ usage: Usage; storedBytes: number }> {
  const usage = await env.DB.prepare(
    `select coalesce(sum(awake_s), 0) as awakeS, coalesce(sum(cpu_s), 0) as cpuS,
            coalesce(sum(mem_gib_s), 0) as memGibS, coalesce(sum(disk_gb_s), 0) as diskGbS,
            coalesce(sum(egress_bytes), 0) as egressBytes
       from machine_usage where month = ?`,
  )
    .bind(monthOf(at))
    .first<Usage>()
  const stored = await env.DB.prepare(
    'select coalesce(sum(home_bytes), 0) as bytes from machines where backup_key is not null',
  ).first<{ bytes: number }>()
  return { usage: usage ?? NONE, storedBytes: stored?.bytes ?? 0 }
}
