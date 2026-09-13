import { isCanvasTarget, isPagesTarget } from '@nib/markdown/links'
import { DIVIDER, type MenuEntry } from './menu-item'
import { chosenIcon } from './chosen-icon'
import { setFileIcon } from './file-icon'
import { iconChoice } from './icon-choice.svelte'
import { t } from './i18n.svelte'
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
