/** The budget breaker (docs/online-terminal.md, 4.8 and 4.9): the month's estimated
 *  spend of the whole service, against Emil's ceiling.
 *
 *  Estimated from the meter's rows at Cloudflare's list prices of 2026-10-04, with no
 *  free allowance taken off - so the estimate is above the bill, never below it, and
 *  the breaker trips early rather than late. Past the ceiling no machine wakes, and an
 *  awake one gets ten minutes and a line on its screens. The dashboard's own budget
 *  alert at the same number is the second breaker (6.3). */

import type { Env } from '../types'
import { monthOf } from './meter'

/** US dollars, per unit as metered. */
const PRICE = {
  /** Memory, per GiB-second ($0.009 a GiB-hour). */
  memGibS: 0.009 / 3600,
  /** Disk while awake, per GB-second ($0.18 a GB-month). */
  diskGbS: 0.18 / (730 * 3600),
  /** Active CPU, per vCPU-second ($0.072 a vCPU-hour). */
  cpuS: 0.072 / 3600,
  /** Egress past the included terabyte, per byte ($0.025 a GB), counted from the first. */
  egressByte: 0.025 / 1_000_000_000,
  /** The `Machine` object while a socket or the link holds it: 128 MB at $12.50 a
   *  million GB-seconds. */
  objectS: (0.128 * 12.5) / 1_000_000,
} as const

/** The service's estimated spend this month, in US dollars. */
export async function spentThisMonth(env: Env, at: number): Promise<number> {
  const row = await env.DB.prepare(
    `select coalesce(sum(awake_s), 0) as awake_s, coalesce(sum(cpu_s), 0) as cpu_s,
            coalesce(sum(mem_gib_s), 0) as mem_gib_s, coalesce(sum(disk_gb_s), 0) as disk_gb_s,
            coalesce(sum(egress_bytes), 0) as egress_bytes
       from machine_usage where month = ?`,
  )
    .bind(monthOf(at))
    .first<{
      awake_s: number
      cpu_s: number
      mem_gib_s: number
      disk_gb_s: number
      egress_bytes: number
    }>()
  if (!row) return 0

  return (
    row.mem_gib_s * PRICE.memGibS +
    row.disk_gb_s * PRICE.diskGbS +
    row.cpu_s * PRICE.cpuS +
    row.egress_bytes * PRICE.egressByte +
    row.awake_s * PRICE.objectS
  )
}

/** What is left of the ceiling this month; zero or less trips the breaker. */
export async function budgetLeft(env: Env, ceiling: number, at: number): Promise<number> {
  return ceiling - (await spentThisMonth(env, at))
}
