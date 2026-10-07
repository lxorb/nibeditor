/** People: the account's own profile and face, the profiles of the people it shares
 *  something with, whether they are here, and what each is called in a space.
 *
 *  Behind the session guard under `/v2`, and closed to a guest and to a program, both
 *  of which reach only what their lists name (guests.ts, programs.ts): a guest has no
 *  profile to edit, and a guest's face in a note is the initial its device sends. See
 *  docs/chats.md 4.9 and 4.10. */

import { Hono } from 'hono'
import { letGo } from '../blobs'
import { objectBody, readBody } from '../body'
import { cleanPersonName, now } from '../crypto'
import { NOT_A_HASH, NOT_AN_OBJECT } from '../refused'
import { atLeast, spaceOf } from '../spaces/space'
import type { Env, User, Variables } from '../types'
import { avatarIn, isHash } from './avatar'
import {
  AVATAR_BYTES,
  NICK_LIMIT,
  presentOwnProfile,
  presentProfile,
  PROFILE_COLUMNS,
  type ProfileChanges,
  profileChanges,
  type ProfileRow,
} from './profile'
import { MOST_PEOPLE, seenAmong } from './seen'

export const people = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The ids a listing asks about, out of `?ids=a,b,c`. */
function idsIn(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one.length > 0 && one.length <= 64)
    .slice(0, MOST_PEOPLE)
}

/** The account's own profile row. */
export async function ownProfile(env: Env, userId: string): Promise<ProfileRow | null> {
  return env.DB.prepare(`select ${PROFILE_COLUMNS} from users u where u.id = ?`)
    .bind(userId)
    .first<ProfileRow>()
}

/** Everybody among `ids` this account may see, as their cards say them. An id it may
 *  not see is left out rather than refused: to this account it names nobody. */
people.get('/people', async (context) => {
  const user = context.get('user')
  const at = now()
  const rows = await seenAmong(context.env, user, idsIn(context.req.query('ids')))
  return context.json({ people: rows.map((row) => presentProfile(row, row.state, at, user.id)) })
})

/** Whether each of them is here: what an open list of people asks again each minute,
 *  so it is the one column and nothing else. */
people.get('/presence', async (context) => {
  const user = context.get('user')
  const rows = await seenAmong(context.env, user, idsIn(context.req.query('ids')))
  const presence: Record<string, string> = {}
  for (const row of rows) presence[row.id] = presentProfile(row, row.state, 0, user.id).presence
  return context.json({ presence })
})

const COLUMN: Record<Exclude<keyof ProfileChanges, 'status' | 'hidden'>, string> = {
  pronouns: 'pronouns',
  bio: 'bio',
  accent: 'accent',
  zone: 'zone',
}

/** The words about the account, the accent its initial is drawn on, the zone its card
 *  tells the time in, a status, and Appear offline: whichever of them the body names,
 *  each taken away by null. Answers the profile as it now stands. */
people.put('/me/profile', async (context) => {
  const user = context.get('user')
  const fields = await objectBody(context)
  if (!fields) return context.json({ error: NOT_AN_OBJECT }, 400)

  const read = profileChanges(fields)
  if ('problem' in read) return context.json({ error: read.problem }, 400)

  const sets: string[] = []
  const values: unknown[] = []
  const { changes } = read
  for (const [field, column] of Object.entries(COLUMN) as [keyof typeof COLUMN, string][]) {
    if (changes[field] === undefined) continue
    sets.push(`${column} = ?`)
    values.push(changes[field])
  }
  if (changes.status !== undefined) {
    sets.push('status = ?')
    values.push(changes.status === null ? null : JSON.stringify(changes.status))
  }
  if (changes.hidden !== undefined) {
    sets.push('hidden = ?')
    values.push(changes.hidden ? 1 : 0)
  }

  if (sets.length) {
    await context.env.DB.prepare(`update users set ${sets.join(', ')} where id = ?`)
      .bind(...values, user.id)
      .run()
  }

  return context.json({ profile: await own(context.env, user) })
})

