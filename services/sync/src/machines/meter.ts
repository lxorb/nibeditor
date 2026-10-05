/** What a machine used, counted per account per month, and what it may use
 *  (docs/online-terminal.md, 4.9).
 *
 *  `Machine` adds to the month's row every minute it is awake and once more as it
 *  sleeps, so the allowance and the budget breaker read numbers that are at most a
 *  minute old. Memory and disk are counted from awake seconds and the small machine's
 *  size; CPU and egress from what `nibd` reports (or the host, whichever is larger). */

import type { Env } from '../types'
import type { Allowance } from './online'

/** The small machine (decision 3): ½ vCPU, 2 GiB of memory, an 8 GB disk. */
export const SMALL = { vcpu: 0.5, memGib: 2, diskGb: 8 } as const

const GB = 1_000_000_000

/** The free allowance, a month: 20 awake hours, 10 vCPU-hours, 5 GB of home, 20 GB
 *  of egress. */
export const FREE: Allowance = {
  awakeS: 20 * 3600,
  cpuS: 10 * 3600,
  homeBytes: 5 * GB,
  egressBytes: 20 * GB,
}

/** The month a moment is counted in, as `YYYY-MM` in UTC. */
export function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7)
}

/** When the month a moment is in ends: the allowance's reset. */
export function resetOf(at: number): number {
  const day = new Date(at)
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1)
}

/** One stretch of use, added to its month's row. */
export async function meter(
  env: Env,
  userId: string,
  at: number,
  used: { awakeS: number; cpuS: number; egressBytes: number },
): Promise<void> {
  if (used.awakeS <= 0 && used.cpuS <= 0 && used.egressBytes <= 0) return
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
      Math.round(used.awakeS),
      used.cpuS,
      used.awakeS * SMALL.memGib,
      used.awakeS * SMALL.diskGb,
      Math.round(used.egressBytes),
    )
    .run()
}

/** What an account has used this month, against the allowance's four lines. */
export async function usedOf(env: Env, userId: string, at: number): Promise<Allowance> {
  const row = await env.DB.prepare(
    `select u.awake_s as awake_s, u.cpu_s as cpu_s, u.egress_bytes as egress_bytes,
            (select home_bytes from machines where user_id = ?1) as home_bytes
       from (select 1) left join machine_usage u on u.user_id = ?1 and u.month = ?2`,
  )
    .bind(userId, monthOf(at))
    .first<{
      awake_s: number | null
      cpu_s: number | null
      egress_bytes: number | null
      home_bytes: number | null
    }>()

  return {
    awakeS: row?.awake_s ?? 0,
    cpuS: row?.cpu_s ?? 0,
    homeBytes: row?.home_bytes ?? 0,
    egressBytes: row?.egress_bytes ?? 0,
  }
}
