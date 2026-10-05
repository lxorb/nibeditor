/** Where the AI panel is to be found: its tab where one is open ("Open in new tab"),
 *  else the right side, opened if it is not. One rule for everything that hands the
 *  panel something to go on with - Alt+K's quote, the quick question's Continue - so
 *  the conversation is never drawn in a second place by being asked for. */

import { revealPanel } from '../../focus'
import { workspace } from '../../workspace.svelte'

export function revealChat(): void {
  const tab = workspace.tabs.find((one) => one.kind === 'chat')
  if (tab) workspace.panes.activate(tab.paneId, tab.id)
  else if (workspace.openOn(workspace.sideOf('ask')) !== 'ask') revealPanel('ask')
}

/** The panel moved into a tab of its own: the tab, and the side it came from shut. */
export function chatToTab(): void {
  workspace.openChat()
  const side = workspace.sideOf('ask')
  if (workspace.openOn(side) === 'ask') workspace.closePanel(side)
}
