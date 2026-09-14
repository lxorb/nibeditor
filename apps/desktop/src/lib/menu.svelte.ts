import { isCanvasTarget, isPagesTarget } from '@nib/markdown/links'
import { DIVIDER, type MenuEntry } from './menu-item'
import { archive, canArchive, unarchive } from './archive'
import { chosenIcon } from './chosen-icon'
import { setFileIcon } from './file-icon'
import { iconChoice } from './icon-choice.svelte'
import { t } from './i18n.svelte'
import { links } from './link-index.svelte'
import { canHaveCover, chooseCover, removeCover } from './note-cover'
import { canShareItem, shareThisFile } from './sharing.svelte'
import { isMarkdownPath } from './space-paths'
import type { Bookmark } from './workspace/bookmarks.svelte'
import { workspace } from './workspace.svelte'

// What a row is, and the rule between groups, are the app's own rather than this
// menu's; see menu-item.ts. Re-exported because every caller of this store reaches
// for them in the same breath as `menu`.
export { DIVIDER, type MenuEntry, type MenuItem } from './menu-item'

/** How a phone shows the menu. A desktop ignores both: there it is always a
 *  popover at the pointer. */
interface MenuOptions {
  /** What the menu is about, for the sheet a phone shows, which does not
   *  point at anything the way a popover does. */
  title?: string
  /** Stay by the finger as a callout instead of rising from the bottom: for
   *  a selection in the text, which has to stay in view. */
  near?: boolean
}

class ContextMenu {
  open = $state(false)
  x = $state(0)
  y = $state(0)
  items = $state<MenuEntry[]>([])
  title = $state<string | null>(null)
  near = $state(false)

  /** Opens at the pointer. The caller has already decided what belongs here,
   *  so an empty list means "no menu" rather than an empty box. */
  show(event: MouseEvent, items: MenuEntry[], options: MenuOptions = {}) {
    event.preventDefault()
    event.stopPropagation()

    const usable = trim(items)
    if (!usable.length) return

    this.items = usable
    this.title = options.title ?? null
    this.near = !!options.near
    this.x = event.clientX
    this.y = event.clientY
    this.open = true
  }

  /** The same menu, with its rows said again. For a row that keeps the menu open and
   *  changes what its own label should read: a browser's zoom rows say the size, and a
   *  size that did not follow the press would be a menu lying about the page. See
   *  `keep` in menu-item.ts. */
  replace(items: MenuEntry[]) {
    if (this.open) this.items = trim(items)
  }

  hide() {
    this.open = false
  }
}

/** Drops leading, trailing and doubled dividers. */
export function trim(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []

  for (const item of items) {
    if (item === DIVIDER && (!out.length || out[out.length - 1] === DIVIDER)) continue
    out.push(item)
  }

  while (out.length && out[out.length - 1] === DIVIDER) out.pop()
  return out
}

export const menu = new ContextMenu()

/** One gesture and one word for everything that can be kept above the file
 *  list: a note, a folder, a heading, a search. Nothing to offer where there is
 *  nothing to point at - a heading with no note, an empty search box. */
export function bookmarkEntry(mark: Bookmark | null): MenuEntry[] {
  if (!mark) return []

  return [
    {
      label: workspace.bookmarks.has(mark) ? t('Remove bookmark') : t('Bookmark'),
      run: () => workspace.bookmarks.toggle(mark),
    },
  ]
}

/** Leaving a note or a folder out of what the space says about itself, in one word
 *  that flips.
 *
 *  Here rather than in the file list for the reason the icon is: it belongs to the
 *  thing, and every list that shows one can offer it. A folder stands for
 *  everything under it, so a note inside an excluded folder is offered nothing -
 *  there is nothing it can take back on its own, and a row that said "take back"
 *  and then did not would be a row that lied. */
export function excludeEntry(path: string | null | undefined): MenuEntry[] {
  if (!path) return []
  if (workspace.excluded.has(path) && !workspace.excluded.names(path)) return []

  return [
    {
      label: workspace.excluded.names(path) ? t('Search here again') : t('Leave out of search'),
      run: () => workspace.excluded.toggle(path),
    },
  ]
}

/** Putting a row away, or taking it back.
 *
 *  One row and not two, because it is one gesture in two directions and a menu with both
 *  in it would be a menu with one row that does nothing. Here rather than in the file
 *  list for the reason the icon is: it belongs to the thing, and every list that shows
 *  one offers it - a row in the tree, a tab, a website's own menu, a row in the archive.
 *
 *  A folder stands for everything under it. A note inside an archived folder is offered
 *  nothing: its own mark is not what is hiding it, so a row that said Unarchive and left
 *  it hidden would be a row that lied. Taking back the folder is what brings it back, and
 *  the folder's own row is where that is offered.
 *
 *  A `.webloc` is offered nothing either: that is macOS's shortcut format, this app has
 *  never written one, and there is no key in it to write the mark into. See `canArchive`
 *  in archive.ts. */
