/** The online terminal's routes behind the session guard (docs/online-terminal.md, 4.5,
 *  4.9 and 4.10): the account's machine, its terminals' sessions, its month and its
 *  audit.
 *
 *  Accounts only. A guest reaches none of these (`guestMayReach` names none) and only
 *  ever watches, through the socket; a program's `nib_` token reaches none either
 *  (`programMayReach`). Every route answers 404 while the service is off. */

import { Hono, type MiddlewareHandler } from 'hono'
import { readBody } from '../body'
import { newId, now } from '../crypto'
import { reachedItem, reachedSpace } from '../spaces/space'
import type { Env, Variables } from '../types'
import { askMachine } from './ask'
import { audit } from './audit'
import { NOT_FOUND } from './door'
import { whyNotWake } from './gate'
import { mayMakeSession, mayStart } from './limits'
import { FREE, resetAt } from '@nib/online'
import { usedOf } from './meter'
import { MOST_SESSIONS } from '@nib/online/wire'
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
}

async function machineOf(env: Env, userId: string): Promise<MachineRow | null> {
  return await env.DB.prepare(
    `select id, user_id, state, created_at, woke_at, slept_at, home_bytes, backup_at, held
       from machines where user_id = ?`,
  )
    .bind(userId)
    .first<MachineRow>()
}

/** The account's machine, made the first time it is needed. */
async function ensureMachine(env: Env, userId: string): Promise<MachineRow> {
  const had = await machineOf(env, userId)
  if (had) return had
  const id = `m_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into machines (id, user_id, created_at) values (?, ?, ?)
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
    },
    used: await usedOf(context.env, user.id, at),
    limit: FREE,
    resetAt: resetAt(at),
  })
})

online.post('/machine/start', async (context) => {
  const user = context.get('user')
  const refused = await whyNotWake(context.env, user.id, now())
  if (refused) return context.json({ error: refused }, refused === 'list' ? 403 : 409)
  if (!(await mayStart(context.env, user.id))) return context.json({ error: 'rate' }, 429)

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
  await audit(context.env, machine.id, 'stop', { who: user.id, detail: 'stopped' })
  await askMachine(context.env, machine.id, 'stop', {
    ...asked(machine),
    'x-nib-reason': 'stopped',
  })
  return context.json({ state: 'asleep' })
})

/** A `.term` file made a session on the maker's own machine (4.5). The file is made
 *  first, by sync, in a space the maker may write in; this names its session. Asking
 *  again for the same file answers the same session. */
online.post('/terms', async (context) => {
  const env = context.env
  const user = context.get('user')
  const who = context.get('who')
  const body = await readBody(context)
  const term = body.text('term', 200)
  if (body.problem || !term) return context.json({ error: body.problem ?? 'name the file' }, 400)

  if (!(await allowed(env, user.id))) return context.json({ error: 'list' }, 403)

  const file = await env.DB.prepare('select id, space_id from notes where id = ? and deleted = 0')
    .bind(term)
    .first<{ id: string; space_id: string }>()
  const reached = file
    ? ((await reachedSpace(env, who, file.space_id)) ?? (await reachedItem(env, who, file)))
    : null
  if (!file || !reached) return context.json({ error: NOT_FOUND }, 404)
  if (reached.role === 'read') return context.json({ error: 'role' }, 403)

  const had = await env.DB.prepare(
    'select machine, session, user_id, ended_at from term_sessions where term = ?',
  )
    .bind(term)
    .first<{ machine: string; session: string; user_id: string; ended_at: number | null }>()
  if (had?.user_id === user.id && had.ended_at === null) {
    return context.json({ v: 1, machine: had.machine, session: had.session })
  }
  if (had) return context.json({ error: 'gone' }, 409)

  const machine = await ensureMachine(env, user.id)
  const { results: live } = await env.DB.prepare(
    'select term from term_sessions where machine = ? and ended_at is null order by created_at',
  )
    .bind(machine.id)
    .all<{ term: string }>()
  if (live.length >= MOST_SESSIONS) {
    return context.json({ error: 'sessions', sessions: live.map((one) => one.term) }, 409)
  }
  if (!(await mayMakeSession(env, user.id))) return context.json({ error: 'rate' }, 429)

  const session = `s_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into term_sessions (term, machine, session, user_id, created_at)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(term, machine.id, session, user.id, now())
    .run()
  await audit(env, machine.id, 'session', { who: user.id })
  return context.json({ v: 1, machine: machine.id, session })
})

/** The sessions of the account's machine, for Settings. */
online.get('/terms', async (context) => {
  const user = context.get('user')
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
  return context.json({
    terms: results.map((one) => ({
      term: one.term,
      session: one.session,
      typing: one.typing,
      createdAt: one.created_at,
      space: one.space,
      path: one.path,
      trashed: one.deleted !== 0,
    })),
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

/** Ending a session: the shell and everything in it (4.5). */
online.delete('/terms/:term', async (context) => {
  const user = context.get('user')
  const term = context.req.param('term')
  const own = await ownSession(context.env, user.id, term)
  if (!own) return context.json({ error: NOT_FOUND }, 404)

  await context.env.DB.prepare('update term_sessions set ended_at = ? where term = ?')
    .bind(now(), term)
    .run()
  await audit(context.env, own.machine, 'ended', { who: user.id })
  await askMachine(context.env, own.machine, 'end', {
    'x-nib-user': user.id,
    'x-nib-session': own.session,
  })
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
