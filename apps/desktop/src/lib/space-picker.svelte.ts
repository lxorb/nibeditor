/** Whether the switcher in the middle of the window is up: Ctrl+Space, and
 *  Ctrl+Shift+Space (Cmd+Shift+Space on a Mac).
 *
 *  Emil, 2026-10-03: a key that opens a modal just for switching to another space, a
 *  digit switching at once and a name with Enter. The rows are the title bar's own
 *  (SpaceList.svelte), in the middle of the window rather than hanging from a mark,
 *  because a hand on the keyboard is not looking at the corner the mark is in.
 *
 *  The same key again puts it away, as Shift Shift puts the palette away. On a phone
 *  there is no keyboard to type a number with, so the key - from a keyboard plugged
 *  into a tablet, or the palette's row - opens the drawer's own list, as it did.
 *
 *  The dialog is fetched at the launch's last turn with the other doors, so the first
 *  press finds it mounted; see surfaces.svelte.ts and SpacePicker.svelte. */

import { openSpaces } from './focus'
import { spacePickerDialog } from './surfaces.svelte'
import { viewport } from './viewport.svelte'
import { type Space, workspace } from './workspace.svelte'

class SpacePicker {
  open = $state(false)

  /** Up, or away again. */
  toggle(): void {
    if (viewport.touch) {
      openSpaces()
      return
    }
    if (this.open) {
      this.dismiss()
      return
    }

    // Mounted at the launch's last turn with the other doors; this is for a press that
    // beat it there.
    void spacePickerDialog.ask()
    this.open = true
  }

  /** Away, and to that space: the one switch every other way to a space makes. */
  choose(space: Space): void {
    this.dismiss()
    if (space.id !== workspace.activeSpaceId) void workspace.showSpace(space.id)
  }

  dismiss(): void {
    this.open = false
  }
}

export const spacePicker = new SpacePicker()
