/** The online terminal's routes behind the session guard (docs/online-terminal.md, 4.5,
 *  4.9 and 4.10): the account's machine, its terminals' sessions, its month and its
 *  audit.
 *
 *  Accounts only. A guest reaches none of these (`guestMayReach` names none) and only
 *  ever watches, through the socket; a program's `nib_` token reaches none either
 *  (`programMayReach`). Every route answers 404 while the service is off. */

import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { readBody } from '../body'
import { askHub } from '../hub/reach'
import { newId, now } from '../crypto'
import { reachedItem, reachedSpace } from '../spaces/space'
import type { Env, Variables } from '../types'
import { askMachine } from './ask'
import { audit } from './audit'
import { NOT_FOUND } from './door'
import { whyNotWake } from './gate'
import { mayMakeSession, mayStart } from './limits'
import { ALLOWANCE, type HostKind, resetAt } from '@nib/online'
import { usedOf } from './meter'
import { MOST_SESSIONS, type Refusal, type SessionNow } from '@nib/online/wire'
import { allowed, serviceOf } from './service'

interface Online {
  Bindings: Env
  Variables: Variables
}

export const online = new Hono<Online>()

const on: MiddlewareHandler<Online> = async (context, next) => {
  if (!(await serviceOf(context.env)).on) return context.json({ error: NOT_FOUND }, 404)
  await next()
}
online.use('*', on)

interface MachineRow {
  id: string
  user_id: string
  state: string
  created_at: number
  woke_at: number | null
  slept_at: number | null
  home_bytes: number
  backup_at: number | null
  held: string | null
  host: HostKind
  size: string
  region: string
  spec: string | null
  price_month: number | null
  price_currency: string | null
  server_id: number | null
  disk_used: number
  disk_total: number
}

async function machineOf(env: Env, userId: string): Promise<MachineRow | null> {
  return await env.DB.prepare(
    `select id, user_id, state, created_at, woke_at, slept_at, home_bytes, backup_at, held,
            host, size, region, spec, price_month, price_currency, server_id, disk_used, disk_total
       from machines where user_id = ?`,
  )
    .bind(userId)
    .first<MachineRow>()
}

/** The account's machine, made the first time it is needed: on a Hetzner server of its
 *  own (4.15). */
async function ensureMachine(env: Env, userId: string): Promise<MachineRow> {
  const had = await machineOf(env, userId)
  if (had) return had
  const id = `m_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into machines (id, user_id, created_at, host) values (?, ?, ?, 'hetzner')
     on conflict(user_id) do nothing`,
  )
    .bind(id, userId, now())
    .run()
  const made = await machineOf(env, userId)
  if (!made) throw new Error('the machine was not made')
  if (made.id === id) await audit(env, id, 'made', { who: userId })
  return made
}

const asked = (machine: MachineRow) => ({ 'x-nib-user': machine.user_id })

/** The server under a machine, for Settings' one line about it: its type, its size and
 *  what it costs a month, as Hetzner said them when it was made; null for none. */
function serverOf(machine: MachineRow) {
  if (machine.server_id === null || !machine.spec) return null
  let spec: unknown
  try {
    spec = JSON.parse(machine.spec)
  } catch {
    return null
  }
  const { cores, memory, disk } = (spec ?? {}) as Record<string, unknown>
  if (typeof cores !== 'number' || typeof memory !== 'number' || typeof disk !== 'number') {
    return null
  }
  return {
    type: machine.size,
    location: machine.region,
    cores,
    memoryGb: memory,
    diskGb: disk,
    price: machine.price_month,
    currency: machine.price_currency,
  }
}

/** A refusal as the app reads it: one of `@nib/online`'s codes, which the app turns into
 *  words, rather than a sentence of the Worker's. */
const refused = (error: Refusal) => ({ error })

