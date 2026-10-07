/** A `.chat` pointer arriving in its chat's space, by either sync (docs/chats.md 4.2).
 *
 *  Every note is written through one of three places in notes.ts, a v1 device's and a
 *  room's settle alike, and each hands its words here as it hands them to reminders. A
 *  pointer naming a chat of the same space, which no pointer was linked to yet, becomes
 *  that chat's file: what an item share of a private chat is about. A pointer copied
 *  anywhere else, or a second one beside the first, links nothing and reaches nothing.
 *  Best effort: the note is written either way, and the next write of it tries again. */

import { chatOf, CHAT_EXTENSION } from '@nib/chats'
import type { Env, Note } from '../types'

export async function linkPointer(env: Env, note: Note, content: string): Promise<void> {
  if (!note.path.toLowerCase().endsWith(CHAT_EXTENSION)) return
  const pointer = chatOf(content)
  if (!pointer) return
  await env.DB.prepare(
    `update chats set file_id = ?1
      where id = ?2 and space_id = ?3 and file_id is null and ended_at is null
        and not exists (select 1 from chats where file_id = ?1)`,
  )
    .bind(note.id, pointer.chat, note.space_id)
    .run()
}
