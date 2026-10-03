/** Which note is each space's inbox, and making it the first time it is needed.
 *
 *  `Inbox.md` at the root of a space unless the space says otherwise (docs/tasks.md
 *  5.1): an ordinary note, so it syncs, opens and links like any other, and Obsidian
 *  sees a note. A quick add that names no note lands there, and the Inbox view lists
 *  the open tasks of every space's inbox.
 *
 *  What the space says is kept by path and follows the note, so a renamed inbox stays
 *  the inbox: the file operation that renamed it says so (workspace/file-ops.ts), the
 *  way a bookmark follows. A space that never renamed its inbox keeps nothing here. */

import { insideItsSpace, insideSpace, movedTo, pathKey, relativeTo, samePath } from '../space-paths'
import { without } from '../records'
import { forget, isRecord, isString, keep, stored } from '../stored'
import { invoke } from '../tauri'
import type { KeptByPath } from '../workspace/file-ops'

export const STORAGE_KEY = 'nib:inbox'

/** The inbox of a space that says nothing else. */
export const INBOX = 'Inbox.md'

/** Every space's own inbox, by root, relative to it. */
function read(): Record<string, string> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}
  const out: Record<string, string> = {}
  for (const [root, path] of Object.entries(saved)) {
    if (isString(path) && insideItsSpace(path)) out[root] = path
  }
  return out
}

function write(all: Record<string, string>) {
  if (Object.keys(all).length) keep(STORAGE_KEY, JSON.stringify(all))
  else forget(STORAGE_KEY)
}

/** The root a record is kept under that names this space, spelled as it was kept. */
function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

/** The inbox of a space, relative to it. */
export function inboxOf(root: string): string {
  const all = read()
  const key = keyOf(all, root)
  return (key === undefined ? undefined : all[key]) ?? INBOX
}

/** Makes another note the space's inbox; the default again where it is `Inbox.md`. */
export function setInbox(root: string, relative: string) {
  const kept = read()
  const key = keyOf(kept, root)
  const all = key === undefined ? kept : without(kept, key)
  write(pathKey(relative, root) === pathKey(INBOX, root) ? all : { ...all, [root]: relative })
}

/** The space's inbox as a path on this disk, made empty where there is none yet. */
export async function ensureInbox(
  root: string,
  made: (path: string) => Promise<void>,
): Promise<string> {
  const path = insideSpace(root, inboxOf(root))
  // Read rather than stamped: the browser's build answers no stamp for any file, and
  // an inbox made over one that is there would be a note emptied.
  const there = await invoke<string>('read_note', { path }).catch(() => null)
  if (there === null) await made(path)
  return path
}

/** The inbox follows its note: renamed, moved, or its space renamed or gone. */
export const inboxes: KeptByPath = {
  moved(from, to, root) {
    if (root === null) return
    const now = inboxOf(root)
    const was = relativeTo(root, from)
    const after = movedTo(now, was, relativeTo(root, to), root)
    if (after !== null) setInbox(root, after)
  },
  spaceMoved(from, to) {
    const all = read()
    const key = keyOf(all, from)
    const kept = key === undefined ? undefined : all[key]
    if (key === undefined || kept === undefined) return
    write({ ...without(all, key), [to]: kept })
  },
  forget(root) {
    const all = read()
    const key = keyOf(all, root)
    if (key === undefined) return
    write(without(all, key))
  },
}