export function archiveEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !canArchive(path)) return []

  const archived = workspace.leftOut.isArchived(path)
  if (archived && !workspace.leftOut.namesArchived(path)) return []

  return [
    {
      label: archived ? t('Unarchive') : t('Archive'),
      run: () => void (archived ? unarchive(path) : archive(path)),
    },
  ]
}

/** The icon a row wears, in the same two words wherever one is chosen: one entry to
 *  choose one, and a second to take away the one it has.
 *
 *  Here rather than in the file list, because the icon belongs to the thing and
 *  every list that shows one can offer it - the tree today, a search result or a
 *  bookmark whenever one of those grows a menu of its own.
 *
 *  A note, a canvas or a folder. Not a PDF and not a picture: those are files with
 *  nowhere to keep an icon - a note has front matter, a canvas has its `nib` key,
 *  and a folder is not a file at all, so its icon is kept by the space. The two
 *  words are the same either way, which is the point of asking here.
 *
 *  `folder` rather than a second function, because the tree knows which its row is
 *  and nothing else about a row differs. */
export function iconEntries(path: string | null | undefined, folder = false): MenuEntry[] {
  if (!path) return []
  if (!folder && !isMarkdownPath(path) && !isCanvasTarget(path) && !isPagesTarget(path)) return []

  const take = () => (folder ? workspace.setFolderIcon(path, null) : void setFileIcon(path, null))

  return [
    {
      label: t('Choose an icon'),
      run: () => (folder ? iconChoice.folder(path) : iconChoice.file(path)),
    },
    ...(chosenIcon(path) === null ? [] : [{ label: t('Remove icon'), run: take }]),
  ]
}

/** The picture across the top of a note: choose one, change the one that is there,
 *  or take it away.
 *
 *  Beside the icon rows, because they are the same kind of thing said about the same
 *  file - what it looks like - and a reader who has come to this menu for one has
 *  come to the right place for the other. A note only: a canvas and a set of pages
 *  are JSON with nowhere to put a cover, a folder is not a file, and the whole of a
 *  plane is a picture already.
 *
 *  Which of Set and Change is offered comes from the index, so the words follow the
 *  file without this asking the disk; see `coverOf` in link-index.svelte.ts. */
export function coverEntries(path: string | null | undefined): MenuEntry[] {
  if (!canHaveCover(path) || !path) return []

  const there = links.coverOf(path) !== null

  return [
    {
      label: there ? t('Change cover') : t('Set cover'),
      run: () => void chooseCover(path),
    },
    ...(there ? [{ label: t('Remove cover'), run: () => void removeCover(path) }] : []),
  ]
}

/** Whether the pane this tab is in lays its notes out as columns side by side.
 *
 *  A pane's own answer and so a row in the pane's own menu, which is the menu over its
 *  tabs. Left out rather than greyed where there is nothing to stack: one note in the
 *  pane, or a handheld, which holds one document and so has nothing to put beside
 *  anything. The rule is the workspace's; see `canStack` there, which the palette reads
 *  too.
 *
 *  A factory here rather than markup in the strip, for the reason every other row in
 *  this file is: the strip splices one line in and knows nothing about stacking. */
export function stackEntries(paneId: string): MenuEntry[] {
  if (!workspace.canStack(paneId)) return []

  return [
    {
      label: workspace.stacked(paneId) ? t('Unstack tabs') : t('Stack tabs'),
      checked: workspace.stacked(paneId),
      run: () => workspace.toggleStacked(paneId),
    },
    DIVIDER,
  ]
}

/** Who else may have this one file. The same word and the same sheet a space is
 *  shared with, about a note or a canvas instead; see ShareSheet.svelte.
 *
 *  Here beside the icon for the same reason that is: the share belongs to the
 *  thing rather than to the list, so every list that shows a file can offer it
 *  without knowing anything about sharing - the tree today and a tab's own menu.
 *  The palette has no list and no menu to build, so it asks for the document in
 *  front of the reader instead; both roads end at `shareThisFile`. Nothing to
 *  offer where there is nothing to share: a file in a space
 *  that is not the account's own, one the account has never been handed, and a
 *  folder, which is not a file. */
export function shareEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !canShareItem(path)) return []

  return [{ label: t('Share'), run: () => void shareThisFile(path) }]
}
