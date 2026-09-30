/** Full window: the tab being worked in fills nib's window, and the window comes back.
 *
 *  One command, `app.fill-tab` - Shift+F11, Ctrl+Shift+Cmd+F on a Mac - from the key, the
 *  palette, the View menu and the tab's own menu. Not the system's full screen: the window
 *  keeps its size, its place and whether it is maximised, and only what is inside it
 *  changes. The rules of when it holds are rules.ts; the bar a filled window keeps, and
 *  every way out that is not this command, are FillBar.svelte; the motion is chrome.ts.
 *
 *  What it is, in the panes store, is one field: which pane fills (`panes.fills`). Nothing
 *  else is changed - not the sides, not the split, not the strip - so everything comes back
 *  exactly as it was, and nothing about it is written down: a window launched with no
 *  strip and no list is the one a person has most trouble finding their way out of. */

import { tick } from 'svelte'
import { focusEditor } from '../focus'
import { viewport } from '../viewport.svelte'
import { workspace } from '../workspace.svelte'
import { chromeGoes, chromeStays } from './chrome'
import { mayFill } from './rules'

/** While the chrome is on its way out, so a second press does not start a second fill. */
let going = false

/** In, or out. `tabId` is the tab whose own menu it was chosen from, which comes to the
 *  front first. */
export async function toggleFill(tabId?: string): Promise<void> {
  if (workspace.panes.fills !== null) unfill()
  else await fill(tabId)
}

/** The pane being worked in fills the window, once the chrome around it has gone. */
async function fill(tabId?: string): Promise<void> {
  if (going || workspace.panes.fills !== null) return
  if (tabId !== undefined && tabId !== workspace.activeTabId) workspace.activate(tabId)

  const pane = workspace.panes.focusedId
  if (!mayFill(workspace.panes.focused.activeTabId, viewport.touch)) return

  // The keyboard stays where it is. Only a key standing on the chrome that is about to go -
  // a tab in the strip, the sidebar's list - is handed to the document, since the place it
  // stood is no longer there to stand on.
  const held = document.activeElement
  const stranded = held instanceof HTMLElement && held.closest('[data-chrome]') !== null

  going = true
  try {
    await chromeGoes()
  } finally {
    going = false
  }

  // Something else was chosen while the chrome was on its way out: nothing fills, and the
  // chrome is let go of where it stands.
  if (
    workspace.panes.focusedId !== pane ||
    !mayFill(workspace.panes.focused.activeTabId, viewport.touch)
  ) {
    chromeStays()
    return
  }

  workspace.panes.fills = pane
  if (stranded) {
    await tick()
    focusEditor()
  }
}

/** The window back, as it was. The chrome's way back in is FillBar.svelte's, because
 *  every way out ends there: this, a panel asked for, the pane left or emptied, Escape. */
export function unfill(): void {
  workspace.panes.fills = null
}
