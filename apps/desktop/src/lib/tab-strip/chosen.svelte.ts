/** Several tabs at once: the ones Ctrl and Shift picked out of one pane's strip, which a
 *  tab's menu, Ctrl+W and a drag act on together. What each click does to it, and what
 *  a pick does, is picking.ts, fetched with the first click that picks.
 *
 *  One pane's at a time, and only while the tab in front is one of them: anything else
 *  that brings a tab to the front has put the pick down without having to say so. */

import { workspace, type Tab } from '../workspace.svelte'

/** What a click with a modifier does to the pick. */
export type Picking = 'toggle' | 'run' | 'add-run'

/** A click's modifiers, as a pick: Ctrl - Cmd on a Mac - for one tab, Shift for a run,
 *  both to add a run. Null for a plain click. */
export function pickingOf(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  mac: boolean,
): Picking | null {
  const toggle = mac ? event.metaKey : event.ctrlKey
  if (toggle && event.shiftKey) return 'add-run'
  if (event.shiftKey) return 'run'
  return toggle ? 'toggle' : null
}

class Chosen {
  /** The pane the pick is in, and its tabs, by id. */
  paneId = $state<string | null>(null)
  ids = $state<readonly string[]>([])
  /** Where a Shift and a click counts from: the last tab clicked. */
  anchor: string | null = null

  /** The tabs picked in a pane, in the strip's order, while there are two or more of
   *  them and the tab in front is one. Nothing otherwise. */
  of(paneId: string): Tab[] {
    if (this.paneId !== paneId || this.ids.length < 2) return []

    const front = workspace.panes.at(paneId)?.activeTabId
    if (!front || !this.ids.includes(front)) return []

    const tabs = workspace.tabsIn(paneId).filter((one) => this.ids.includes(one.id))
    return tabs.length > 1 ? tabs : []
  }

  /** One tab alone again. */
  clear() {
    this.paneId = null
    this.ids = []
    this.anchor = null
  }
}

export const chosen = new Chosen()
