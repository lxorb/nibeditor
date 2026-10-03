/** The plus a phone and a tablet have, pressed: a new note, and the keyboard in it.
 *
 *  Emil, 2026-10-03: on the phone the plus made `Untitled.md` at once, the keyboard did
 *  not come up, and a hardware Enter made another. So it is the draft every other new
 *  tab is - no file and no row until it is saved, the dot in the bar saying so (see
 *  workspace/drafts.ts) - and the caret goes into it inside the same tap.
 *
 *  Inside the tap because that is the only moment a phone lets a page raise its
 *  keyboard: focus given a frame later lands in the note and leaves the keyboard down.
 *  So the tab is drawn there and then (`flushSync`) and its editor focused before the
 *  handler returns. And the plus lets go of the keyboard either way, so an Enter on a
 *  hardware keyboard types into the note rather than pressing the plus again. */

import { flushSync } from 'svelte'
import { views } from './views.svelte'
import { workspace } from './workspace.svelte'

export function writeNew(event: Event) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()

  workspace.openBlank()
  flushSync()
  views.of(workspace.panes.focusedId)?.focus()
}
