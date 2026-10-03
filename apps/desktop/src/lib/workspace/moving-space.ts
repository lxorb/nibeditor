/** Move to space, carried out: the tab menu's row, the palette's and a tab let go of on a
 *  space in the switcher all end here. What each kind of tab takes with it is decided in
 *  space-move.ts.
 *
 *  The tab itself is never closed and opened again: it is the same tab in another set, so
 *  a terminal's shell is the same process with the same screen, a page keeps its place,
 *  and an unsaved note keeps its words and its undo. The window stays in the space it is
 *  in - Edge opens the workspace a tab is moved to, and that is what its users ask it not
 *  to do - and the tab is in front of its new set when that space is next shown.
 *
 *  Fetched with the first move. */

import { canWriteAt } from '../sharing.svelte'
import { moveHistory } from '../terminal/history'
import { readSpec } from '../terminal/spec'
import { pages } from '../web-tab/pages.svelte'
import type { Tab } from '../workspace.svelte'
import { workspace } from '../workspace.svelte'
import { ownerOf } from './sets'
import { carried, movingOf, spacesFor } from './space-move'
import { ownTabs, tabSets } from './spaces'

/** The tabs, moved to `space`. A file that cannot move - a file of that name already
 *  there - keeps its tab where it is, so nothing is ever half moved. */
export async function moveToSpace(ids: readonly string[], space: string): Promise<void> {
  const ws = workspace
  const target = ws.spaces.find((one) => one.id === space)
  if (!target) return
  const tabs = ids.flatMap((id) => ws.tabs.find((one) => one.id === id) ?? [])
  if (!spacesFor(tabs.map(movingOf), ws, canWriteAt).some((one) => one.id === space)) return

  const moved: Tab[] = []
  const files = new Map<string, boolean>()
  for (const tab of tabs) {
    const how = carried(movingOf(tab), ws.spaces)
    const was = tab.kind === 'web' ? pages.of(tab.id).space : null
    if (how === 'file' && tab.path !== null && ownerOf(tab.path, null, ws.spaces) !== space) {
      if (!(await fileMoved(tab.path, target.root, files))) continue
    } else if (how === 'home') {
      homed(tab, space)
    }
    if (how !== 'tab' && tab.kind === 'web') void rehomed(tab, space, target.name, was)
    // A file that moved takes every view of it along: a second pane on the note is the
    // note, which is the other space's now.
    const views = how === 'file' ? ws.tabs.filter((one) => one.note === tab.note) : [tab]
    moved.push(...views.filter((one) => !moved.includes(one)))
  }
  if (!moved.length) return

  if (tabSets.fetched || ws.spaces.some((one) => ownTabs(one.id))) {
    const { sets } = await import('./sets.svelte')
    await sets.adopt(moved, space)
  } else {
    ws.persist()
  }
}

/** A tab's file moved into the space's root: the one move between spaces there is, with
 *  its links and its Undo. Two tabs on one file move it once. */
async function fileMoved(path: string, root: string, done: Map<string, boolean>) {
  const before = done.get(path)
  if (before !== undefined) return before

  const ok = await workspace.move(path, root).then(
    () => true,
    () => false,
  )
  done.set(path, ok)
  return ok
}

/** A tab with no file given the space as its home. A terminal's last lines move to the
 *  space's folder before anything is written under the new one. */
function homed(tab: Tab, space: string) {
  if (tab.kind === 'terminal') {
    const key = readSpec(tab.doc)?.key ?? ''
    moveHistory({ space: tab.note.home, key }, { space, key })
  }
  tab.note.home = space
}

/** A page in the space's web data from now on, built again there where that is another
 *  store than the one it was built in; see rehome.ts. Chrome keeps a page alive between
 *  two windows of one profile, and so does this between two spaces of one store. */
async function rehomed(tab: Tab, space: string, name: string, was: string | null) {
  const { rehome } = await import('../web-tab/rehome')
  await rehome(tab.id, space, name, was)
}
