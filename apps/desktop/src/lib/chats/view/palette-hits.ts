/** Messages as the palette finds them (docs/chats.md 4.12): Shift Shift searches the
 *  reader's chats beside the notes, a row a message, opening the chat at it.
 *
 *  The words are the chats' search language, read by the store as the Search panel and
 *  the agent read it, so `in:#thesis`, `from:@Lucile` and `has:image` mean the same
 *  everywhere; a query that asks with any of them is about messages, and the palette
 *  then shows messages alone. Plain words show a few messages under the notes. Fetched
 *  by the palette the first time three letters are typed, and never in the glasses'
 *  plugin. */

import { hasModifiers, type Member } from '@nib/chats'
import { t } from '../../i18n.svelte'
import type { Row } from '../../palette/rows'
import { firstLine } from './body'
import { nameOf } from './people'
import { store } from './source.svelte'

/** Messages under the notes for plain words, and a whole list for a chat's modifiers. */
const UNDER_NOTES = 6
const ALONE = 50

/** The longest first line a row shows. */
const LINE = 140

export async function messageHits(words: string): Promise<{ rows: Row[]; only: boolean }> {
  const chats = store()
  if (!chats.ready || !chats.me) return { rows: [], only: false }
  const only = hasModifiers(chats.parse(words))
  const hits = (await chats.search(words)).slice(0, only ? ALONE : UNDER_NOTES)

  const members = new Map<string, Member[]>()
  for (const chat of new Set(hits.map((one) => one.chat))) {
    const listed = await chats.members(chat).catch(() => [])
    members.set(
      chat,
      listed.map((one) => ({ who: one.who, name: one.name ?? t('Deleted account') })),
    )
  }

  const rows = hits.flatMap(({ chat, message }): Row[] => {
    const entry = chats.entry(chat)
    if (!entry?.path || message.deleted) return []
    const who = nameOf(message.author, members.get(chat) ?? [], entry.space)
    const line = firstLine(message.body).trim() || (message.files[0]?.name ?? '')
    return [
      {
        kind: 'message',
        chat,
        id: message.id,
        path: entry.path,
        line: line.length > LINE ? `${line.slice(0, LINE)}…` : line,
        where: `#${entry.name ?? ''} · ${who}`,
      },
    ]
  })
  return { rows, only }
}
