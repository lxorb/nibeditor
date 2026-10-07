/** Opening a chat, and making one (docs/chats.md 4.2, 4.13).
 *
 *  A `.chat` file opens as a chat tab, one tab per file as a PDF has, so opening it again
 *  brings the one there is forward; at a message, where a link or a search hit named
 *  one. A new chat is the store's to make (`ChatsSource.make`: the account makes the id,
 *  the pointer is written in the space); here it is placed, named and opened. Ctrl+T's
 *  card on M, the plus in the Chats panel and the file list's New all come here. */

import { chatLinkOf } from '@nib/chats/links'
import { account } from '../../account.svelte'
import { busy } from '../../busy.svelte'
import type { OpenHow } from '../../new-tab'
import { nameOf as fileName, samePath } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import { t } from '../../i18n.svelte'
import { store } from './source.svelte'

/** Messages a chat tab should jump to once it is open, by the pointer's path. */
const jumps = new Map<string, string>()

/** The jump waiting for a chat tab, taken once. */
export function takeJump(path: string): string | undefined {
  const message = jumps.get(path)
  jumps.delete(path)
  return message
}

/** The name a chat is shown by: its pointer's, without `.chat`. */
export function chatName(path: string): string {
  return fileName(path).replace(/\.chat$/i, '')
}

export function openChat(path: string, how: OpenHow = {}, message?: string): void {
  if (message) jumps.set(path, message)
  const open = workspace.tabs.find((one) => one.kind === 'channel' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    if (message) jumpOpen(path)
    return
  }
  workspace.openView('', chatName(path), path, how, 'channel')
}

/** A link to a chat or a message in it, `nib://chat/<chat>/<message>`, followed: from a
 *  note, a message, the AI sidebar's answer or another program. The chats' store is
 *  waited for a few seconds on a launch the link arrived with. */
export async function openChatLink(href: string, how: OpenHow = {}): Promise<void> {
  const link = chatLinkOf(href)
  if (!link) return
  const chats = store()
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const path = chats.entry(link.chat)?.path
  if (path) openChat(path, how, link.message)
  else busy.failed(t('that link could not be followed'))
}

/** The open chat tabs, told when a jump is waiting for one of them. */
const hearers = new Set<(path: string) => void>()

export function hearJumps(hear: (path: string) => void): () => void {
  hearers.add(hear)
  return () => hearers.delete(hear)
}

function jumpOpen(path: string) {
  for (const hear of hearers) hear(path)
}

/** A new chat, which has its place before it has a tab. Emil, 2026-10-08: *"A chat must
 *  always be created so that it directly has a save location, e.g. through the
 *  sidebar."* So there is no chat tab without a file, and no draft of one.
 *
 *  Asked without a name - Ctrl+T's M, the Chats panel's plus, the file list's New - it is
 *  the file list's own gesture for a new file, as Finder and VS Code have it: the list is
 *  shown and a row waits for the name in the folder it was asked in, the space's top
 *  where it was asked nowhere in particular. The name typed comes back here; the account
 *  makes the chat, its pointer is written there, and only then does its tab open, under
 *  that name. Where the list cannot take the row, it is made at once under a stepped
 *  name, as a note is. Signed out it asks for the account. */
export async function makeChat(folder?: string, named?: string): Promise<void> {
  if (!account.accountToken) {
    account.ask('sign-in')
    return
  }
  const dir = folder ?? workspace.activeSpace?.root
  if (!dir) return
  if (named === undefined) {
    workspace.showPanel('tree')
    if (workspace.startNaming('chat', dir)) return
  }

  const name = chatName(named ?? workspace.freeName(dir, `${t('Chat')}.chat`))
  const path = await store().make(dir, name)
  if (!path) {
    busy.failed(t('{name} could not be written.', { name }))
    return
  }
  openChat(path)
  void workspace.loadTree()
}
