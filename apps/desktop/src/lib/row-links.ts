/** Rows of the file list as the files a link to them names: dragged into a note's
 *  words, or copied from a row's menu. A folder's row is the note it is drawn as,
 *  written or not, because that is what opening it opens; see folder-notes.ts. */

import { carried, dragged, isTreeDrag } from './drag-paths'
import { folderNote, folderNotePath } from './folder-notes'
import { withinSpace } from './space-paths'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** Relative to the space; a row outside it has no link. */
export function linkedPaths(tree: Entry | null, root: string, rows: readonly string[]): string[] {
  return rows.flatMap((row) => {
    const entry = entryAt(tree, row)
    const file = entry?.is_dir ? (folderNote(entry)?.path ?? folderNotePath(row)) : row
    const inside = withinSpace(root, file)
    return inside === null ? [] : [inside]
  })
}

/** What a drag over a note carries, for wikilink/drop.ts in the editor. A `dragover`
 *  cannot read the transfer, so the rows are the ones this window remembers carrying
 *  until the drop, which can. */
export function carriedNotes(transfer: DataTransfer | null): readonly string[] {
  const root = workspace.activeSpace?.root
  if (!root || !isTreeDrag(transfer)) return []

  const rows = dragged(transfer)
  return linkedPaths(workspace.tree, root, rows.length ? rows : carried())
}
