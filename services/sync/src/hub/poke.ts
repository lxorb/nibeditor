/** Pokes instead of polling: a space moved, and every device that can reach it
 *  hears so within a second rather than at its next poll.
 *
 *  Called after any write that moves a space's cursor. Who can reach a space is
 *  one question - its owner, every account a membership names by address, every
 *  guest a link let in - and each of them has a hub, which says `{space, seq}` to
 *  every socket it holds but the device whose write it was. A poke is one hub
 *  request per account reached, and nothing is stored anywhere to make it.
 *
 *  Never awaited by the write it is about, and never able to fail it: the whole of
 *  the work goes to `waitUntil`, and polling is what covers a poke nobody heard.
 *  See docs/sync-v2.md section 5.12. */

import type { Context } from 'hono'
import { note } from '../failed'
import type { Env } from '../types'
import { tellHubs } from './reach'

/** Everybody a space reaches, as the ids their hubs are named by. A membership
 *  about one file of the space reaches its holder too: the file is theirs to see
 *  move, and a poke says nothing but that something did. */
const REACHING = `select user_id as id from spaces where id = ?1
  union select u.id from space_members m join users u on u.email = m.email where m.space_id = ?1
  union select guest_id from guest_members where space_id = ?1 and joined_at is not null`

/** What keeps the Worker running after a response has gone. */
type Later = Pick<ExecutionContext, 'waitUntil'>

export function pokeSpace(
  env: Env,
  later: Later,
  spaceId: string,
  seq: number,
  from?: string,
): Promise<void> {
  if (env.HUB) later.waitUntil(poking(env, spaceId, seq, from ?? ''))
  return Promise.resolve()
}

/** A route's own `waitUntil`, or one that lets the work run on its own where the
 *  request came with no execution context: a test calling the app directly. */
export function laterOf(context: Context): Later {
  try {
    return context.executionCtx
  } catch {
    return { waitUntil: (work) => void work }
  }
}

async function poking(env: Env, spaceId: string, seq: number, from: string): Promise<void> {
  try {
    const { results } = await env.DB.prepare(REACHING).bind(spaceId).all<{ id: string }>()
    await tellHubs(
      env,
      results.map((one) => one.id),
      'poke',
      { 'x-nib-space': spaceId, 'x-nib-seq': String(seq), 'x-nib-from': from },
    )
  } catch (error) {
    note(`poke ${spaceId}`, error, null)
  }
}
