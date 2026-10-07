/** Moving one account to sync v2, and back: the switch docs/sync-v2.md section 11 names,
 *  as a request instead of a line of SQL typed against production.
 *
 *  Forward is refused while the account could still be reached by an app that cannot
 *  speak v2 well enough, the way Signal refuses a feature until every linked device has
 *  updated, and names the device that holds it back. Two kinds of thing hold it back:
 *
 *  - a device whose session is still live and whose app is older than `min`, or says a
 *    version nobody can read. `min` is the caller's to give, because which build is
 *    safe is a fact about a release (the one with the rollback and shares fixed), not
 *    about this code;
 *  - a live session with no device behind it: an app from before the hub, which never
 *    says what it runs. The Even plugin is one of these and stays on v1 by design, so
 *    the caller may name such a session in `allow` once they have looked at it.
 *
 *  The asking session is never one of them, so signing in to flip does not block the
 *  flip.
 *
 *  Back is never refused: it is the kill switch, and a kill switch that can say no is
 *  not one. It still names the devices below `min`, because an app without the
 *  rollback fix makes copies on the way back and the person flipping should know.
 *
 *  The write is a compare-and-set on the version read, so two people flipping at once
 *  cannot both act on a stale reading. Reached only by the account
 *  `online_service.admin` names, and a 404 for anybody else, the same door as the
 *  online terminal's switches (machines/admin.ts). */

import { Hono, type MiddlewareHandler } from 'hono'
import { tokenIn } from '../auth'
import { readBody } from '../body'
import { now, sha256 } from '../crypto'
import { NOT_FOUND } from '../machines/door'
import { serviceOf } from '../machines/service'
import type { Env, Variables } from '../types'

interface Admin {
  Bindings: Env
  Variables: Variables
}

/** The first release whose app runs the v2 engine at all. No `min` may be below it. */
const FIRST_V2_APP = '0.12.0'

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

interface Reading {
  user: string
  email: string
  version: 1 | 2
  devices: DeviceView[]
  sessions: SessionView[]
  blockers: Blocker[]
}

/** Everything about one account a flip is judged on, read in three queries. */
async function read(
  env: Env,
  email: string,
  min: string,
  allow: ReadonlySet<string>,
  asker: string | null,
): Promise<Reading | null> {
  const user = await env.DB.prepare('select id, email, sync_version from users where email = ?')
    .bind(email.trim().toLowerCase())
    .first<{ id: string; email: string; sync_version: number }>()
  if (!user) return null

  const at = now()
  const { results: sessions } = await env.DB.prepare(
    `select id, name, last_used_at, token_hash from sessions
      where user_id = ? and expires_at > ? order by last_used_at desc`,
  )
    .bind(user.id, at)
    .all<{ id: string; name: string; last_used_at: number | null; token_hash: string }>()
  const { results: devices } = await env.DB.prepare(
    `select id, name, platform, app, last_seen_at, session_id from devices
      where user_id = ? and revoked_at is null order by last_seen_at desc`,
  )
    .bind(user.id)
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
        allowed: allow.has(one.id),
      }
      if (!view.allowed)
        blockers.push({ kind: 'session', id: one.id, name: one.name, why: 'no device' })
      return view
    })

  return {
    user: user.id,
    email: user.email,
    version: user.sync_version === 2 ? 2 : 1,
    devices: deviceViews,
    sessions: sessionViews,
    blockers,
  }
}

/** `min` as given, or the first v2 release; an error for one below it or unreadable. */
function minimum(given: string | undefined): { min: string } | { error: string } {
  const asked = given?.trim() ?? ''
  const min = asked === '' ? FIRST_V2_APP : asked
  if (!versionOf(min)) return { error: 'min is a version like 0.14.0 or 0.13.1-57' }
  if (!atLeastVersion(min, FIRST_V2_APP)) return { error: `min is at least ${FIRST_V2_APP}` }
  return { min }
}

/** A reading as the answer says it: everything but the account's id. */
function view(reading: Reading, min: string) {
  const { email, version, devices, sessions, blockers } = reading
  return { email, version, min, devices, sessions, blockers }
}

export const syncAdmin = new Hono<Admin>()

const admin: MiddlewareHandler<Admin> = async (context, next) => {
  const service = await serviceOf(context.env)
  if (!service.admin || context.get('user').id !== service.admin) {
    return context.json({ error: NOT_FOUND }, 404)
  }
  await next()
}
syncAdmin.use('*', admin)

async function askerOf(header: string | undefined): Promise<string | null> {
  const token = tokenIn(header)
  return token ? await sha256(token) : null
}

/** Where one account stands: its version, its devices and what would hold a flip back. */
syncAdmin.get('/sync-version', async (context) => {
  const email = context.req.query('email') ?? ''
  const allow = new Set(context.req.queries('allow') ?? [])
  const judged = minimum(context.req.query('min'))
  if ('error' in judged) return context.json({ error: judged.error }, 400)

  const asker = await askerOf(context.req.header('authorization'))
  const reading = await read(context.env, email, judged.min, allow, asker)
  if (!reading) return context.json({ error: 'no such account' }, 404)
  return context.json(view(reading, judged.min))
})

/** The flip itself: `{ email, to, min, allow?, dry? }`. */
syncAdmin.post('/sync-version', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', 320)
  const to = body.count('to')
  const given = body.text('min', 40)
  const allowed = body.texts('allow', 50, 100)
  const dry = body.flag('dry') === true
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!email || (to !== 1 && to !== 2)) return context.json({ error: 'email and to (1 or 2)' }, 400)
  // Forward needs the caller to say which build is safe; nothing here can know.
  if (to === 2 && !given) return context.json({ error: 'min: the oldest app allowed on v2' }, 400)

  const judged = minimum(given)
  if ('error' in judged) return context.json({ error: judged.error }, 400)

  const asker = await askerOf(context.req.header('authorization'))
  const reading = await read(context.env, email, judged.min, new Set(allowed ?? []), asker)
  if (!reading) return context.json({ error: 'no such account' }, 404)

  const shown = view(reading, judged.min)
  if (to === 2 && reading.blockers.length > 0) {
    return context.json({ error: 'a device of this account runs an older app', ...shown }, 409)
  }
  if (dry || reading.version === to) return context.json({ ...shown, to, changed: false })

  const written = await context.env.DB.prepare(
    'update users set sync_version = ? where id = ? and sync_version = ?',
  )
    .bind(to, reading.user, reading.version)
    .run()
  const changed = written.meta.changes > 0
  if (!changed) return context.json({ error: 'the account changed meanwhile; ask again' }, 409)

  // What `wrangler tail` shows, so a flip is on record beside the requests it caused.
  console.warn(`[sync-version] ${reading.email} ${reading.version} -> ${to} (min ${judged.min})`)
  return context.json({ ...shown, version: to, to, changed })
})
