/** A note, or part of one, sent to a chat (docs/chats.md 4.13): Send to chat on a note's
 *  row, on a selection, and in the palette.
 *
 *  A chat is picked by name - the chats of the note's own space first, and a new one in
 *  that space last - and its tab opens with the composer holding a link to the note,
 *  which every member who can open the note sees as a live card; a selection goes as a
 *  quote above a link to the heading it is under. Nothing is sent until the reader
 *  presses Enter, and the composer shows who in the chat could not open the note, with
 *  Share where the reader owns it. Fetched by the first press; never in the glasses'
 *  plugin. */

import { may } from '@nib/chats'
import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { nameOf, within, withoutExtension } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { headingAbove, sentWords } from './sent-words'
import { openChat } from './view/open'
import { store } from './view/source.svelte'

/** What a picker row for a new chat is called by, apart from every chat's id. */
const NEW = '\0new'

/** Sends a note, or a quote of it, to a chat the reader picks. */
export async function sendToChat(
  note: string,
  quote?: { text: string; heading?: string | null },
): Promise<void> {
  if (!account.accountToken) {
    account.ask('sign-in')
    return
  }
  const chats = store()
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const space = workspace.spaces.find((one) => within(one.root, note) !== null) ?? null
  const ours = (root: string | null) => (root === space?.root ? 0 : 1)
  const open = chats.list
    .filter((one) => one.path && one.name && may(one.role, 'post', one.meta.posting))
    .sort((a, b) => ours(a.root) - ours(b.root))

  const chosen = await prompt.find({
    title: t('Send to chat'),
    placeholder: t('Chat'),
    options: [
      ...open.map((one) => ({ id: one.id, label: one.name ?? '', mark: 'chat' as const })),
      ...(space ? [{ id: NEW, label: t('New chat') }] : []),
    ],
  })
  if (!chosen) return

  let chat = chosen
  let path = open.find((one) => one.id === chosen)?.path ?? null
  if (chosen === NEW && space) {
    path = await chats.make(space.root, t('Chat'))
    chat = (path ? await chats.chatAt(path) : null) ?? ''
  }
  if (!path || !chat) return

  openChat(path)
  chats.offer(chat, sentWords(withoutExtension(nameOf(note)), quote), { note })
}

/** A selection of a note sent to a chat: quoted, under the heading it sits in. */
export function sendSelection(note: string, text: string, from: number, to: number): Promise<void> {
  return sendToChat(note, { text: text.slice(from, to), heading: headingAbove(text, from) })
}
