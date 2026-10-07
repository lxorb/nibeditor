/** A profile changed, and the chats somebody has open where that person is are told,
 *  so a face or a name on screen changes without anybody asking: each `ChatLog` says
 *  `profile {who}` to its sockets and the app asks for the person again (docs/chats.md
 *  4.4). Only chats that are open right now (`chat_sockets`), in the spaces the person
 *  is in, or in one space where only their name there changed. Best effort: a chat that
 *  did not hear learns it the next time the person is asked for. */

import { chunks } from '../bound'
import { askChat } from '../chats/ask'
import type { Env, User } from '../types'

/** How many open chats one change tells, at most, and how many at once. */
const MOST_OPEN = 200
const AT_ONCE = 50

export async function profileTold(env: Env, user: User, space?: string): Promise<void> {
  if (!env.CHATS) return
  const { results } = await env.DB.prepare(
    `select distinct chat_id as chat from chat_sockets
      where space_id in (
        select id from spaces where user_id = ?1 and deleted = 0
        union select space_id from space_members
         where email = ?2 and item = '' and joined_at is not null)
        and (?3 = '' or space_id = ?3)
      limit ?4`,
  )
    .bind(user.id, user.email, space ?? '', MOST_OPEN)
    .all<{ chat: string }>()

  for (const round of chunks(results, AT_ONCE)) {
    await Promise.all(
      round.map((one) => askChat(env, one.chat, 'profile', { 'x-nib-profile': `user:${user.id}` })),
    )
  }
}
