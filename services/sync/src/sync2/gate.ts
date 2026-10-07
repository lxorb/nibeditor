/** Whether one account may move to sync v2, and the move itself: the judgement the
 *  admin's route (admin.ts) and the automatic rollout (rollout.ts) both go by, so the
 *  two can never disagree about which account is safe to move.
 *
 *  Forward is held back while the account could still be reached by an app that cannot
 *  speak v2 well enough, the way Signal holds a feature back until every linked device
 *  has updated, and names the device that holds it back. Two kinds of thing do:
 *
 *  - a device whose session is still live and whose app is older than `min`, or says a
 *    version nobody can read. `min` is the caller's to give, because which build is
 *    safe is a fact about a release (the one with the rollback and shares fixed), not
 *    about this code;
 *  - a live session with no device behind it: an app from before the hub, which never
 *    says what it runs. The Even plugin is one of these and stays on v1 by design.
 *    The admin names such a session in `allow` once they have looked at it; the
 *    rollout lets every one of them pass (`deviceless: 'pass'`), because nobody looks
 *    and a session that never says what it runs would otherwise hold its account for
 *    good. v1's routes stay for them (docs/sync-v2.md section 11, "Older apps").
 *
 *  The asking session is never one of them, so signing in to flip does not block the
 *  flip.
 *
 *  The move is a compare-and-set on the version read, so two movers at once cannot both
 *  act on a stale reading, and every move that happened is written to `sync_flips`. */

import { now } from '../crypto'
import type { Env } from '../types'

/** The first release whose app runs the v2 engine at all. No `min` may be below it. */
const FIRST_V2_APP = '0.12.0'

/** What a move forward is refused with when nobody said which app is safe. */
export const NEEDS_MIN = 'min: the oldest app allowed on v2'

/** How a version is written: `0.13.0` for a release, `0.13.1-57` for a build of main
 *  (scripts/build-version.sh). Anything else is a version nobody can vouch for. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/

/** A version as numbers to compare, or null. A build of main sorts below the release
 *  it leads up to, as semver says: `0.13.1-57` < `0.13.1`. */
function versionOf(text: string | null | undefined): number[] | null {
  const parts = VERSION.exec((text ?? '').trim())
  if (!parts) return null
  return [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    parts[4] === undefined ? Infinity : Number(parts[4]),
  ]
}

/** Whether `app` is at least `min`; false for an app whose version is unreadable. */
export function atLeastVersion(app: string | null | undefined, min: string): boolean {
  const have = versionOf(app)
  const need = versionOf(min)
  if (!have || !need) return false
  for (let at = 0; at < need.length; at++) {
    const [one, two] = [have[at] ?? 0, need[at] ?? 0]
    if (one !== two) return one > two
  }
  return true
}

/** `min` as given, or the first v2 release; an error for one below it or unreadable. */
export function minimum(given: string | undefined | null): { min: string } | { error: string } {
  const asked = given?.trim() ?? ''
  const min = asked === '' ? FIRST_V2_APP : asked
  if (!versionOf(min)) return { error: 'min is a version like 0.14.0 or 0.13.1-57' }
  if (!atLeastVersion(min, FIRST_V2_APP)) return { error: `min is at least ${FIRST_V2_APP}` }
  return { min }
}

export interface Account {
  id: string
  email: string
  version: 1 | 2
}

/** The account at an address, or with an id. */
export async function accountBy(
  env: Env,
  by: 'email' | 'id',
  value: string,
): Promise<Account | null> {
  const row = await env.DB.prepare(
    `select id, email, sync_version from users where ${by === 'email' ? 'email' : 'id'} = ?`,
  )
    .bind(by === 'email' ? value.trim().toLowerCase() : value)
    .first<{ id: string; email: string; sync_version: number }>()
  return row ? { id: row.id, email: row.email, version: row.sync_version === 2 ? 2 : 1 } : null
}

interface DeviceView {
  id: string
  name: string
  platform: string
  app: string
  lastSeenAt: number | null
  /** Whether its session is still live, so it could sync tomorrow. */
  live: boolean
}

