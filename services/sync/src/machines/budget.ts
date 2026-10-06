/** The budget breaker (docs/online-terminal.md, 4.8, 4.9 and 4.15): the whole service's
 *  estimated spend this month, against Emil's ceiling.
 *
 *  Two kinds of cost. Cloudflare machines are priced by `@nib/online`'s `spend`, at list
 *  prices before any free allowance, so the estimate is above the bill and the breaker
 *  trips early rather than late; past the ceiling none wakes, and an awake one gets ten
 *  minutes and a line on its screens (`Machine`). Hetzner servers cost the same every
 *  month whatever they do, so their prices are summed as they stand, and the breaker
 *  refuses to make a server whose price would take that sum past the ceiling - never
 *  the link to one that is already paid for. The dashboard's own budget alert at the
 *  same number is the second breaker (6.3). */

import { budgetLeft as left, spend } from '@nib/online'
import type { Env } from '../types'
import { serviceMonth } from './meter'

/** US dollars to a euro, deliberately high: the ceiling is in dollars and Hetzner bills
 *  in euros, and an estimate that errs high trips early rather than late. */
const DOLLARS_A_EURO = 1.25

/** A price in a currency, in US dollars. */
function dollars(amount: number, currency: string): number {
  return currency === 'USD' ? amount : amount * DOLLARS_A_EURO
}

/** What the servers that exist cost a month, in US dollars. */
async function fixedMonth(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `select price_month as price, price_currency as currency from machines
      where host = 'hetzner' and server_id is not null and price_month is not null`,
  ).all<{ price: number; currency: string | null }>()
  return results.reduce((total, one) => total + dollars(one.price, one.currency ?? 'EUR'), 0)
}

export async function spentThisMonth(env: Env, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return spend(usage, storedBytes) + (await fixedMonth(env))
}

/** What is left of the ceiling this month; zero or less trips the breaker. */
export async function budgetLeft(env: Env, ceiling: number, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return left(ceiling, usage, storedBytes) - (await fixedMonth(env))
}

/** Whether a new server costing `monthly` in `currency` fits under the ceiling. */
export async function mayCost(
  env: Env,
  ceiling: number,
  at: number,
  monthly: number,
  currency: string,
): Promise<boolean> {
  return (await budgetLeft(env, ceiling, at)) - dollars(monthly, currency) >= 0
}
