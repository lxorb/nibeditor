/** The chats, as the app runs them: started for whoever is signed in, after the launch
 *  order (start.ts fetches this at its last turn, never in the first paint, and never in
 *  the glasses' plugin), and fed by what the rest of the app hears.
 *
 *  - The account's hub: a `chat` poke moves a chat on (hub-frames.ts hands it here
 *    unread), and a hub that comes back after a drop means pokes were missed, so the list
 *    is asked again and the outbox sent.
 *  - The file operations: a `.chat` pointer made, moved or deleted on this device moves
 *    the chat's place, and a pointer moved into another space moves the chat there on the
 *    account (docs/chats.md 4.2).
 *  - The network coming back sends the outbox.
 *  - Signing out deletes the device's store of the account's chats.
 *
 *  - The notifications, desktop and browser only: a phone's are the activity's, and
 *    its push is off (docs/chats.md 4.11). See notices.ts.
 *
 *  Importing this is starting it. */

import { untrack } from 'svelte'
import { CHAT_EXTENSION } from '@nib/chats'
import { account } from '../account.svelte'
import { hub } from '../sync2/hub.svelte'
import { isMobile } from '../tauri'
import { type Entry, workspace } from '../workspace.svelte'
import type { FileOp } from '../workspace/file-ops'
import { chats } from './store.svelte'

const isPointer = (path: string) => path.toLowerCase().endsWith(CHAT_EXTENSION)

/** What a file operation means for the chats' pointers. */
function followed(op: FileOp): void {
  if (op.op === 'created') {
    if (op.kind === 'file' && isPointer(op.path)) void chats.pointerMoved(null, op.path)
    return
  }
  if (op.op === 'removed') {
    if (op.kind === 'file' && isPointer(op.path)) void chats.pointerMoved(op.path, null)
    else if (op.kind !== 'file') void chats.lookAgain()
    return
  }
  if (op.kind === 'file') {
    if (isPointer(op.from) || isPointer(op.to)) void chats.pointerMoved(op.from, op.to)
    return
  }
  // A folder or a whole space moved: whatever pointers were in it are found again.
  void chats.lookAgain()
}

/** The pointers in a file list. */
function pointersIn(entry: Entry | null, out: string[] = []): string[] {
  for (const child of entry?.children ?? []) {
    if (child.is_dir) pointersIn(child, out)
    else if (isPointer(child.path)) out.push(child.path)
  }
  return out
}

$effect.root(() => {
  // A pointer the space's sync brought: its chat listed and placed.
  $effect(() => {
    const pointers = pointersIn(workspace.tree)
    untrack(() => chats.pointersSeen(pointers))
  })
  $effect(() => {
    // Whoever is signed in now, user or guest; the store stops the last one first.
    const who = account.user?.id ?? account.guest?.id ?? null
    untrack(() => void chats.start(who))
  })
})

account.forgetWithSession(() => void chats.forget())
hub.on('chat', (frame) => chats.poked(frame.said))
hub.opened(() => void chats.reconnected())
workspace.fileOps.follow(followed)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void chats.reconnected())
}
if (!isMobile) void import('./notices')
