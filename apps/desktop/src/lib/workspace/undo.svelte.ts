/** The last handful of file operations, so one can be taken back.
 *
 *  Not persisted: putting a file back only makes sense while it is fresh, and
 *  an entry that survived a restart would be offering to undo something the
 *  reader had long forgotten. Deleting a folder is not among them either - its
 *  contents are already gone, and there is no snapshot of a folder. */

import { t } from '../i18n.svelte'
import type { Edit } from '../search/replace'

export type FileAction =
  | {
      kind: 'move' | 'rename'
      from: string
      to: string
      /** Whether links to the note elsewhere in the space were rewritten with
       *  it, so undoing knows to rewrite them back. The old text is not kept:
       *  the reverse rename is the same rewrite the other way round, and holding
       *  a copy of every touched note would hold a whole space. */
      rewrote?: boolean
    }
  | { kind: 'delete'; path: string; content: string; trashId?: string }
  /** The composer's three, each recorded with the text it replaced: what those
   *  do is edit two notes at once, and an edit is not a file operation the
   *  filesystem can put back. */
  | { kind: 'merge'; from: string; fromContent: string; into: string; intoContent: string }
  | { kind: 'split' | 'extract'; from: string; fromContent: string; created: string }
  /** A replacement run across the space. However many notes it touched, it is
   *  one thing somebody did and so one thing to take back. Each note keeps the
   *  words it had and the edits that put them back, so a note open in a pane
   *  gets its old words the way it got the new ones and keeps its caret. */
  | { kind: 'replace'; notes: { path: string; content: string; edits: Edit[] }[] }
  /** An import. However many files it wrote, what somebody did was import once,
   *  so it is one thing to take back. The paths alone: undoing is removing files
   *  that were not there a minute ago, and a file nobody has touched yet needs no
   *  snapshot kept of it. */
  | { kind: 'import'; paths: string[] }

import { shownName } from '../note-name'
import { nameOf } from '../space-paths'

/** Twenty is far more than anyone reaches back through, and stops a long
 *  session from holding the text of every note it ever deleted. */
const KEPT = 20

export class FileActions {
  /** Newest last. Read by the tree's menu and by the trash, which drops an
   *  entry whose copy it has just restored itself. */
  stack = $state<FileAction[]>([])

  get last(): FileAction | undefined {
    return this.stack.at(-1)
  }

  record(action: FileAction) {
    this.stack = [...this.stack, action].slice(-KEPT)
  }

  /** Drops the newest one, once it has actually been put back. */
  drop() {
    this.stack = this.stack.slice(0, -1)
  }

  /** The trash id of a deletion, once the trash has answered with one. */
  trashed(path: string, id: string) {
    const last = this.last
    if (last?.kind === 'delete' && last.path === path) last.trashId = id
  }

  /** Everything except the deletion whose copy has been restored some other
   *  way - from Recently deleted, say. Undoing it again would write the
   *  snapshot over the note that is now back. */
  forget(trashId: string) {
    this.stack = this.stack.filter(
      (action) => action.kind !== 'delete' || action.trashId !== trashId,
    )
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing.
   *
   *  The name as the row beside it says the name, which is without the ending a
   *  document is known by: the menu this appears in is the row's own menu, and
   *  "Undo renaming Plan.md" under a row that reads `Plan` is the list disagreeing
   *  with itself. See note-name.ts. */
  get label(): string | null {
    const action = this.last
    if (!action) return null

    switch (action.kind) {
      case 'move':
        return t('Undo moving {name}', { name: shownName(nameOf(action.to)) })
      case 'rename':
        return t('Undo renaming {name}', { name: shownName(nameOf(action.to)) })
      case 'delete':
        return t('Undo deleting {name}', { name: shownName(nameOf(action.path)) })
      case 'merge':
        return t('Undo merging {name}', { name: shownName(nameOf(action.from)) })
      case 'split':
        return t('Undo splitting {name}', { name: shownName(nameOf(action.from)) })
      case 'extract':
        return t('Undo extracting from {name}', { name: shownName(nameOf(action.from)) })
      case 'replace':
        return t('Undo the replacement')
      case 'import':
        return t('Undo the import')
    }
  }
}