/** The machine, the month and whether the account may have one at all. */
online.get('/machine', async (context) => {
  const user = context.get('user')
  const at = now()
  const machine = await machineOf(context.env, user.id)
  return context.json({
    allowed: await allowed(context.env, user.id),
    machine: machine && {
      id: machine.id,
      state: machine.state,
      held: machine.held !== null,
      createdAt: machine.created_at,
      wokeAt: machine.woke_at,
      sleptAt: machine.slept_at,
      homeBytes: machine.home_bytes,
      backupAt: machine.backup_at,
      host: machine.host,
      server: serverOf(machine),
      disk: machine.disk_total > 0 ? { used: machine.disk_used, total: machine.disk_total } : null,
    },
    used: await usedOf(context.env, user.id, at),
    limit: ALLOWANCE,
    resetAt: resetAt(at),
  })
})

online.post('/machine/start', async (context) => {
  const user = context.get('user')
  const refusal = await whyNotWake(context.env, user.id, now())
  if (refusal) return context.json(refused(refusal), refusal === 'list' ? 403 : 409)
  if (!(await mayStart(context.env, user.id))) return context.json(refused('rate'), 429)

  const machine = await ensureMachine(context.env, user.id)
  await audit(context.env, machine.id, 'start', { who: user.id })
  const answer = await askMachine(context.env, machine.id, 'start', asked(machine))
  return context.json({
    state: answer ? (await answer.json<{ state: string }>()).state : 'asleep',
  })
})

online.post('/machine/stop', async (context) => {
  const user = context.get('user')
  const machine = await machineOf(context.env, user.id)
  if (!machine) return context.json({ error: NOT_FOUND }, 404)
  // A server that is always on is never stopped by its owner: Stop is Restart, which
  // starts `nibd` again and keeps the server and everything on its disk (4.15).
  if (machine.host === 'hetzner') {
    const answer = await askMachine(context.env, machine.id, 'restart', {
      ...asked(machine),
      'x-nib-who': user.id,
    })
    return context.json({
      state: answer ? (await answer.json<{ state: string }>()).state : machine.state,
    })
  }
  await audit(context.env, machine.id, 'stop', { who: user.id, detail: 'stopped' })
  await askMachine(context.env, machine.id, 'stop', {
    ...asked(machine),
    'x-nib-reason': 'stopped',
  })
  return context.json({ state: 'asleep' })
})

/** A `.term` file made a session on the maker's own machine (4.5). The file is made
 *  first, by sync, in a space the maker may write in; this names its session. Asking
 *  again for the same file answers the same session.
 *
 *  `session` is the one the file's words name, if any: a session its owner made on sync
 *  v1, keyed by its own id, is adopted by the file's id the first time the owner asks by
 *  it, rather than a new shell made beside it (`adopt`).
 *
 *  With no `term`, a session of the maker's alone, in no space: what a device still on
 *  sync v1 makes, having no file id the account knows. Its socket is named by the
 *  session (`/v2/online/<session>/socket`), and only its owner reaches it; it is shared
 *  by nobody until its file has an id. */
online.post('/terms', async (context) => {
  const env = context.env
  const user = context.get('user')
  const who = context.get('who')
  const body = await readBody(context)
  const term = body.text('term', 200)
  const named = body.text('session', 200)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await allowed(env, user.id))) return context.json(refused('list'), 403)
  if (!term) return await makeSession(context, env, user.id, null)

  const file = await env.DB.prepare('select id, space_id from notes where id = ? and deleted = 0')
    .bind(term)
    .first<{ id: string; space_id: string }>()
  const reached = file
    ? ((await reachedSpace(env, who, file.space_id)) ?? (await reachedItem(env, who, file)))
    : null
  if (!file || !reached) return context.json({ error: NOT_FOUND }, 404)
  if (reached.role === 'read') return context.json(refused('role'), 403)

  const adopted = named ? await adopt(env, user.id, term, named) : null
  if (adopted) return context.json(adopted)

  const had = await env.DB.prepare(
    'select machine, session, user_id, ended_at from term_sessions where term = ?',
  )
    .bind(term)
    .first<{ machine: string; session: string; user_id: string; ended_at: number | null }>()
  if (had?.user_id === user.id && had.ended_at === null) {
    return context.json({ v: 1, machine: had.machine, session: had.session })
  }
  if (had) return context.json(refused('gone'), 409)

  return await makeSession(context, env, user.id, term)
})

