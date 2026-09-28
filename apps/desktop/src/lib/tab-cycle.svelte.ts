/** Ctrl+Tab and Ctrl+Shift+Tab: round the strip of the pane being worked in, along it
 *  (Chrome's) or, as an option, in order of use (VS Code's; see workspace/recency.ts).
 *  Ctrl+PgDn and Ctrl+PgUp walk the strip either way, as they do in VS Code. Fetched
 *  as the launch ends; see `warmDoors`. */

import { keep, storedText } from './stored'
import { workspace } from './workspace.svelte'
import { Walk } from './workspace/recency'

const KEY = 'nib:tab-order'

class TabCycle {
  /** This machine's own, like the rest of how its keyboard is set up. */
  byUse = $state(storedText(KEY) === 'use')

  setByUse(on: boolean) {
    this.byUse = on
    keep(KEY, on ? 'use' : 'strip')
  }
}

export const tabCycle = new TabCycle()

let walk: Walk | null = null

/** Whether Ctrl, Cmd or Alt is down, as the last key the window heard says. Read
 *  off every key rather than off the press that asked for a step, which arrives
 *  here without its event; a press heard before this module was is a quick one. */
let holding = false

function heard(event: KeyboardEvent) {
  holding = event.ctrlKey || event.metaKey || event.altKey
  if (walk && !holding) finish()
}

// The settings pane reads the option under node too, where there is no window.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', heard, true)
  window.addEventListener('keyup', heard, true)
}

/** One step round the strip. `mayUseOrder` is Ctrl+Tab's pair, which follows the
 *  option. Every key stays inside its own pane. */
export function cycleTab(direction: number, mayUseOrder = false) {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const current = workspace.activeTabId
  const index = tabs.findIndex((tab) => tab.id === current)
  if (index < 0 || !current) return

  if (!mayUseOrder || !tabCycle.byUse) {
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (next) workspace.activate(next.id)
    return
  }

  if (!walk) {
    walk = new Walk(
      tabs.map((tab) => tab.id),
      current,
      workspace.panes.used,
    )
    // Alt+Tab away and the release never arrives, and a click is somebody who has
    // stopped walking: either ends it where it is.
    window.addEventListener('blur', finish)
    window.addEventListener('pointerdown', finish, true)
  }

  const next = walk.step(direction)
  if (next) workspace.activate(next)
  // Already let go of: one step, and that is the tab being used.
  if (!holding) finish()
}

function finish() {
  window.removeEventListener('blur', finish)
  window.removeEventListener('pointerdown', finish, true)
  if (walk) workspace.panes.used = walk.ended(workspace.activeTabId)
  walk = null
}
