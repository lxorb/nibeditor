/** Putting a note away, and getting it back.
 *
 *  What archiving is, as a promise to the reader: the note stops appearing where it
 *  appeared, it is never deleted, and taking it back puts it exactly where it was. The
 *  last part is why nothing moves. A design that shelved the file in an `Archive/`
 *  folder would have to remember every path it came from to keep that promise, would
 *  break every link into it on the way there, and would reach the sync as a move rather
 *  than as an edit - three problems bought to avoid writing one line into a file.
 *
 *  So the mark goes in the file, and the file stays where it is. Which line, in which
 *  file, is archived.ts's business; this is the writing of it, and what happens around
 *  the writing: the open tab closes, the notice offers to take it back, and a website's
 *  live page is let go of the way a closed tab's is.
 *
 *  Written the way an icon is written, and for the same reasons: through the workspace,
 *  as an edit the size of the words that changed. So a note open in a pane takes the
 *  change in its editor rather than being read back off the disk under its reader's
 *  caret, an open plane takes it in the plane it is drawn from, the version before it
 *  is snapshotted, and one undo puts it back. See file-icon.ts, which is the same
 *  shape of change.
 *
 *  A folder that holds a note of its own name is that note, and archives through it -
 *  the same rule the icons follow, because `A/A.md` and `A/` are one row. A folder with
 *  no such note has no file at all, and is kept in the space's own map; see
 *  workspace/archived-folders.svelte.ts. */

import { canvasArchivedEdit } from '@nib/markdown/canvas'
import { isCanvasTarget, isPagesTarget, isWebTarget } from '@nib/markdown/links'
import { archivedNow, ARCHIVED_KEY } from './archived'
import { frontMatterEdits } from '@nib/markdown/front-matter'
import { folderNote } from './folder-notes'
import { key, message, t } from './i18n.svelte'
import { links } from './link-index.svelte'
import { reverse } from './search/replace'
import { settings } from './settings.svelte'
import { toast } from './toasting.svelte'
import { readShortcut, writeShortcut } from './web-tab/shortcut'
import { workspace } from './workspace.svelte'

/** Where a row's mark is kept: the file that carries it, or the folder the space
 *  carries it for.
 *
 *  A folder with a note of its own name answers with that note, so the one row a reader
 *  sees is one thing to archive. A folder without one answers as a folder, and the
 *  space's map is what says so. The same question `mapKey` in chosen-icon.ts answers
 *  for the same pair of rows. */
function archiveTarget(path: string): { path: string; folder: boolean } {
  const entry = workspace.entryAt(path)
  if (!entry?.is_dir) return { path, folder: false }

  const own = folderNote(entry)
  return own ? { path: own.path, folder: false } : { path, folder: true }
}

/** Whether this row can be archived at all.
 *
 *  Everything can, except a `.webloc`: that is macOS's own shortcut format, this app
 *  reads one and has never written one, and a format with no key of ours in it has
 *  nowhere to put the mark. A row that cannot be archived is not offered the menu row,
 *  rather than being offered one that quietly does nothing. */
export function canArchive(path: string): boolean {
  const target = archiveTarget(path)
  if (target.folder) return true

  return !/\.webloc$/i.test(target.path.trim())
}

/** What the row at this path says when it was archived, as written, or null. The file's
 *  own mark, or the space's map for a folder that has no file. */
export function archivedSaid(path: string): string | null {
  const target = archiveTarget(path)

  return target.folder
    ? workspace.archivedFolders.archivedAt(target.path)
    : links.archivedOf(target.path)
}

/** Writes the mark, or takes it away when `when` is null. The one writer: everything
 *  below and every caller outside goes through here, so there is one place that knows
 *  which kind of file says it where.
 *
 *  A file that cannot be written says so, the way choosing an icon does: this is
 *  somebody's note, and a mark that silently did not arrive would look like the menu
 *  being broken - and worse here than there, because the row would still be on screen
 *  and the reader would archive it again. */
async function setArchived(path: string, when: string | null): Promise<void> {
  const target = archiveTarget(path)

  if (target.folder) {
    workspace.archivedFolders.set(target.path, when)
    return
  }

  const before = await workspace.noteText(target.path)
  if (before === null) return

  const edit = editFor(target.path, before, when)
  if (!edit) return

  const after = before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  const edits = [edit]

  try {
    await workspace.replaceInNotes([
      { path: target.path, before, after, edits, back: reverse(before, edits) },
    ])
  } catch (error) {
    settings.error = message(error, key('That could not be archived.'))
  }
}

