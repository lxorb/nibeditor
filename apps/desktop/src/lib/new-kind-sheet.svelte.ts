/** The dialog Ctrl+T opens: which kinds it offers, which one stands, and what a choice
 *  does.
 *
 *  Emil, 2026-09-27: *"Ctrl + T should always open a webpage by default. And that
 *  should always be the selected option in the modal when holding the Ctrl. Also we
 *  need an other modal, not just a small one but a proper modal in the centre of the
 *  screen."*
 *
 *  A store rather than the component's own state, because three hands move it and only
 *  one of them is on the dialog: the chord steps it with T and chooses when the
 *  modifier is let go, from the window; the palette and the File menu open it; and the
 *  arrows, a letter, the pointer and a click reach it through the dialog itself. The
 *  selection is a number here, so the chord never has to find a row in the page. See
 *  new-kind-chord.ts and NewKindSheet.svelte.
 *
 *  Fetched rather than carried, with the chord that is its first reader: nothing of it
 *  is worth a byte before the launch has drawn a note. */

import { firstChoice, letterAt, stepAt } from './new-kind-choice'
import { newKinds, type NewKindRow } from './new-kinds'
import { newKindDialog } from './surfaces.svelte'

class NewKindSheet {
  open = $state(false)
  /** What is offered, read as it opens: a phone has one fewer, and a window resized
   *  under an open dialog should not renumber the card a hand is standing on. */
  kinds = $state.raw<NewKindRow[]>([])
  /** The card that stands, as a place in `kinds`. */
  at = $state(0)

  /** The pane the tab is for: whichever had the keyboard when somebody asked. */
  private paneId: string | undefined

  /** Up, on the website - or on a note where there is none; see new-kind-choice.ts. */
  show(paneId?: string): void {
    // The dialog is mounted at the launch's last turn with the other doors; this is
    // for a press that beat it there.
    void newKindDialog.ask()

    this.kinds = newKinds()
    this.at = firstChoice(this.kinds.map((one) => one.kind))
    this.paneId = paneId
    this.open = true
  }

  /** One along, or back. */
  step(by: number): void {
    if (!this.open) return

    this.at = stepAt(this.at, this.kinds.length, by)
  }

  /** Stands on a card, for the pointer moving over it. */
  standOn(at: number): void {
    if (this.open && at >= 0 && at < this.kinds.length) this.at = at
  }

  /** Makes the one that stands, or the one given, and goes. */
  pick(at: number = this.at): void {
    if (!this.open) return

    const one = this.kinds[at]
    this.open = false
    one?.make(this.paneId)
  }

  /** Makes the kind a letter names. True when a kind answered it. */
  pickLetter(key: string): boolean {
    const at = letterAt(
      this.kinds.map((one) => one.letter),
      key,
    )
    if (at < 0) return false

    this.pick(at)
    return true
  }

  /** Closed, and nothing made. */
  dismiss(): void {
    this.open = false
  }
}

export const newKindSheet = new NewKindSheet()

/** What a tap of the chord makes, with nothing drawn: the kind the dialog would have
 *  opened on, in the pane that asked. Which is the new tab a browser makes. */
export function makeFirst(paneId?: string): void {
  const kinds = newKinds()
  kinds[firstChoice(kinds.map((one) => one.kind))]?.make(paneId)
}