/** The face, as the two pictures the device made and uploaded through `/v1/blobs`.
 *  Both have to be this account's, WebP (or JPEG, from an engine that cannot write
 *  WebP), and small; whatever face it had before is
 *  given back, so a person who changes their picture ten times keeps one. */
people.put('/me/avatar', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const small = body.text('s', 64)
  const large = body.text('l', 64)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isHash(small) || !isHash(large)) return context.json({ error: NOT_A_HASH }, 400)

  const { results } = await context.env.DB.prepare(
    `select hash from blobs
      where user_id = ? and hash in (?, ?) and type in ('image/webp', 'image/jpeg') and size <= ?`,
  )
    .bind(user.id, small, large, AVATAR_BYTES)
    .all<{ hash: string }>()
  const held = new Set(results.map((row) => row.hash))
  // Wire text a correct client never meets: the app uploads both before it asks.
  if (!held.has(small) || !held.has(large)) {
    return context.json({ error: 'upload both pictures first' }, 400)
  }

  const before = await ownProfile(context.env, user.id)
  await context.env.DB.prepare('update users set avatar = ? where id = ?')
    .bind(JSON.stringify({ s: small, l: large }), user.id)
    .run()
  await giveBack(context.env, user.id, avatarIn(before?.avatar ?? null), [small, large])

  return context.json({ profile: await own(context.env, user) })
})

/** No face: the initial on the accent again, and both pictures given back. */
people.delete('/me/avatar', async (context) => {
  const user = context.get('user')
  const before = await ownProfile(context.env, user.id)
  await context.env.DB.prepare('update users set avatar = null where id = ?').bind(user.id).run()
  await giveBack(context.env, user.id, avatarIn(before?.avatar ?? null), [])
  return context.json({ profile: await own(context.env, user) })
})

/** What each person in a space is called there, where they chose something. */
people.get('/spaces/:id/nicks', atLeast('read'), async (context) => {
  const space = spaceOf(context)
  const { results } = await context.env.DB.prepare(
    'select user_id, nick from space_nicks where space_id = ? limit ?',
  )
    .bind(space.id, MOST_PEOPLE)
    .all<{ user_id: string; nick: string }>()
  return context.json({ nicks: Object.fromEntries(results.map((row) => [row.user_id, row.nick])) })
})

/** What the account is called in one space; empty is its own name again. Anybody in a
 *  space may name themselves in it, a reader too: it is about them, not the space. */
people.put('/spaces/:id/nick', atLeast('read'), async (context) => {
  const user = context.get('user')
  const space = spaceOf(context)
  const body = await readBody(context)
  const given = body.text('nick', NICK_LIMIT * 8)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const nick = cleanPersonName(given ?? '')
  if (nick.length > NICK_LIMIT) {
    return context.json({ error: `use at most ${NICK_LIMIT} characters` }, 400)
  }

  if (nick) {
    await context.env.DB.prepare(
      `insert into space_nicks (space_id, user_id, nick) values (?, ?, ?)
       on conflict(space_id, user_id) do update set nick = excluded.nick`,
    )
      .bind(space.id, user.id, nick)
      .run()
  } else {
    await context.env.DB.prepare('delete from space_nicks where space_id = ? and user_id = ?')
      .bind(space.id, user.id)
      .run()
  }
  return context.json({ nick: nick || null })
})

/** The pictures of a face no longer worn, unless the new one is the same bytes. */
async function giveBack(
  env: Env,
  userId: string,
  old: { s: string; l: string } | null,
  keeping: readonly string[],
): Promise<void> {
  if (!old) return
  for (const hash of new Set([old.s, old.l])) {
    if (!keeping.includes(hash)) await letGo(env, userId, hash)
  }
}

/** The account's profile as its owner edits it. */
async function own(env: Env, user: User) {
  const row = await ownProfile(env, user.id)
  return row ? presentOwnProfile(row, now()) : null
}
