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

import { noteLinksCode } from '@nib/editor'
import { copyText } from './clipboard'
import { pickedLink } from './composer'
import { folderNote, linkedFiles, nestedIn } from './folder-notes'
import { key, plural, t } from './i18n.svelte'
import { links } from './link-index.svelte'
import {
  bookmarkEntry,
  coverEntries,
  DIVIDER,
  excludeEntry,
  iconEntries,
  type MenuEntry,
  shareEntry,
} from './menu.svelte'
import { moveTargets, type MoveTarget, movesInto } from './move-targets'
import { howFor } from './new-tab'
import { rowName } from './note-name'
import { shortcuts } from './shortcuts.svelte'
import { folderOf, isMarkdownPath } from './space-paths'
import { isDesktop, platform } from './tauri'
import { entryAt } from './tree-edits'
import { viewport } from './viewport.svelte'
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
    ...openElsewhere(entry, own),
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
    // A link to the row, spelled the way the Links setting says and the `[[`
    // popup writes it, to paste into any note.
    { label: t('Copy link'), run: () => void copyLinks([entry.path]) },
    // A copy of the bytes, so a PDF duplicates as a PDF and a row that is a folder
    // as the folder with its note renamed to match; see workspace/copying.ts.
    {
      label: t('Duplicate'),
      hint: shortcuts.hint('tree.duplicate'),
      run: () => void workspace.duplicate(entry.path),
    },
    ...revealEntry(entry),
    ...terminalEntry(entry),
    DIVIDER,
    { label: t('Delete'), danger: true, run: () => void removeRow(entry, marked, inside) },
    ...undoEntry(),
  ]
}

/** A row that is part of a selection of several stands for all of them: its menu
 *  acts on the lot, and offers only what makes sense for a lot. */
function selectionMenu(entry: Entry): MenuEntry[] | null {
  if (!workspace.isSelected(entry.path) || workspace.selection.length < 2) return null
  const paths = [...workspace.selection]
  const count = paths.length

  return [
    { label: t('Open all'), run: () => void openAll(paths) },
    DIVIDER,
    { label: t('Move'), run: () => void moveAllTo(paths) },
    ...bookmarkAll(paths),
    { label: t('Copy link'), run: () => void copyLinks(paths) },
    DIVIDER,
    {
      label: plural(count, { one: 'Delete {count} item', other: 'Delete {count} items' }),
      danger: true,
      run: () => void workspace.removeMany(paths),
    },
    ...undoEntry(),
  ]
}

/** A row somewhere other than where Open puts it: a tab of its own left behind the
 *  one in front, as a link's menu offers in a browser and Ctrl+click does on the row
 *  (see new-tab.ts), and a pane beside this one,
 *  as VS Code's Open to the Side does. The pane is not offered where there is none
 *  to make - a phone - nor for a folder with no note, which has no file to show
 *  beside anything yet. */
function openElsewhere(entry: Entry, own: Entry | null): MenuEntry[] {
  const behind = {
    label: t('Open in new tab'),
    run: () => void workspace.openRow(entry.path, howFor('behind')),
  }
  if (viewport.touch || (entry.is_dir && !own)) return [behind]

  return [
    behind,
    { label: t('Open to the side'), run: () => void workspace.openAside(own?.path ?? entry.path) },
  ]
}

/** Every row of the selection in a tab, in the order they were picked, landing on
 *  the first: the rest open behind it, as the tabs a browser opens from links do. */
async function openAll(paths: readonly string[]) {
  const [first, ...rest] = paths
  if (first === undefined) return

  await workspace.openRow(first)
  for (const path of rest) await workspace.openRow(path, howFor('behind'))
}

/** The selection bookmarked with one press, as a row bookmarks itself: the note a
 *  folder is drawn as where it has one. The word says which way the press goes. */
function bookmarkAll(paths: readonly string[]): MenuEntry[] {
  const marks = paths.flatMap((path) => {
    const entry = entryAt(workspace.tree, path)
    const mark = entry && workspace.bookmarks.forEntry(folderNote(entry) ?? entry)
    return mark ? [mark] : []
  })
  if (!marks.length) return []

  const all = marks.every((mark) => workspace.bookmarks.has(mark))
  return [
    {
      label: all ? t('Remove bookmark') : t('Bookmark'),
      run: () => workspace.bookmarks.toggleAll(marks),
    },
  ]
}

/** A link to each row, a line each, written through the app's one writer; see
 *  composer.ts. From nowhere in particular, so a relative link starts at the top of
 *  the space. */
async function copyLinks(rows: readonly string[]) {
  const root = workspace.activeSpace?.root
  if (!root) return

  const paths = linkedFiles(workspace.tree, root, rows)
  const { noteLinks } = await noteLinksCode()
  if (paths.length) await copyText(noteLinks(links.index(null), paths, pickedLink))
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

/** The selection moved together, somewhere every row of it may go: never into one
 *  of themselves, and a place some of them already are is fine as long as the rest
 *  would move. The same sheet and the same call as one row's Move. */
async function moveAllTo(paths: readonly string[]) {
  const asked = (moving: string | null) =>
    moveTargets({
      moving,
      tree: workspace.tree,
      spaces: workspace.spaces,
      here: workspace.activeSpace?.root ?? null,
    })
  const each = paths.map((path) => new Set(asked(path).map((target) => target.id)))
  const targets = asked(null).filter(
    (target) =>
      movesInto(paths, target.id) &&
      paths.every((path, at) => each[at]?.has(target.id) === true || folderOf(path) === target.id),
  )

  const { prompt } = await import('./prompt.svelte')
  const into = await prompt.find({ title: t('Move to'), options: targets })
  if (into) await workspace.moveMany([...paths], into)
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
    title: t('Delete {name}?', { name: rowName(marked.name, marked.is_dir) }),
    detail: t('The notes inside it go too.'),
    confirmLabel: key('Delete'),
    danger: true,
  })

  if (sure) await workspace.remove(entry.path, true)
}

/** The row in the file manager, in Obsidian's words on a Mac; see reveal.ts. */
function revealEntry(entry: Entry): MenuEntry[] {
  if (!isDesktop) return []
  const label = platform() === 'macos' ? t('Reveal in Finder') : t('Show in folder')
  return [{ label, run: () => void import('./reveal').then((one) => one.reveal(entry.path)) }]
}

/** A terminal in the row's folder - or the folder a file is in - which is VS Code's
 *  Open in Integrated Terminal and Explorer's Open in Terminal. A desktop's alone, like
 *  every terminal; see docs/terminal.md. */
function terminalEntry(entry: Entry): MenuEntry[] {
  if (!isDesktop) return []

  const folder = entry.is_dir ? entry.path : folderOf(entry.path)
  return [
    {
      label: t('Open in terminal'),
      run: () =>
        void import('./terminal/open').then(({ openTerminal }) =>
          openTerminal(undefined, { folder }),
        ),
    },
  ]
}

/** Only offered once there is something to take back. */
function undoEntry(): MenuEntry[] {
  const label = workspace.undoLabel
  return label ? [DIVIDER, { label, run: () => void workspace.undoFileAction() }] : []
}
