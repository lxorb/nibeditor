/** The online terminal's switches: whether the service runs at all, who may have a
 *  machine, and who may pull the switches (docs/online-terminal.md, 4.8).
 *
 *  Each is one row, so each kill switch is one request: `online` off in
 *  `online_service` stops every machine at its next minute and turns every route into a
 *  404; `users.online` cleared stops one account's machine and refuses its starts. The
 *  service is also off wherever the `Machine` binding is not, such as a local test
 *  config without it. */

import type { Env } from '../types'

/** What the service's row says, read in one query. */
export interface Service {
  on: boolean
  /** The month's ceiling for the whole service, in US dollars. */
  ceiling: number
  /** The account that may use the admin routes, or null. */
  admin: string | null
}

/** The ceiling when the row says nothing usable: Emil's $30 (decision 3). */
const DEFAULT_CEILING = 30

export async function serviceOf(env: Env): Promise<Service> {
  const { results } = await env.DB.prepare('select key, value from online_service').all<{
    key: string
    value: string
  }>()
  const said = new Map(results.map((one) => [one.key, one.value]))
  const ceiling = Number(said.get('ceiling'))

  return {
    on: said.get('online') === 'on' && env.MACHINES !== undefined,
    ceiling: Number.isFinite(ceiling) && ceiling >= 0 ? ceiling : DEFAULT_CEILING,
    admin: said.get('admin')?.trim() ? (said.get('admin') ?? null) : null,
  }
}

export async function setService(env: Env, key: 'online' | 'ceiling', value: string) {
  await env.DB.prepare(
    `insert into online_service (key, value) values (?1, ?2)
     on conflict(key) do update set value = ?2`,
  )
    .bind(key, value)
    .run()
}

/** Whether this account is on the allow-list. */
export async function allowed(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('select online from users where id = ?')
    .bind(userId)
    .first<{ online: number }>()
  return row?.online === 1
}
