/** The budget breaker (docs/online-terminal.md, 4.8 and 4.9): the whole service's
 *  estimated spend this month, against Emil's ceiling.
 *
 *  Priced by `@nib/online`'s `spend`, at list prices before any free allowance, so the
 *  estimate is above the bill and the breaker trips early rather than late. Past the
 *  ceiling no machine wakes, and an awake one gets ten minutes and a line on its
 *  screens (`Machine`). The dashboard's own budget alert at the same number is the
 *  second breaker (6.3). */

import { budgetLeft as left, spend } from '@nib/online'
import type { Env } from '../types'
import { serviceMonth } from './meter'

export async function spentThisMonth(env: Env, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return spend(usage, storedBytes)
}

/** What is left of the ceiling this month; zero or less trips the breaker. */
export async function budgetLeft(env: Env, ceiling: number, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return left(ceiling, usage, storedBytes)
}