/** The session the file's words name, taken by this file where no other file has it:
 *  its row re-keyed to the file's id, so the shell in it goes on and the account's count
 *  of sessions stays as it was. Two files come here. One a device on sync v1 made, whose
 *  session is still keyed by its own id. And one moved to another space, which is a new
 *  file there with a new id and the same words, the one it was made as gone (issue 222's
 *  orphan: it used to start a fresh shell and leave the program running out of reach).
 *  Only the asker's own live session, never while the file it is keyed by is still there
 *  (a copy, or a Duplicate, gets one of its own), and never over a session the file has
 *  already. Its owner's sockets named by the session still reach it (reach.ts), so a
 *  device not yet on v2, or back on v1, keeps it. */
async function adopt(env: Env, userId: string, term: string, session: string) {
  const row = await env.DB.prepare(
    `update term_sessions set term = ?1
      where session = ?2 and user_id = ?3 and ended_at is null and term != ?1
        and not exists (
          select 1 from notes n where n.id = term_sessions.term and n.deleted = 0
        )
        and not exists (select 1 from term_sessions t where t.term = ?1)
     returning machine, session`,
  )
    .bind(term, session, userId)
    .first<{ machine: string; session: string }>()
  return row && { v: 1, machine: row.machine, session: row.session }
}

/** A new session on the account's machine, for a file or (`term` null) for none, in
 *  which case the session's own id names it. */
