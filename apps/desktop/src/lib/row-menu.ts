/** What a row of the file list offers.
 *
 *  One menu, because the list shows one kind of thing: a note, which may hold
 *  other notes, or a file that is not a note at all. There is no folder menu,
 *  because nothing on screen is a folder - a folder on disk is a note that holds
 *  notes, and one that came out of somebody's vault is a note nobody has written
 *  yet. So "New folder" is not here, and is nowhere else either; see
 *  folder-notes.ts and docs/tree.md.
 *
 *  Its own module rather than a handful of functions inside Tree.svelte, so the
 *  entries a row offers can be read as a list of labels in a test instead of
 *  through a right click on a rendered tree; see row-menu.test.ts. What is left in
 *  the component is the row itself: the press, the drag, the keys.
 *
 *  Everything here asks the workspace as it stands, because a menu is built at the
 *  moment it is opened: what the undo would take back, which rows are selected and
 *  what a row can be moved into are all true only then. */

import { isPdfTarget } from '@nib/markdown/links'
import { folderNote, nestedIn } from './folder-notes'
import { key, plural, t } from './i18n.svelte'
import {
  bookmarkEntry,
  coverEntries,
  DIVIDER,
  excludeEntry,
  iconEntries,
  type MenuEntry,
  shareEntry,
} from './menu.svelte'
import { moveTargets, type MoveTarget } from './move-targets'
import { shownName } from './note-name'
import { isMarkdownPath } from './space-paths'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'

export function rowMenu(entry: Entry): MenuEntry[] {
  const several = selectionMenu(entry)
  if (several) return several

  // The note the row is drawn as, where the folder holds one. A folder that holds
  // none is still a row that opens and holds; what it would open is not written
  // yet, and nothing here writes it.
  const own = folderNote(entry)
  // Whether a new note can go inside this one. A folder can hold notes whether it
  // has a note of its own or not; a PDF, a picture and a canvas are not places.
  const holds = entry.is_dir || isMarkdownPath(entry.name)
  // What the icon and the bookmark are about: the note inside the folder where
  // there is one, and the row itself otherwise - which for a folder with no note
  // is the folder, whose icon the space keeps and whose bookmark points at
  // something that exists.
  const marked = own ?? entry
  const inside = entry.is_dir && nestedIn(entry).length > 0

  return [
    { label: t('Open'), run: () => void workspace.openRow(entry.path) },
    DIVIDER,
    ...(holds
      ? [{ label: t('New note inside'), run: () => void workspace.createInside(entry.path) }]
      : []),
    DIVIDER,
    { label: t('Rename'), run: () => workspace.startRenaming(entry.path) },
    ...moveEntry(entry),
    // Beside the name, because both are what the row shows. A folder with no note
    // has nowhere in itself to keep an icon, so that one goes in the space's map.
    ...iconEntries(marked.path, entry.is_dir && !own),
    // And the picture across the top of it, which is the other thing the note looks
    // like; see `coverEntries`.
    ...coverEntries(marked.path),
    ...bookmarkEntry(workspace.bookmarks.forEntry(marked)),
    // On the row's own path, folder and all: a row that holds notes stands for
    // everything under it, so leaving it out leaves out what is nested in it. See
    // workspace/excluded.svelte.ts.
    ...excludeEntry(entry.path),
    // Who else may have this one file, in the same word the space uses. On the
    // note the row is drawn as, because a share names a file the account has a
    // copy of: a folder is not one, and a folder with no note has nothing to
    // share. See `shareEntry` and sharing.svelte.ts.
    ...shareEntry(marked.path),
    // Duplicating copies a file's words. A PDF has none - the copy would be an
    // empty file wearing the name of a paper - and a row that is a folder has more
    // than words: a copy of `A/A.md` is `A/A 2.md`, which is neither a note nested
    // under A nor a note beside it.
    ...(entry.is_dir || isPdfTarget(entry.name)
      ? []
      : [{ label: t('Duplicate'), run: () => void workspace.duplicate(entry.path) }]),
    DIVIDER,
    { label: t('Delete'), danger: true, run: () => void removeRow(entry, marked, inside) },
    ...undoEntry(),
  ]
}

/** A row that is part of a selection of several stands for all of them: its menu
 *  acts on the lot, and offers only what makes sense for a lot. */
function selectionMenu(entry: Entry): MenuEntry[] | null {
  if (!workspace.isSelected(entry.path) || workspace.selection.length < 2) return null
  const count = workspace.selection.length

  return [
    {
      label: plural(count, { one: 'Delete {count} item', other: 'Delete {count} items' }),
      danger: true,
      run: () => void workspace.removeMany(workspace.selection),
    },
    ...undoEntry(),
  ]
}

/** Moving a row, said rather than dragged.
 *
 *  A held finger opens this menu before a drag could start, and the browser fires
 *  no drag events from a touch anyway, so on a phone or a tablet the menu is the
 *  only way a row moves at all. It is offered under a pointer too: a drag across a
 *  long list, into a note that is folded shut, is a gesture that can be missed,
 *  and the places a row can land read faster as a list than as a target to aim at.
 *  Which places those are is move-targets.ts. */
function moveEntry(entry: Entry): MenuEntry[] {
  const targets = moveTargets({
    moving: entry.path,
    tree: workspace.tree,
    spaces: workspace.spaces,
    here: workspace.activeSpace?.root ?? null,
  })
  if (!targets.length) return []

  return [{ label: t('Move'), run: () => void moveTo(entry, targets) }]
}

async function moveTo(entry: Entry, targets: readonly MoveTarget[]) {
  const { prompt } = await import('./prompt.svelte')
  const into = await prompt.find({ title: t('Move to'), options: [...targets] })

  // The same call the drop makes, so it is the same move and the same undo.
  if (into) await workspace.moveMany([entry.path], into)
}

/** Deleting a row that holds rows takes all of them with it, so it asks first: the
 *  row is drawn as the one note it is, and a note does not look like something
 *  that holds anything. A row with nothing under it goes the way deleting one note
 *  has always gone, which is without a question. */
async function removeRow(entry: Entry, marked: Entry, inside: boolean) {
  if (!inside) {
    await workspace.remove(entry.path, entry.is_dir)
    return
  }

  const { prompt } = await import('./prompt.svelte')
  const sure = await prompt.confirm({
    title: t('Delete {name}?', { name: shownName(marked.name) }),
    detail: t('The notes inside it go too.'),
    confirmLabel: key('Delete'),
    danger: true,
  })

  if (sure) await workspace.remove(entry.path, true)
}

/** Only offered once there is something to take back. */
function undoEntry(): MenuEntry[] {
  const label = workspace.undoLabel
  return label ? [DIVIDER, { label, run: () => void workspace.undoFileAction() }] : []
}
