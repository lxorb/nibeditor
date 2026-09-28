/** Rows of the file list as links: dragged into a note's words, or copied from a
 *  row's menu. Both write what the `[[` popup writes for the same note, through
 *  the editor's `noteLinks` and the app's one writer, so the Links setting is
 *  answered here as it is everywhere else; see composer.ts.
 *
 *  A row that is a folder stands for the note it is drawn as, written or not,
 *  because that is what opening it opens; see folder-notes.ts. */

import { noteLinks } from '@nib/editor'
import { copyText } from './clipboard'
import { pickedLink } from './composer'
import { carried, dragged, isTreeDrag } from './drag-paths'
import { folderNote, folderNotePath } from './folder-notes'
import { links } from './link-index.svelte'
import { withinSpace } from './space-paths'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** The rows as the space speaks of them, each the file a link to it names. A row
 *  outside the space has no link and is left out. */
export function linkedPaths(tree: Entry | null, root: string, rows: readonly string[]): string[] {
  return rows.flatMap((row) => {
    const entry = entryAt(tree, row)
    const file = entry?.is_dir ? (folderNote(entry)?.path ?? folderNotePath(row)) : row
    const inside = withinSpace(root, file)
    return inside === null ? [] : [inside]
  })
}

/** The notes a drag over a note's words carries, for the editor; see
 *  wikilink/drop.ts. Only the list's own drags: a `dragover` cannot read the
 *  transfer, so the rows are the ones this window remembers carrying, and the
 *  transfer's own list is read at the drop where there is one. */
export function carriedNotes(transfer: DataTransfer | null): readonly string[] {
  const root = workspace.activeSpace?.root
  if (!root || !isTreeDrag(transfer)) return []

  const rows = dragged(transfer)
  return linkedPaths(workspace.tree, root, rows.length ? rows : carried())
}

/** Copies a link to each row, a line each, to be pasted into any note. Written
 *  from nowhere in particular, so a relative link is spelled from the top of the
 *  space. */
export async function copyRowLinks(rows: readonly string[]): Promise<void> {
  const root = workspace.activeSpace?.root
  if (!root) return

  const paths = linkedPaths(workspace.tree, root, rows)
  if (paths.length) await copyText(noteLinks(links.index(null), paths, pickedLink))
}
