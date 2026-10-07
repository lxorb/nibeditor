/** A message kept outside its chat (docs/chats.md 4.13), each linking back to it:
 *
 *  - **Add as task** opens quick add with the message's first line and a `+Name` for each
 *    person it called, and the message's link as the task's description, so the task in
 *    the inbox says where it came from in one press.
 *  - **Save as note** writes a note beside the chat, named from the message's first
 *    words: the message and its replies as quotes under each writer's name and time,
 *    their files copied beside the note, and the link back at its foot; it opens in a
 *    tab.
 *
 *  The link is the message's own, `nib://chat/<chat>/<message>`, which opens the chat at
 *  it from anywhere in nib. */

import type { Message } from '@nib/chats'
import { isWho } from '@nib/chats/wire'
import { chatLink } from '@nib/chats/links'
import { storeBeside } from '../../assets'
import { t } from '../../i18n.svelte'
import { folderOf } from '../../space-paths'
import { showQuickAdd } from '../../surfaces.svelte'
import { joinPath } from '../../tauri'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import type { ChatPage } from './chat.svelte'
import { noteNameOf, quoted, taskWords } from './keep-words'
import { nameOf } from './people'
import { store } from './source.svelte'
import { fullTime } from './when'

/** The link back to a message, under the chat's name. */
function linkBack(page: ChatPage, message: Message): string {
  return `[#${page.entry?.name ?? ''}](${chatLink(page.id, message.id)})`
}

/** Add as task: quick add, filled in. */
export function addAsTask(page: ChatPage, message: Message, space: string | null): void {
  const called = message.mentions
    .filter(isWho)
    .filter((who) => who !== page.me)
    .map((who) => nameOf(who, page.members, space))
  showQuickAdd({
    text: taskWords(message.body || (message.files.at(0)?.name ?? ''), called),
    description: linkBack(page, message),
  })
}

/** Save as note: written beside the chat, and opened. */
export async function saveAsNote(
  page: ChatPage,
  message: Message,
  space: string | null,
): Promise<void> {
  const entry = page.entry
  if (!entry?.path) return
  const folder = folderOf(entry.path)
  const name = noteNameOf(message.body, entry.name ?? t('Chat'))
  const path = joinPath(folder, workspace.freeName(folder, `${name}.md`))

  const replies = message.replies
    ? await store().history(page.id, { parent: message.id, limit: 200 })
    : []
  const parts: string[] = []
  for (const one of [message, ...replies.filter((reply) => !reply.deleted)]) {
    const files: string[] = []
    for (const file of one.files) {
      const url = await store().fileUrl(page.id, file.hash)
      const bytes = url
        ? await fetch(url)
            .then((answer) => answer.arrayBuffer())
            .catch(() => null)
        : null
      const kept = bytes ? await storeBeside(bytes, path, file.name) : null
      if (kept) files.push(kept)
    }
    parts.push(quoted(nameOf(one.author, page.members, space), fullTime(one.at), one.body, files))
  }

  await writeFile(path, `${parts.join('\n\n')}\n\n${linkBack(page, message)}\n`)
  await workspace.fileCame(path, 'file')
  await workspace.open(path)
}
