/** A tab carried out of its strip: where it would land, the drop zones kept in step
 *  with it, the file list's row it would be saved into when it has no file, the space in
 *  the switcher it would move to, and the slide home when it is let go of over nothing.
 *  Only ever wanted once a tab has been lifted, so it is fetched with the first press on
 *  a tab, with the chip drawn under the pointer (TabChip.svelte), rather than carried
 *  into the first paint; see Tabs.svelte, which is the strip's own half. */

import { dropTarget, targetFor } from '../drop-target.svelte'
import { i18n } from '../i18n.svelte'
import { dur } from '../motion'
import { workspace } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'
import type { Landing } from '../workspace/panes.svelte'
import { zoneAt } from '../workspace/zones'
import type { Bounds } from './layout'
import { keyOf, stripOf, type TabDrag } from './drag.svelte'
import { droppedOnSpace, overSpaces } from './space-drop'

/** Where a tab carried out of the strip of `paneId` would land: at a place in another
 *  pane's strip, or in or against a side of a pane. Nothing in the middle of its own
 *  pane, which it is already in - let go there, it goes back. */
function landingAt(x: number, y: number, tabId: string, paneId: string): Landing | null {
  const under = document.elementFromPoint(x, y)
  const other = under?.closest<HTMLElement>('[data-strip]')

  if (other) {
    const id = other.dataset.strip ?? ''
    const at = id === paneId ? undefined : stripOf(id)?.slotAt(x)
    return at === undefined ? null : { kind: 'strip', paneId: id, at }
  }

  const box = under?.closest<HTMLElement>('[data-pane]')
  const id = box?.dataset.pane
  if (!box || !id) return null

  const zone = zoneAt(box.getBoundingClientRect(), x, y, (side) =>
    workspace.canLand(side, id, tabId),
  )
  return zone === 'middle' && id === paneId ? null : { kind: 'pane', paneId: id, zone }
}

/** The drop zones and the landing, kept in step with where the carried tab is. The
 *  panes only offer their zones once the tab is out of the strip: a tab going along its
 *  own strip has nothing to aim at. */
export function follow(drag: TabDrag, paneId: string) {
  const tabId = drag.tabId
  if (!tabId) return

  const where = drag.out ? landingAt(drag.pointer.x, drag.pointer.y, tabId, paneId) : null
  if (keyOf(workspace.panes.landing) !== keyOf(where)) workspace.panes.landing = where
  overList(tabId, drag.out && !where ? drag.pointer : null)

  const carried = drag.out ? tabId : null
  if ((workspace.panes.dragging?.tabId ?? null) !== carried) {
    workspace.panes.dragging = carried ? { tabId: carried } : null
  }
}

/** A tab with no file over the file list is saved where it is let go of, under the
 *  name it offers, with nothing asked - the place is the answer, and the name can be
 *  changed on the row. The row lights the way it lights for a note dragged within the
 *  list, because it is the same question with the same answer (drop-target.svelte.ts):
 *  a folder is itself, a note is the folder it would become, and the stretch below the
 *  last row is the space. See workspace/drafts.ts. */
function folderAt(x: number, y: number): string | null {
  const under = document.elementFromPoint(x, y)
  const row = under?.closest<HTMLElement>('[data-path]')
  const path = row?.dataset.path
  if (path) return targetFor(path, row.hasAttribute('aria-expanded'))

  return under?.closest('[data-space-rest]') ? (workspace.activeSpace?.root ?? null) : null
}

function unsaved(tabId: string) {
  const tab = workspace.tabs.find((one) => one.id === tabId)
  return tab && isUnsaved(tab.note) ? tab : null
}

/** The carried tab is at `point`, or over something else where that is null. */
export function overList(tabId: string, point: { x: number; y: number } | null): void {
  overSpaces(tabId, point)
  const folder = point && unsaved(tabId) ? folderAt(point.x, point.y) : null
  if (folder !== null) dropTarget.over(folder)
  else if (dropTarget.folder !== null) dropTarget.clear()
}

/** Let go of: moved to the space whose row was lit, or saved into the row of the list that
 *  was, where there was one. */
export function droppedOnList(tabId: string): void {
  const folder = dropTarget.folder
  const tab = unsaved(tabId)
  dropTarget.clear()
  if (droppedOnSpace(tabId)) return
  if (folder !== null && tab) void workspace.save(tab, folder)
}

/** The app's one easing, read from the stylesheet that owns it. */
const easeOut = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'

/** A tab that was out over the panes and comes back to its strip slides home from where
 *  it was let go, rather than appearing in its slot. `find` answers the tab's box and
 *  where it is to be drawn, on the frame after, and `top` is the strip's inset above it. */
export function flyHome(
  find: () => readonly [HTMLElement | null | undefined, Bounds | undefined],
  from: { left: number; top: number },
  top: number,
) {
  requestAnimationFrame(() => {
    const [node, box] = find()
    if (!node || !box) return

    const rect = node.getBoundingClientRect()
    const x = box.x * i18n.factor
    node.animate(
      [
        { transform: `translate(${x + from.left - rect.left}px, ${from.top - top - rect.top}px)` },
        { transform: `translate(${x}px, 0)` },
      ],
      { duration: dur(210), easing: easeOut() },
    )
  })
}
