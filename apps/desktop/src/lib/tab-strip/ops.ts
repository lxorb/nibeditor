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
import { nextPane } from '../workspace/pane-tree'

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
