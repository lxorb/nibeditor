/** Chats whose pointer or space has gone for good, erased a month later (docs/chats.md
 *  4.2): the nightly job's part for chats.
 *
 *  A chat ends when what shows it goes: its `.chat` pointer purged from Recently
 *  deleted, or its whole space purged. In Recently deleted it is still the chat, and put
 *  back it is the chat as it was. Once ended, the log is kept 30 days more, then its
 *  rows go and its object is emptied with the other leftovers (leftovers.ts), which is
 *  safe to repeat. */

import { AT_A_TIME, places } from '../bound'
import type { Env } from '../types'

/** How long an ended chat's log is kept. */
const KEPT_FOR = 30 * 24 * 60 * 60 * 1000

export async function sweepChats(env: Env, at: number): Promise<number> {
  await env.DB.prepare(
    `update chats set ended_at = ?1
      where ended_at is null
        and ((file_id is not null and not exists (select 1 from notes n where n.id = chats.file_id))
             or exists (select 1 from spaces s where s.id = chats.space_id
                           and s.deleted = 1 and s.deleted_at is null))`,
  )
    .bind(at)
    .run()

  const { results } = await env.DB.prepare(
    'select id from chats where ended_at is not null and ended_at < ? limit ?',
  )
    .bind(at - KEPT_FOR, AT_A_TIME)
    .all<{ id: string }>()
  if (!results.length) return 0

  const ids = results.map((one) => one.id)
  const list = places(ids.length)
  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into leftovers (what, since)
         select 'chats/' || id, ? from chats where id in (${list})`,
    ).bind(at, ...ids),
    env.DB.prepare(`delete from chat_reads where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chat_files where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chat_sockets where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chats where id in (${list})`).bind(...ids),
  ])
  return ids.length
}