interface SessionView {
  id: string
  name: string
  lastUsedAt: number | null
  allowed: boolean
}

/** One thing that holds a flip back, said so a person can act on it. */
interface Blocker {
  kind: 'device' | 'session'
  id: string
  name: string
  app?: string
  why: 'older' | 'unreadable' | 'no device'
}

export interface Standing {
  devices: DeviceView[]
  sessions: SessionView[]
  blockers: Blocker[]
}

/** What a standing is judged against. */
export interface Judging {
  min: string
  /** Devices and sessions somebody has looked at and lets stay behind. */
  allow: ReadonlySet<string>
  /** The hashed token of whoever asks, whose own session never holds anything back. */
  asker: string | null
  /** Whether a live session with no device behind it holds the move back. */
  deviceless: 'hold' | 'pass'
}

/** Everything about one account a move is judged on, read in two queries. */
export async function standing(env: Env, account: Account, judging: Judging): Promise<Standing> {
  const { min, allow, asker, deviceless } = judging
  const at = now()
  const { results: sessions } = await env.DB.prepare(
    `select id, name, last_used_at, token_hash from sessions
      where user_id = ? and expires_at > ? order by last_used_at desc`,
  )
    .bind(account.id, at)
    .all<{ id: string; name: string; last_used_at: number | null; token_hash: string }>()
  const { results: devices } = await env.DB.prepare(
    `select id, name, platform, app, last_seen_at, session_id from devices
      where user_id = ? and revoked_at is null order by last_seen_at desc`,
  )
    .bind(account.id)
    .all<{
      id: string
      name: string
      platform: string
      app: string | null
      last_seen_at: number | null
      session_id: string | null
    }>()

  const live = new Set(sessions.map((one) => one.id))
  const behindDevice = new Set(devices.map((one) => one.session_id))
  const blockers: Blocker[] = []

  const deviceViews = devices.map((one) => {
    const view: DeviceView = {
      id: one.id,
      name: one.name,
      platform: one.platform,
      app: one.app ?? '',
      lastSeenAt: one.last_seen_at,
      live: one.session_id !== null && live.has(one.session_id),
    }
    if (view.live && !allow.has(one.id) && !atLeastVersion(one.app, min)) {
      blockers.push({
        kind: 'device',
        id: one.id,
        name: one.name,
        app: view.app,
        why: versionOf(one.app) ? 'older' : 'unreadable',
      })
    }
    return view
  })

  const sessionViews = sessions
    .filter((one) => !behindDevice.has(one.id) && one.token_hash !== asker)
    .map((one) => {
      const view: SessionView = {
        id: one.id,
        name: one.name,
        lastUsedAt: one.last_used_at,
        allowed: deviceless === 'pass' || allow.has(one.id),
      }
      if (!view.allowed)
        blockers.push({ kind: 'session', id: one.id, name: one.name, why: 'no device' })
      return view
    })

  return { devices: deviceViews, sessions: sessionViews, blockers }
}

/** Who moved an account: the admin's route, a device's hello, or the way back for all. */
export type Mover = 'admin' | 'hello' | 'everyone'

/** Moves one account from the version it was read at, and writes the move down.
 *  False when the account changed meanwhile, which moved nothing. */
export async function move(
  env: Env,
  account: Account,
  to: 1 | 2,
  why: Mover,
  min: string | null,
): Promise<boolean> {
  const written = await env.DB.prepare(
    'update users set sync_version = ? where id = ? and sync_version = ?',
  )
    .bind(to, account.id, account.version)
    .run()
  if (written.meta.changes === 0) return false

  await env.DB.prepare(
    `insert into sync_flips (user_id, at, from_version, to_version, why, min)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(account.id, now(), account.version, to, why, to === 2 ? min : null)
    .run()
  // And what `wrangler tail` shows, so a move is on record beside the requests it caused.
  console.warn(`[sync-version] ${account.id} ${account.version} -> ${to} (${why}, min ${min})`)
  return true
}
