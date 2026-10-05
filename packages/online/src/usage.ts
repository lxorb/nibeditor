/** A month of a machine's use, added up and priced (docs/online-terminal.md 4.9).
 *
 *  `Machine` adds every awake stretch to its account's row of `machine_usage`, and the
 *  same sums over every account are the month's estimated spend the budget breaker
 *  holds against Emil's ceiling. Measured, not guessed: the seconds are the alarm's,
 *  the CPU and the egress Cloudflare's own figures (`MachineHost.usage`).
 *
 *  The prices are Cloudflare's list prices read on 2026-10-04 (3.1), and every one of
 *  them is the price before any free allowance: the estimate errs high, so the breaker
 *  trips early rather than late. Months are UTC calendar months. */

import type { Allowance } from './types'

const GB = 1_000_000_000
const HOUR = 3600

/** A machine's size: the free allowance's is the only one (4.8). */
export interface MachineSize {
  vcpu: number
  memGib: number
  diskGb: number
}

/** ½ vCPU, 2 GiB of memory and an 8 GB disk. */
export const SMALL: MachineSize = { vcpu: 0.5, memGib: 2, diskGb: 8 }

/** The free allowance a month (decision 3): 20 awake hours, 10 vCPU-hours, 5 GB of
 *  home and 20 GB of egress. */
export const FREE: Allowance = {
  awakeS: 20 * HOUR,
  cpuS: 10 * HOUR,
  homeBytes: 5 * GB,
  egressBytes: 20 * GB,
}

/** One account's month, as a row of `machine_usage` holds it: awake seconds, CPU
 *  seconds, memory and disk provisioned over the awake time, and bytes sent out. */
export interface Usage {
  awakeS: number
  cpuS: number
  memGibS: number
  diskGbS: number
  egressBytes: number
}

/** A month with nothing used yet. */
export const NONE: Usage = { awakeS: 0, cpuS: 0, memGibS: 0, diskGbS: 0, egressBytes: 0 }

/** Cloudflare's prices, in US dollars: Containers' active vCPU-second, provisioned
 *  GiB-second and GB-second of disk; egress past the included terabyte in Europe; the
 *  `Machine` object's duration, at the 128 MB a Durable Object is billed as; and R2's
 *  GB-month, for the home's backup. */
export const PRICES = {
  vcpuS: 0.072 / HOUR,
  memGibS: 0.009 / HOUR,
  diskGbS: 0.18 / (30 * 24 * HOUR),
  egressGb: 0.025,
  objectGbS: 12.5 / 1_000_000,
  objectGb: 0.128,
  storedGbMonth: 0.015,
} as const

/** A month's usage with one more awake stretch added: `seconds` awake at `size`, and
 *  the CPU seconds and egress Cloudflare counted over it. Negative figures (a clock
 *  stepping back, a host answering nonsense) add nothing. */
export function accrue(
  usage: Usage,
  seconds: number,
  size: MachineSize,
  cpuS: number,
  egressBytes: number,
): Usage {
  const awake = Math.max(0, seconds)
  return {
    awakeS: usage.awakeS + awake,
    cpuS: usage.cpuS + Math.max(0, cpuS),
    memGibS: usage.memGibS + awake * size.memGib,
    diskGbS: usage.diskGbS + awake * size.diskGb,
    egressBytes: usage.egressBytes + Math.max(0, egressBytes),
  }
}

/** Several rows of usage as one: an account's machines, or the whole service's. */
export function sum(usages: readonly Usage[]): Usage {
  return usages.reduce(
    (total, one) => ({
      awakeS: total.awakeS + one.awakeS,
      cpuS: total.cpuS + one.cpuS,
      memGibS: total.memGibS + one.memGibS,
      diskGbS: total.diskGbS + one.diskGbS,
      egressBytes: total.egressBytes + one.egressBytes,
    }),
    NONE,
  )
}

/** What a month of usage costs, in US dollars, with the homes kept in R2 over it. */
export function spend(usage: Usage, storedBytes = 0): number {
  return (
    usage.cpuS * PRICES.vcpuS +
    usage.memGibS * PRICES.memGibS +
    usage.diskGbS * PRICES.diskGbS +
    (usage.egressBytes / GB) * PRICES.egressGb +
    usage.awakeS * PRICES.objectGb * PRICES.objectGbS +
    (storedBytes / GB) * PRICES.storedGbMonth
  )
}

/** What is left of the service's ceiling this month, in US dollars: `awake`'s
 *  `budgetLeft`. */
export function budgetLeft(ceiling: number, usage: Usage, storedBytes = 0): number {
  return ceiling - spend(usage, storedBytes)
}

/** A month's usage as the allowance it is counted against, with the home's size as
 *  `nibd` last measured it. */
export function usedOf(usage: Usage, homeBytes: number): Allowance {
  return {
    awakeS: usage.awakeS,
    cpuS: usage.cpuS,
    homeBytes,
    egressBytes: usage.egressBytes,
  }
}

/** How much of each allowance is used, 0 to 1: the meter's four bars (4.9). */
export function shares(used: Allowance, limit: Allowance): Allowance {
  const share = (one: number, of: number) => (of > 0 ? Math.min(1, Math.max(0, one / of)) : 1)
  return {
    awakeS: share(used.awakeS, limit.awakeS),
    cpuS: share(used.cpuS, limit.cpuS),
    homeBytes: share(used.homeBytes, limit.homeBytes),
    egressBytes: share(used.egressBytes, limit.egressBytes),
  }
}

/** The share of the hours past which the machine's mark turns amber. */
const NEAR = 0.8

/** Whether the month's hours are near their end. */
export function near(used: Allowance, limit: Allowance): boolean {
  return shares(used, limit).awakeS >= NEAR
}

/** The month a moment falls in, as `machine_usage` keys it: `2026-10`. */
export function monthOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** When the month a moment falls in ends and its allowance starts again. */
export function resetAt(at: number): number {
  const date = new Date(at)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}
