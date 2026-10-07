/** Sync v2 for everybody: the one switch for the whole service, and what it does
 *  (docs/sync-v2.md section 11, "Rollout").
 *
 *  - `off`: nothing moves by itself; only the admin's route moves an account.
 *  - `new`: an account made from now on starts on v2. Nothing to migrate, and every
 *    app that signs in to it reads 2 before its first pass.
 *  - `all`: that, and an account on v1 moves by itself once it is safe: when one of its
 *    devices says hello (hub.ts), the same judgement as the admin's route (gate.ts),
 *    with the switch's `min`, and every live session without a device let through. A
 *    hello is the natural moment: it is when a device says which app it runs now, and
 *    a device reads the version as it starts, so a move between hellos would wait for
 *    the next launch anyway.
 *
 *  An account a person moved back after the mode was last set stays back: that was
 *  somebody deciding about that account, and a rollout that undid it on the next hello
 *  would make the way back useless. Setting the mode again is the decision to move
 *  everybody again.
 *
 *  The way back for all (`everyoneBack`) turns the switch off and moves every v2 account
 *  to 1 in one transaction, so no hello in between can move one forward again. Each app
 *  notices at its next launch, when `/v1/me` says 1, and walks back the way it does for
 *  one account (sync.svelte.ts, `startV2`). Turning the switch off by itself moves
 *  nobody. */

import { now } from '../crypto'
import type { Env } from '../types'
import { accountBy, minimum, move, NEEDS_MIN, standing } from './gate'

export type Mode = 'off' | 'new' | 'all'

const MODES: readonly Mode[] = ['off', 'new', 'all']

export function isMode(value: unknown): value is Mode {
  return MODES.includes(value as Mode)
}

export interface Rollout {
  mode: Mode
  /** The oldest app an automatic move allows; null until somebody sets it. */
  min: string | null
  /** When the mode was last set. */
  since: number
}

/** The switch as its rows say it. Anything unreadable is `off`: a switch that cannot be
 *  read moves nobody. */
async function rolloutOf(env: Env): Promise<Rollout> {
  const { results } = await env.DB.prepare('select key, value from sync_rollout').all<{
    key: string
    value: string
  }>()
  const said = new Map(results.map((one) => [one.key, one.value]))
  const mode = said.get('mode')
  const min = said.get('min') ?? null
  const since = Number(said.get('since'))
  return {
    mode: isMode(mode) ? mode : 'off',
    min: min && 'min' in minimum(min) ? min : null,
    since: Number.isFinite(since) ? since : 0,
  }
}

function setting(env: Env, key: 'mode' | 'min' | 'since', value: string) {
  return env.DB.prepare(
    `insert into sync_rollout (key, value) values (?1, ?2)
     on conflict(key) do update set value = ?2`,
  ).bind(key, value)
}

/** Sets the mode, and `min` where one is given. `all` needs a `min`, given now or
 *  before. */
export async function setRollout(
  env: Env,
  mode: Mode,
  given: string | undefined,
): Promise<{ rollout: Rollout } | { error: string }> {
  let min: string | null = null
  if (given !== undefined) {
    const judged = minimum(given)
    if ('error' in judged) return { error: judged.error }
    min = judged.min
  }
  if (mode === 'all' && min === null && (await rolloutOf(env)).min === null) {
    return { error: NEEDS_MIN }
  }

  await env.DB.batch([
    setting(env, 'mode', mode),
    setting(env, 'since', String(now())),
    ...(min === null ? [] : [setting(env, 'min', min)]),
  ])
  return { rollout: await rolloutOf(env) }
}

/** The version an account made now starts on. */
export async function startingVersion(env: Env): Promise<1 | 2> {
  return (await rolloutOf(env)).mode === 'off' ? 1 : 2
}

/** Whether a person moved this account back since the mode was set. */
async function heldBack(env: Env, user: string, since: number): Promise<boolean> {
  const last = await env.DB.prepare(
    `select to_version from sync_flips where user_id = ? and at >= ?
      order by at desc, rowid desc limit 1`,
  )
    .bind(user, since)
    .first<{ to_version: number }>()
  return last?.to_version === 1
}

/** One account moved to v2 by itself where the switch says `all` and nothing holds it
 *  back. True when it moved. */
export async function rollOn(env: Env, user: string): Promise<boolean> {
  const rollout = await rolloutOf(env)
  if (rollout.mode !== 'all' || rollout.min === null) return false

  const account = await accountBy(env, 'id', user)
  if (!account || account.version === 2) return false
  if (await heldBack(env, user, rollout.since)) return false

  const { blockers } = await standing(env, account, {
    min: rollout.min,
    allow: new Set(),
    asker: null,
    deviceless: 'pass',
  })
  if (blockers.length > 0) return false
  return await move(env, account, 2, 'hello', rollout.min)
}

/** Every v2 account back to 1, and the switch off, in one transaction. Answers how many
 *  moved; with `dry`, how many would, and nothing changes. */
export async function everyoneBack(env: Env, dry: boolean): Promise<number> {
  if (dry) {
    const counted = await env.DB.prepare(
      'select count(*) as n from users where sync_version = 2',
    ).first<{ n: number }>()
    return counted?.n ?? 0
  }

  const at = now()
  const [, , , moved] = await env.DB.batch([
    setting(env, 'mode', 'off'),
    setting(env, 'since', String(at)),
    env.DB.prepare(
      `insert into sync_flips (user_id, at, from_version, to_version, why, min)
       select id, ?, 2, 1, 'everyone', null from users where sync_version = 2`,
    ).bind(at),
    env.DB.prepare('update users set sync_version = 1 where sync_version = 2'),
  ])
  const count = (moved as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0
  console.warn(`[sync-version] everyone 2 -> 1: ${count} accounts, rollout off`)
  return count
}

/** The switch, how many accounts are on each version, and the latest moves. */
export async function rolloutView(env: Env) {
  const rollout = await rolloutOf(env)
  const { results: counts } = await env.DB.prepare(
    'select sync_version as version, count(*) as n from users group by sync_version',
  ).all<{ version: number; n: number }>()
  const on = (two: boolean) =>
    counts.filter((one) => (one.version === 2) === two).reduce((sum, one) => sum + one.n, 0)
  const { results: moves } = await env.DB.prepare(
    `select u.email as email, f.at as at, f.from_version as "from", f.to_version as "to",
            f.why as why, f.min as min
       from sync_flips f join users u on u.id = f.user_id
      order by f.at desc, f.rowid desc limit 50`,
  ).all()
  return {
    ...rollout,
    accounts: { v1: on(false), v2: on(true) },
    moves,
  }
}
