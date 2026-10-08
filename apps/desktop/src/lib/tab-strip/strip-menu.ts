/** The strip's own menu: what a right click or a held finger on the empty stretch
 *  of a tab strip offers, beside the tabs rather than on any one of them.
 *
 *  Chrome's rows there, trimmed to what nib has behind them: a new tab, the tab
 *  closed last back, and every tab in the strip closed. Emil, 2026-09-30: *"when you
 *  click on the bar here there should be the option: reopen closed tab"*.
 *
 *  Each row is about this strip's pane, so the two strips of a split window each
 *  answer for their own: the new tab opens here, a closed tab whose pane has gone
 *  comes back here, and Close all tabs closes these and no others. Reopen is greyed
 *  rather than left out, unlike on a tab's own menu: here it is the row somebody came
 *  for, and a row that is not there cannot be found. */

import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { shortcuts } from '../shortcuts.svelte'
import { workspace } from '../workspace.svelte'

export function stripMenu(paneId: string): MenuEntry[] {
  // Any tab of the strip names it for a close around one; the one in front is at hand.
  const inFront = workspace.panes.at(paneId)?.activeTabId ?? ''

  return [
    {
      label: t('New tab'),
      hint: shortcuts.hint('app.new-kind'),
      run: () => workspace.newTab(paneId),
    },
    {
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => {
        // The pane it was closed from while that is still there; this one otherwise.
        workspace.focusPane(paneId)
        void workspace.reopenClosed()
      },
    },
    DIVIDER,
    {
      label: t('Close all tabs'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(inFront, 'all') === 0,
      run: () => void workspace.closeAround(inFront, 'all'),
    },
  ]
}
