/** A chat's `.chat` pointer in its space: made, read and found (docs/chats.md 4.2).
 *
 *  A chat is made on the account (`POST /v2/chats {space}`), and its pointer written at
 *  once, in the space the account made it in, so the account links the pointer's file the
 *  first time either sync carries it up. The pointer is the chat's name and place and
 *  nothing else: everything a chat holds is the account's, and a pointer read anywhere
 *  names the same chat. Finding the pointers is reading every space's files for `.chat`,
 *  which the chats' start does once after the launch and again when a chat turns up whose
 *  pointer is not known yet. */

import { CHAT_EXTENSION, chatOf, chatText } from '@nib/chats'
import { nameOf, within } from '../space-paths'
import { sync } from '../sync.svelte'
import { invoke, joinPath } from '../tauri'
import { type Entry, workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { makeChat } from './http'

/** Where a chat's pointer is on this device. */
export interface Place {
  root: string
  path: string
}

/** A chat's name: its pointer's file name without `.chat`. */
export function chatName(path: string): string {
  const name = nameOf(path)
  return name.toLowerCase().endsWith(CHAT_EXTENSION) ? name.slice(0, -CHAT_EXTENSION.length) : name
}

/** The space a folder is in. */
function spaceOf(folder: string) {
  return workspace.spaces.find((one) => within(one.root, folder) !== null) ?? null
}

/** A new chat in a folder of a space: made on the account, its pointer written there.
 *  Null where the space is not on the account, or the account would not. */
export async function makePointer(folder: string, name: string): Promise<Place | null> {
  const space = spaceOf(folder)
  const remote = space ? sync.remoteIdFor(space.root) : null
  if (!space || !remote) return null
  const pointer = await makeChat(remote)
  if (!pointer) return null

  const path = joinPath(folder, workspace.freeName(folder, `${name}${CHAT_EXTENSION}`))
  await writeFile(path, chatText(pointer))
  await workspace.fileCame(path, 'file')
  return { root: space.root, path }
}

/** The chat a file names, or null for a file that is not a pointer. */
export async function readPointer(path: string): Promise<string | null> {
  if (!path.toLowerCase().endsWith(CHAT_EXTENSION)) return null
  const text = await invoke<string>('read_note', { path }).catch(() => null)
  return text === null ? null : (chatOf(text)?.chat ?? null)
}

function pointerPaths(entry: Entry, out: string[]): string[] {
  for (const child of entry.children) {
    if (child.is_dir) pointerPaths(child, out)
    else if (child.name.toLowerCase().endsWith(CHAT_EXTENSION)) out.push(child.path)
  }
  return out
}

/** Every pointer in every space on this device, by the chat it names. A chat named by
 *  two pointers (a copy pasted beside it) keeps the first. */
export async function findPointers(): Promise<Map<string, Place>> {
  const found = new Map<string, Place>()
  for (const space of workspace.spaces) {
    const tree = await invoke<Entry>('read_tree', {
      root: space.root,
      options: { showHidden: false },
    }).catch(() => null)
    if (!tree) continue
    for (const path of pointerPaths(tree, [])) {
      const chat = await readPointer(path)
      if (chat && !found.has(chat)) found.set(chat, { root: space.root, path })
    }
  }
  return found
}

/** The account's id of the space a folder is in, for a chat moved into it. */
export function remoteSpaceOf(folder: string): string | null {
  const space = spaceOf(folder)
  return space ? sync.remoteIdFor(space.root) : null
}
