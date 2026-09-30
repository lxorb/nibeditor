/** Several tabs at once: the ones Ctrl and Shift picked out of one pane's strip, which
 *  a tab's menu, Ctrl+W and a drag then act on together.
 *
 *  Chrome's selection (tab.cc, docs/chrome-tabs.md): Ctrl - Cmd on a Mac - and a click
 *  adds a tab or takes it out again, Shift and a click takes every tab from the last
 *  one clicked to this one, both together add that run to what is there, and Shift and
 *  an arrow on a tab the keyboard is on takes the next one along. The tab in front is
 *  always one of them. A plain click on one of them leaves the pick alone for as long as
 *  it may be the start of a drag, and on its release picks that one alone.
 *
 *  One pane's at a time, and only while the tab in front is one of them: anything else
 *  that brings a tab to the front - a click on another, a key, the file list - has put
 *  the pick down without having to say so. */

import { workspace, type Tab } from '../workspace.svelte'

/** What a click with a modifier does to the pick. */
export type Picking = 'toggle' | 'run' | 'add-run'

/** A click's modifiers, as a pick. Null for a plain click. */
export function pickingOf(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  mac: boolean,
): Picking | null {
  const toggle = mac ? event.metaKey : event.ctrlKey
  if (toggle && event.shiftKey) return 'add-run'
  if (event.shiftKey) return 'run'
  return toggle ? 'toggle' : null
}

/** The tabs from one to another along a strip, both ends included, in its order. */
export function runOf(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return order.includes(to) ? [to] : []

  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

class Chosen {
  /** The pane the pick is in, and the tabs in it, by id. */
  paneId = $state<string | null>(null)
  ids = $state<readonly string[]>([])
  /** Where a Shift and a click counts from: the last tab clicked. */
  private anchor: string | null = null

  /** The tabs picked in a pane, in the strip's order, while there are two or more of
   *  them and the tab in front is one. Nothing otherwise. */
  of(paneId: string): Tab[] {
    if (this.paneId !== paneId || this.ids.length < 2) return []

    const front = workspace.panes.at(paneId)?.activeTabId
    if (!front || !this.ids.includes(front)) return []

    const tabs = workspace.tabsIn(paneId).filter((one) => this.ids.includes(one.id))
    return tabs.length > 1 ? tabs : []
  }

  /** A click with a modifier on a tab. Answers the tab to bring to the front, or null
   *  where the click took the tab out of the pick and none of the rest is in front. */
  pick(paneId: string, id: string, how: Picking): string | null {
    const order = workspace.tabsIn(paneId).map((one) => one.id)
    const front = workspace.panes.at(paneId)?.activeTabId ?? id
    const had = this.of(paneId).map((one) => one.id)
    const now = had.length ? had : [front]
    const anchor = this.anchor !== null && now.includes(this.anchor) ? this.anchor : front

    let ids: string[]
    if (how === 'toggle') {
      ids = now.includes(id) ? now.filter((one) => one !== id) : [...now, id]
      this.anchor = id
    } else {
      const run = runOf(order, anchor, id)
      ids = how === 'run' ? run : [...new Set([...now, ...run])]
      this.anchor = anchor
    }

    this.paneId = paneId
    this.ids = ids
    if (ids.includes(id)) return id
    // Taken out: the tab in front stays in front if it is still picked, and otherwise
    // the nearest one that is.
    if (ids.includes(front)) return front
    return ids.at(-1) ?? null
  }

  /** One tab alone again: a plain click, or Escape. */
  clear() {
    this.paneId = null
    this.ids = []
    this.anchor = null
  }
}

export const chosen = new Chosen()
