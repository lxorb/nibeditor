/** Somebody's access to a space ended or narrowed, and they may be watching one of its
 *  online terminals right now (docs/online-terminal.md, 4.6).
 *
 *  Called from `roomsRevoked`, which every share change already goes through, so a
 *  terminal is closed or downgraded in the same request as a note's room is. Each
 *  machine with a live session in the space is told once, with the files of it that
 *  are in that space; the machine's own owner is never revoked from their own machine.
 *  `Machine`'s minute alarm asks the rows again besides, for anything nothing said. */

import type { Env } from '../types'
import { askMachine } from './ask'

/** How many machines one revocation tells. */
const MOST_MACHINES = 100

export async function machinesRevoked(
  env: Env,
  spaceId: string,
  who: string | null,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  if (!env.MACHINES || !who) return

  const { results } = await env.DB.prepare(
    `select t.machine as machine, t.user_id as owner, group_concat(t.term) as terms
       from term_sessions t join notes n on n.id = t.term
      where n.space_id = ?1 and t.ended_at is null and (?2 = '' or t.term = ?2)
        and t.user_id <> ?3
      group by t.machine, t.user_id limit ?4`,
  )
    .bind(spaceId, item, who, MOST_MACHINES)
    .all<{ machine: string; owner: string; terms: string }>()

  await Promise.all(
    results.map((one) =>
      askMachine(env, one.machine, 'revoke', {
        'x-nib-user': one.owner,
        'x-nib-who': who,
        'x-nib-role': role,
        'x-nib-terms': one.terms,
      }),
    ),
  )
}
