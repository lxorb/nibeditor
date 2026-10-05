/** The online terminal's rate limits (docs/online-terminal.md, 4.8), as rows of the
 *  same `limits` table every other ceiling is counted in.
 *
 *  Keyed under the account, `<user>` or `<user>:<what>`, so deleting the account takes
 *  them with it; see erase.ts. The input rate is not here: a hundred frames a second is
 *  counted in the `Machine` object's memory, where the frames arrive. */

import { within } from '../limits'
import type { Env } from '../types'

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

/** Machine starts an hour, and sessions made a day. */
const STARTS_AN_HOUR = 6
const SESSIONS_A_DAY = 30

export function mayStart(env: Env, userId: string): Promise<boolean> {
  return within(env, 'machine-start', userId, STARTS_AN_HOUR, AN_HOUR)
}

export function mayMakeSession(env: Env, userId: string): Promise<boolean> {
  return within(env, 'machine-session', userId, SESSIONS_A_DAY, A_DAY)
}