/** The one edit each kind of file takes.
 *
 *  A website is the odd one: its format has no edit that changes one key, because the
 *  whole file is three or four lines and the writer writes all of them. So it is read,
 *  said again with the mark set, and the difference between the two is the edit - which
 *  is what `canvasArchivedEdit` does for JSON, for the same reason. */
function editFor(path: string, before: string, when: string | null) {
  if (isCanvasTarget(path) || isPagesTarget(path)) return canvasArchivedEdit(before, when)

  if (isWebTarget(path)) {
    const said = readShortcut(before)
    if (!said) return null
    if ((said.archived ?? null) === when) return null

    const added = said.added === null ? new Date() : new Date(said.added)
    const after = writeShortcut(
      said.url,
      said.title ?? '',
      Number.isNaN(added.getTime()) ? new Date() : added,
      said.home,
      said.icon,
      when,
    )

    return { from: 0, to: before.length, insert: after }
  }

  return frontMatterEdits(before, [[ARCHIVED_KEY, when]])
}

/** Puts a row away: the mark, the tabs it was open in, and the notice.
 *
 *  The tab closes because an archived note is one the reader has finished with, and a
 *  tab left open on it is the one place in the app it would still be listed. Closed
 *  without asking - `close` and not `closeAsking` - because the mark has just been
 *  written through the editor, so there is nothing unsaved to ask about, and a question
 *  here would be the app arguing with a gesture it has already carried out.
 *
 *  A website's live page goes with its tab, which is what `close` already does for one:
 *  archiving it is the reader saying they are done reading it. */
export async function archive(path: string): Promise<void> {
  if (!canArchive(path) || workspace.leftOut.isArchived(path)) return

  await setArchived(path, archivedNow())
  closeTabsUnder(archiveTarget(path).path)

  toast.show(t('Archived'), t('Undo'), () => void unarchive(path))
}

/** And takes it back out, where it was. Nothing is put anywhere: the mark goes, and the
 *  row is in the list it was in, in the place it was in, because it never left. */
export async function unarchive(path: string): Promise<void> {
  if (!workspace.leftOut.isArchived(path)) return

  // The exact row, or the archived folder above it: taking back a note inside an
  // archived folder means taking back the folder, because the note's own mark is not
  // what is hiding it.
  const at = workspace.leftOut.namesArchived(path) ? path : (archivedAbove(path) ?? path)

  await setArchived(at, null)

  toast.show(t('Unarchived'), t('Undo'), () => void archive(at))
}

/** The archived row a path is hiding under, as the app holds a path, or null.
 *
 *  The innermost of them, which is the one actually doing the hiding: a note inside
 *  `2019/March` where both `2019` and `2019/March` were put away comes back when the inner
 *  one does, and the outer one stays away. What `leftOut.archived` holds is only ever the
 *  rows that named themselves, so anything in it this path sits under is a candidate. */
function archivedAbove(path: string): string | null {
  const root = workspace.activeSpace?.root ?? null
  if (root === null) return null

  const above = workspace.leftOut.archived.filter((one) => isUnder(root, one, path))
  return above.length ? insideRoot(root, longest(above)) : null
}

/** Whether a path sits inside an archived row, either separator: a listing off a Windows
 *  disk speaks backslashes and the browser build's speaks slashes. */
function isUnder(root: string, folder: string, path: string): boolean {
  const at = insideRoot(root, folder)
  return path === at || path.startsWith(`${at}/`) || path.startsWith(`${at}\\`)
}

function insideRoot(root: string, relative: string): string {
  return `${root}/${relative}`.replace(/\\/g, '/')
}

/** The innermost of several folders, which is the one that is hiding the row. */
function longest(paths: readonly string[]): string {
  return paths.reduce((deepest, one) => (one.length > deepest.length ? one : deepest))
}

/** Every tab on the archived path, or on something inside it, closed. */
function closeTabsUnder(path: string) {
  const under = workspace.tabs.filter(
    (tab) => tab.path !== null && (tab.path === path || tab.path.startsWith(`${path}/`)),
  )

  for (const tab of under) workspace.close(tab.id)
}