async function makeSession(
  context: Context<Online>,
  env: Env,
  userId: string,
  term: string | null,
): Promise<Response> {
  const machine = await ensureMachine(env, userId)
  const { results: live } = await env.DB.prepare(
    'select term from term_sessions where machine = ? and ended_at is null order by created_at',
  )
    .bind(machine.id)
    .all<{ term: string }>()
  if (live.length >= MOST_SESSIONS) {
    return context.json({ ...refused('sessions'), sessions: live.map((one) => one.term) }, 409)
  }
  if (!(await mayMakeSession(env, userId))) return context.json(refused('rate'), 429)

  const session = `s_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into term_sessions (term, machine, session, user_id, created_at)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(term ?? session, machine.id, session, userId, now())
    .run()
  await audit(env, machine.id, 'session', { who: userId })
  await askHub(env, userId, 'terms')
  return context.json({ v: 1, machine: machine.id, session })
}

/** Every session `nibd` has, by its id; null where the machine could not be asked. */
async function machineSessions(env: Env, userId: string): Promise<Map<string, SessionNow> | null> {
  const machine = await machineOf(env, userId)
  if (!machine) return null
  const answer = await askMachine(env, machine.id, 'sessions', { 'x-nib-user': userId })
  const said = answer?.ok ? await answer.json<{ sessions: SessionNow[] | null }>() : null
  return said?.sessions ? new Map(said.sessions.map((one) => [one.session, one])) : null
}

/** The sessions of the account's machine, for Settings' list: every row the account
 *  keeps, with what the machine says of each - the program in front, whether a shell
 *  runs, when it last printed - and every session the machine has that no row names any
 *  more, which can only be ended. `alive` is null where the machine could not be asked. */
online.get('/terms', async (context) => {
  const user = context.get('user')
  const running = machineSessions(context.env, user.id)
  const { results } = await context.env.DB.prepare(
    `select t.term as term, t.session as session, t.typing as typing,
            t.created_at as created_at, n.space_id as space, n.path as path, n.deleted as deleted
       from term_sessions t left join notes n on n.id = t.term
      where t.user_id = ? and t.ended_at is null order by t.created_at`,
  )
    .bind(user.id)
    .all<{
      term: string
      session: string
      typing: string
      created_at: number
      space: string | null
      path: string | null
      deleted: number | null
    }>()
  const there = await running
  const named = new Set(results.map((one) => one.session))
  const nowOf = (session: string) => {
    const said = there?.get(session)
    return {
      program: said?.program ?? null,
      title: said?.title ?? null,
      alive: there ? (said?.alive ?? false) : null,
      at: said?.at ?? null,
    }
  }
  const unnamed = [...(there?.values() ?? [])].filter((one) => !named.has(one.session))
  return context.json({
    terms: [
      ...results.map((one) => ({
        term: one.term,
        session: one.session,
        typing: one.typing,
        createdAt: one.created_at,
        space: one.space,
        path: one.path,
        trashed: one.deleted === 1,
        ...nowOf(one.session),
      })),
      ...unnamed.map((one) => ({
        term: null,
        session: one.session,
        typing: 'owner',
        createdAt: null,
        space: null,
        path: null,
        trashed: false,
        ...nowOf(one.session),
      })),
    ],
  })
})

/** A session of the caller's own, as the owner alone may touch it. */
async function ownSession(env: Env, userId: string, term: string) {
  return await env.DB.prepare(
    `select t.machine as machine, t.session as session, t.user_id as user_id
       from term_sessions t where t.term = ? and t.user_id = ? and t.ended_at is null`,
  )
    .bind(term, userId)
    .first<{ machine: string; session: string; user_id: string }>()
}

/** Who else may type: `owner` (the default) or `writers`. Sockets are told at once. */
online.patch('/terms/:term', async (context) => {
  const user = context.get('user')
  const term = context.req.param('term')
  const body = await readBody(context)
  const typing = body.text('typing', 10)
  if (body.problem || (typing !== 'owner' && typing !== 'writers')) {
    return context.json({ error: 'typing is owner or writers' }, 400)
  }
  const own = await ownSession(context.env, user.id, term)
  if (!own) return context.json({ error: NOT_FOUND }, 404)

  await context.env.DB.prepare('update term_sessions set typing = ? where term = ?')
    .bind(typing, term)
    .run()
  await audit(context.env, own.machine, 'typing', { who: user.id, detail: typing })
  await askMachine(context.env, own.machine, 'typing', {
    'x-nib-user': user.id,
    'x-nib-term': term,
    'x-nib-typing': typing,
  })
  return context.json({ typing })
})

/** A session on the caller's own machine that no row names any more, by its id: one the
 *  machine still has, listed in Settings, which its owner may end. */
const SESSION_ID = /^s_[A-Za-z0-9]{1,64}$/

/** Ending a session: the shell and everything in it (4.5). By its file's id, or by the
 *  session's own where no row names it any more (`GET /terms`'s `term: null`). */
online.delete('/terms/:term', async (context) => {
  const user = context.get('user')
  const term = context.req.param('term')
  const own = await ownSession(context.env, user.id, term)
  if (!own) {
    const machine = SESSION_ID.test(term) ? await machineOf(context.env, user.id) : null
    if (!machine) return context.json({ error: NOT_FOUND }, 404)
    await context.env.DB.prepare(
      'update term_sessions set ended_at = ? where session = ? and user_id = ? and ended_at is null',
    )
      .bind(now(), term, user.id)
      .run()
    await audit(context.env, machine.id, 'ended', { who: user.id })
    await askMachine(context.env, machine.id, 'end', {
      'x-nib-user': user.id,
      'x-nib-session': term,
    })
    await askHub(context.env, user.id, 'terms')
    return context.json({ ok: true })
  }

  await context.env.DB.prepare('update term_sessions set ended_at = ? where term = ?')
    .bind(now(), term)
    .run()
  await audit(context.env, own.machine, 'ended', { who: user.id })
  await askMachine(context.env, own.machine, 'end', {
    'x-nib-user': user.id,
    'x-nib-session': own.session,
  })
  await askHub(context.env, user.id, 'terms')
  return context.json({ ok: true })
})

/** The machine's audit, newest first, for its owner (4.8). */
online.get('/events', async (context) => {
  const user = context.get('user')
  const machine = await machineOf(context.env, user.id)
  if (!machine) return context.json({ events: [] })
  const { results } = await context.env.DB.prepare(
    `select at, kind, who, device, detail from machine_events
      where machine = ? order by at desc, id desc limit 200`,
  )
    .bind(machine.id)
    .all()
  return context.json({ events: results })
})
