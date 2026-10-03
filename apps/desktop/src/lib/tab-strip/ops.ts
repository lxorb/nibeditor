/** What a tab's own menu does to a tab beyond closing it: a second tab on the same
 *  thing, the tab carried to another pane, and its name changed. Here rather than in
 *  the store because none of it is needed before somebody asks, and a tab's menu is
 *  fetched as the launch ends; see `warmDoors`. Whether each can happen is the
 *  store's to answer, since the palette greys its rows on it. */

import { folderNote } from '../folder-notes'
import { t } from '../i18n.svelte'
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
  copy.inPrivate = tab.inPrivate

  if (tab.kind === 'web') {
    const page = pages.of(copy.id)
    page.url = copy.address ?? null
    page.title = pages.of(tab.id).title
    page.inPrivate = tab.inPrivate
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
 *  what they are everywhere else. A folder's own note is the folder's row.
 *
 *  A terminal has no row and no file: its name is typed where it is written, in the
 *  strip, as Windows Terminal's is. See `nameInStrip`. */
export function renameFromTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (tab?.kind === 'terminal') {
    void nameInStrip(tab)
    return
  }
  const path = tab?.path
  if (!tab || !path || !workspace.canRenameFromTab(tab)) return

  const folder = workspace.entryAt(folderOf(path))
  const row = folder && folderNote(folder)?.path === path ? folder.path : path

  workspace.activeTabId = tab.id
  workspace.showPanel('tree')
  if (folderOf(row) !== workspace.activeSpace?.root) workspace.revealFolder(folderOf(row))
  workspace.startRenaming(row)
}

/** The field over a terminal's name in the strip, the tab brought to the front so its
 *  name is on it. A pinned tab is its mark and no name, so it is asked in the question
 *  sheet instead. See TabNameField.svelte and terminal/rename.ts. */
async function nameInStrip(tab: Tab) {
  if (tab.pinned) {
    const [{ prompt }, { renameTerminal }] = await Promise.all([
      import('../prompt.svelte'),
      import('../terminal/rename'),
    ])
    const typed = await prompt.ask({ title: t('Rename'), value: tab.shown })
    if (typed !== null) await renameTerminal(tab, typed)
    return
  }

  for (const one of workspace.tabs) one.naming = one === tab
  workspace.activate(tab.id)
}
