/** What a tab's own menu does to a tab beyond closing it: a second tab on the same
 *  thing, the tab carried to another pane, and its file renamed. Here rather than in
 *  the store because none of it is needed before somebody asks, and a tab's menu is
 *  fetched as the launch ends; see `warmDoors`. Whether each can happen is the
 *  store's to answer, since the palette greys its rows on it. */

import { folderNote } from '../folder-notes'
import { folderOf } from '../space-paths'
import { pages } from '../web-tab/pages.svelte'
import { workspace } from '../workspace.svelte'
import { Tab } from '../workspace/documents.svelte'
import { closesPinned } from '../workspace/closing-pinned'
import { nextPane } from '../workspace/pane-tree'
import { chosen } from './chosen.svelte'

/** Chrome's and Obsidian's duplicate: right after the tab and in front, a second view
 *  of the one document, where the tab was in it - the caret, the trail, the page of a
 *  site - and pinned where it was pinned. A split makes the same kind of copy. */
export function duplicateTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab || !workspace.canDuplicateTab(tab)) return

  const copy = new Tab(tab.note, tab.paneId)
  copy.cursor = tab.cursor
  copy.scroll = tab.scroll
  copy.anchor = tab.anchor
  copy.line = tab.line
  copy.folds = tab.folds
  copy.trail = tab.trail
  copy.at = tab.at
  copy.pinned = tab.pinned
  copy.reading = tab.reading
  copy.camera = tab.camera
  copy.page = tab.page
  copy.zoom = tab.zoom
  copy.address = pages.addressOf(tab.id) ?? tab.address

  if (tab.kind === 'web') {
    const page = pages.of(copy.id)
    page.url = copy.address ?? null
    page.title = pages.of(tab.id).title
  }

  const at = workspace.tabsIn(tab.paneId).indexOf(tab)
  workspace.tabs = [...workspace.tabs, copy]
  workspace.moveTab(copy.id, tab.paneId, at + 1)
}

/** VS Code's "move editor into next group": to the next pane round, or into a new
 *  pane beside its own where there is no other yet - the drag's two landings. */
export function moveToOtherPane(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab || !workspace.canMoveToOtherPane(id)) return

  const next = workspace.panes.count > 1 ? nextPane(workspace.panes.frame, tab.paneId) : null
  if (next) workspace.moveTab(id, next.id)
  else workspace.dropTab(id, { kind: 'pane', paneId: tab.paneId, zone: 'right' })
}

/** A tab's Rename, and F2 on it: the name field on the file's row in the file list,
 *  with the list brought out and the folders down to it opened. One place a file is
 *  renamed, so the links, a folder that is also a note and a name already taken are
 *  what they are everywhere else. A folder's own note is the folder's row. */
export function renameFromTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  const path = tab?.path
  if (!tab || !path || !workspace.canRenameFromTab(tab)) return

  const folder = workspace.entryAt(folderOf(path))
  const row = folder && folderNote(folder)?.path === path ? folder.path : path

  workspace.activeTabId = tab.id
  workspace.showPanel('tree')
  if (folderOf(row) !== workspace.activeSpace?.root) workspace.revealFolder(folderOf(row))
  workspace.startRenaming(row)
}

/* ── Several tabs at once ─────────────────────────────────────────
   What a pick of tabs does together; see chosen.svelte.ts. */

/** Several tabs put down together, in their own order, in front of one tab of a pane or
 *  at its end, from wherever each of them was: a drag of a pick, let go. The last goes
 *  first and each of the others in front of the one after it, which is the one order in
 *  which every `moveTab` lands where it was meant to. The first of them is in front. */
export function placeBlock(ids: readonly string[], paneId: string, before: string | null) {
  let next = before
  for (const id of [...ids].reverse()) {
    const strip = workspace.tabsIn(paneId).filter((one) => one.id !== id)
    const at = next === null ? -1 : strip.findIndex((one) => one.id === next)
    workspace.moveTab(id, paneId, at < 0 ? strip.length : at)
    next = id
  }
}

/** A pick carried to the other pane, in its order, and still picked there. */
export function moveManyToOtherPane(ids: readonly string[]) {
  const [first] = ids
  if (first === undefined) return

  moveToOtherPane(first)
  const paneId = workspace.tabs.find((one) => one.id === first)?.paneId
  if (!paneId) return

  placeBlock(ids, paneId, null)
  chosen.paneId = paneId
}

/** Each tab of a pick duplicated, each beside itself. */
export function duplicateMany(ids: readonly string[]) {
  for (const id of ids) duplicateTab(id)
}

/** A pick pinned, or let go of, together: Pin while any of them is not, as Chrome's row
 *  says. Pinned in their order, each joining the back of the run, and let go of the
 *  other way round, each landing at the front of what is not pinned - so the order the
 *  strip had is the order it keeps. */
export function pinMany(tabs: readonly Tab[]) {
  const pinning = tabs.some((one) => !one.pinned)
  const turning = pinning ? tabs.filter((one) => !one.pinned) : [...tabs].reverse()
  for (const one of turning) workspace.togglePin(one.id)
}

/** Ctrl+W on a pick: all of it goes, as in Chrome, with the one question a pinned tab
 *  closed by key is asked, once for the lot. */
export async function closeChosen(tabs: readonly Tab[]) {
  if (tabs.some((one) => one.pinned) && !(await closesPinned())) return
  await workspace.closeMany(tabs.map((one) => one.id))
}
