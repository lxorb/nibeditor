/** Several tabs at once: the ones Ctrl and Shift picked out of one pane's strip, and
 *  what a pick does together - a tab's menu on a picked tab, Ctrl+W, a drag of several.
 *  Fetched with the first click that picks, and held by `picks` in drag.svelte.ts, which
 *  is how the strips, the registry and a drag reach it; nothing of it is in front of the
 *  first paint.
 *
 *  Chrome's selection (tab.cc, docs/chrome-tabs.md): Ctrl - Cmd on a Mac - and a click
 *  adds a tab or takes it out again, Shift and a click takes every tab from the last one
 *  clicked to this one, and both together add that run to what is there. The tab in
 *  front is always one of them. A plain press on one of them leaves the pick alone while
 *  it may be the start of dragging all of them, and its release picks that one alone.
 *
 *  One pane's at a time, and only while the tab in front is one of them: anything else
 *  that brings a tab to the front has put the pick down without having to say so. */

import { workspace, type Tab } from '../workspace.svelte'
import { closesPinned } from '../workspace/closing-pinned'
import { duplicateTab, moveToOtherPane } from './ops'

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

/** The tabs from one to another along a strip, both ends included, in its order. */
export function runOf(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return order.includes(to) ? [to] : []

  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** A click with a modifier on a tab. Answers the tab to bring to the front, or null
 *  where the click took the tab out of the pick and none of the rest is in front. */
export function pick(paneId: string, id: string, how: Picking): string | null {
  const order = workspace.tabsIn(paneId).map((one) => one.id)
  const front = workspace.panes.at(paneId)?.activeTabId ?? id
  const had = chosen.of(paneId).map((one) => one.id)
  const now = had.length ? had : [front]
  const anchor = chosen.anchor !== null && now.includes(chosen.anchor) ? chosen.anchor : front

  let ids: string[]
  if (how === 'toggle') {
    ids = now.includes(id) ? now.filter((one) => one !== id) : [...now, id]
    chosen.anchor = id
  } else {
    const run = runOf(order, anchor, id)
    ids = how === 'run' ? run : [...new Set([...now, ...run])]
    chosen.anchor = anchor
  }

  chosen.paneId = paneId
  chosen.ids = ids
  if (ids.includes(id)) return id
  // Taken out: the tab in front stays in front if it is still picked, and otherwise
  // the last of the rest does.
  if (ids.includes(front)) return front
  return ids.at(-1) ?? null
}

/** A strip with several of its tabs carried as one, which is Chrome's drag of a pick:
 *  the others of the block taken out, and the tab being dragged standing for all of
 *  them, as wide as they are together - so every rule for one tab going along a strip
 *  holds for the block unchanged; see layout.ts. `before` is how far into the block the
 *  dragged tab starts, which is where the pointer holds the block from. */
export function gathered<T extends { readonly id: string }>(
  order: readonly T[],
  widths: readonly number[],
  block: readonly string[],
  lead: string,
): { order: T[]; widths: number[]; from: number; before: number } {
  const kept: T[] = []
  const keptWidths: number[] = []
  let before = 0
  let wide = 0
  let passed = false

  for (const [at, one] of order.entries()) {
    const width = widths[at] ?? 0
    if (block.includes(one.id)) {
      wide += width
      if (one.id === lead) passed = true
      else if (!passed) before += width
      if (one.id !== lead) continue
    }
    kept.push(one)
    keptWidths.push(width)
  }

  const from = kept.findIndex((one) => one.id === lead)
  if (from >= 0) keptWidths[from] = wide
  return { order: kept, widths: keptWidths, from, before }
}

/** Several tabs put down together, in their own order, in front of one tab of a pane or
 *  at its end, from wherever each of them was: a drag of a pick, let go. The last goes
 *  first and each of the others in front of the one after it, which is the one order in
 *  which every `moveTab` lands where it was meant to. */
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
