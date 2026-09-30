/** Putting rows away and taking them back: what a row's menu, a tab's, the palette,
 *  the strip over an archived note, the archive list and the local endpoint all call.
 *
 *  The archive itself is a map beside the space; see workspace/archive.svelte.ts. What
 *  is here is the gesture around it. Archiving closes the tabs showing what was put
 *  away, because an archived note is one the reader has finished with and an open tab
 *  is the one place it would still be listed - the way Gmail goes back to the inbox.
 *  Either way the gesture is one entry on the file undo, which is what puts the word
 *  and its Undo in the corner; see undo-toast.svelte.ts.
 *
 *  Fetched by the first press rather than imported: the file list only has to know
 *  what is hidden, and that is the store's. */

import { toArchive, toRestore } from './archive-plan'
import { relativeTo, insideSpace, withinSpace } from './space-paths'
import { coveredBy } from './workspace/archive.svelte'
import { changed } from './workspace/archive-map'
import type { FileAction } from './workspace/undo.svelte'
import { workspace } from './workspace.svelte'

type Archiving = Extract<FileAction, { kind: 'archive' | 'unarchive' }>

/** The open space's root, and a path in it as the space speaks it, or null for a path
 *  that is not inside it - the space's own folder included. */
function place(path: string): { root: string; at: string } | null {
  const root = workspace.activeSpace?.root
  if (!root) return null

  const at = withinSpace(root, path)
  return at ? { root, at } : null
}

/** Puts rows away. A row already hidden by an archived folder, and one inside another
 *  row of the same selection, are left to the one that holds them. */
export function archive(paths: readonly string[]): void {
  const root = workspace.activeSpace?.root
  if (!root) return

  const at = paths.flatMap((path) => place(path)?.at ?? [])
  const fresh = toArchive(at, workspace.archive.keysOf(root))
  if (fresh.length) done({ kind: 'archive', root, archived: fresh, restored: [], closed: [] })
}

/** Takes a row back out, exactly where it was. A row inside an archived folder comes
 *  back on its own: the folder comes back around it and the rest of what it held stays
 *  put away; see `toRestore`. */
export function unarchive(path: string): void {
  const found = place(path)
  if (!found) return

  const { root, at } = found
  const plan = toRestore(workspace.archive.keysOf(root), at, (folder) => childrenOf(root, folder))
  if (!plan.restore.length) return

  done({ kind: 'unarchive', root, archived: plan.archive, restored: plan.restore, closed: [] })
}

/** The same gesture again, for a redo: it records itself as it did the first time. */
export function archiveAgain(action: Archiving): void {
  done({ ...action, closed: [] })
}

function done(action: Archiving) {
  const map = changed(
    workspace.archive.of(action.root),
    action.archived,
    action.restored,
    Date.now(),
  )
  if (map) workspace.archive.put(action.root, map)
  const closed = action.kind === 'archive' ? closeHidden(action.root) : []
  workspace.undone.record({ ...action, closed })
}

/** Every tab showing something the space now hides, closed, answering with the paths
 *  they held. Closed rather than asked about: what is written is written, and a
 *  question here would be the app arguing with a gesture it has already carried out.
 *  A website's live page goes with its tab, as it does for any closed tab. */
function closeHidden(root: string): string[] {
  const keys = workspace.archive.keysOf(root)
  const hidden = workspace.tabs.filter((tab) => {
    const at = tab.path === null ? null : withinSpace(root, tab.path)
    return at !== null && coveredBy(keys, at) !== null
  })

  for (const tab of hidden) workspace.close(tab.id)
  return [...new Set(hidden.flatMap((tab) => tab.path ?? []))]
}

/** A folder's rows as the space speaks of them, archived or not: the tree as it is on
 *  disk rather than as the file list draws it. */
function childrenOf(root: string, folder: string): string[] {
  const entry = folder ? workspace.entryAt(insideSpace(root, folder)) : workspace.tree
  return (entry?.children ?? []).map((child) => relativeTo(root, child.path))
}
