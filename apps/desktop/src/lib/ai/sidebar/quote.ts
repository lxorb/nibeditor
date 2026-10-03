/** Alt+K: the selection in the note in front, into the AI panel's field as a chip named
 *  the way Claude Code names one, `Herons:12-14`. The words are taken as they are at the
 *  press, so the chip says the same thing whatever is selected by the time it is sent. */

import { revealPanel } from '../../focus'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import { chat } from './chat.svelte'
import { sameMention } from './mentions'

export function quoteSelection(): void {
  const view = views.of(workspace.panes.focusedId)
  const tab = workspace.active
  const range = view?.state.selection.main
  if (!view || !range || range.empty || tab?.kind !== 'note') return

  const doc = view.state.doc
  const first = doc.lineAt(range.from).number
  const last = doc.lineAt(range.to).number
  const label = first === last ? `${tab.shown}:${first}` : `${tab.shown}:${first}-${last}`
  const chip = {
    kind: 'words' as const,
    id: label,
    label,
    text: doc.sliceString(range.from, range.to),
  }
  if (!chat.chips.some((one) => sameMention(one, chip))) chat.chips = [...chat.chips, chip]
  if (workspace.openOn('right') !== 'ask') revealPanel('ask')
  chat.focus()
}
