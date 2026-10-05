/** Who reaches an online terminal, and as what (docs/online-terminal.md, 4.5 and 4.6).
 *
 *  One statement for both questions there are: the door's, for the session a socket
 *  arrives with, and `Machine`'s, for every socket it holds, asked again each minute so
 *  that a file trashed, moved or unshared closes what it should even when nothing told
 *  the object. Access is keyed by the `.term` file's id and its space as the rows say
 *  now, never by the file's text: a copy pasted elsewhere has another id and no
 *  session, and reaches nothing.
 *
 *  The role is the rooms' (rooms/index.ts): the space's owner, the stronger of a
 *  membership of the space and one of this file, or a link's. The machine's owner
 *  reaches their own session whatever the space says - from a trashed file, or a space
 *  they were taken out of - because it is their machine (4.5). A session made with no
 *  file at all, by an account whose devices are still on sync v1 and so have no file id
 *  to name, is in no space, and reaches its owner and nobody else. */

import type { Env } from '../types'
import type { SpaceRole, Typing } from '@nib/online'

/** What one person reaches on one terminal. */
export interface Reached {
  who: string
  term: string
  guest: boolean
  /** Their role in the file's space, or null. */
  role: SpaceRole | null
  /** Whether they own the machine the session is on. */
  owns: boolean
  machine: string
  session: string
  /** The machine's owner. */
  owner: string
  typing: Typing
  /** Whether the machine's owner is on the allow-list, and what holds the machine. */
  listed: boolean
  held: string | null
}

/** The statement, around a `pairs (who, term, guest)` it is handed, and the parameter
 *  that names a machine id to narrow to, or empty. */
const reach = (pairs: string, machine: string) => `with ${pairs}
select p.who as who, p.term as term, p.guest as guest,
       case when sp.user_id = p.who and p.guest = 0 then 'owner'
            when 'write' in (coalesce(ms.role, ''), coalesce(mi.role, ''),
                             coalesce(gs.role, ''), coalesce(gi.role, '')) then 'write'
            when coalesce(ms.role, mi.role, gs.role, gi.role) is not null then 'read'
            else null end as role,
       (t.user_id = p.who and p.guest = 0) as owns,
       coalesce(n.deleted, 1) as deleted,
       t.machine as machine, t.session as session, t.user_id as owner, t.typing as typing,
       (select online from users where id = t.user_id) as listed,
       (select held from machines where id = t.machine) as held
  from pairs p
  join term_sessions t on t.term = p.term and t.ended_at is null
                      and (${machine} = '' or t.machine = ${machine})
  left join notes n on n.id = t.term
  left join spaces sp on sp.id = n.space_id and sp.deleted = 0
  left join users u on u.id = p.who and p.guest = 0
  left join space_members ms on ms.space_id = sp.id and ms.email = u.email and ms.item = ''
  left join space_members mi on mi.space_id = sp.id and mi.email = u.email and mi.item = n.id
  left join guest_members gs on gs.space_id = sp.id and gs.guest_id = p.who and p.guest = 1
                            and gs.item = '' and gs.joined_at is not null
  left join guest_members gi on gi.space_id = sp.id and gi.guest_id = p.who and p.guest = 1
                            and gi.item = n.id and gi.joined_at is not null`

/** The door's: the session behind a token (`?1` its hash, `?2` now) and the file. */
export const DOOR = reach(
  `me as (
  select s.user_id as who, 0 as guest from sessions s where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select g.guest_id as who, 1 as guest from guest_sessions g
   where g.token_hash = ?1 and g.expires_at > ?2
),
pairs as (select who, ?3 as term, guest from me)`,
  '?4',
)

/** Whoever the token is, whatever they reach: told apart from reaching nothing. */
export const WHO = `select s.user_id as who from sessions s where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select g.guest_id as who from guest_sessions g where g.token_hash = ?1 and g.expires_at > ?2`

/** `Machine`'s: every socket's person and file at once, as JSON in `?1`. */
const AGAIN = reach(
  `pairs as (
  select json_extract(value, '$.who') as who, json_extract(value, '$.term') as term,
         json_extract(value, '$.guest') as guest
    from json_each(?1)
)`,
  '?2',
)

export interface Row {
  who: string
  term: string
  guest: number
  role: string | null
  owns: number
  deleted: number
  machine: string
  session: string
  owner: string
  typing: string
  listed: number | null
  held: string | null
}

/** A row as what it means, or null where it reaches nothing: no role, or a trashed
 *  file for anybody but the machine's owner. */
export function reachedOf(row: Row): Reached | null {
  const owns = row.owns === 1
  const role = row.role === 'owner' || row.role === 'write' || row.role === 'read' ? row.role : null
  if (!owns && (role === null || row.deleted !== 0)) return null

  return {
    who: row.who,
    term: row.term,
    guest: row.guest === 1,
    role,
    owns,
    machine: row.machine,
    session: row.session,
    owner: row.owner,
    typing: row.typing === 'writers' ? 'writers' : 'owner',
    listed: row.listed === 1,
    held: row.held,
  }
}

/** Every one of these people on these files, as they reach them now. */
export async function reachAgain(
  env: Env,
  machine: string,
  pairs: readonly { who: string; term: string; guest: boolean }[],
): Promise<Reached[]> {
  if (!pairs.length) return []
  const given = JSON.stringify(pairs.map((one) => ({ ...one, guest: one.guest ? 1 : 0 })))
  const { results } = await env.DB.prepare(AGAIN).bind(given, machine).all<Row>()
  return results.flatMap((row) => reachedOf(row) ?? [])
}
