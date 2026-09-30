/** Giving a shortcut a different key.
 *
 *  One keystroke decides it, so the whole of it is about that one keystroke:
 *  which row is waiting for it, whether it can be taken at all, and who else
 *  answers to it already. Nothing is written until that last question has an
 *  answer, because taking a key from another shortcut without saying so is how
 *  a reader ends up with two commands they cannot find. */

import { type Modifier, writeTap } from '../double-tap'
import { readCombination } from '../keys'
import { type Shortcut, shortcuts } from '../shortcuts.svelte'
import { BY_ID } from '../shortcuts/registry'

export class Rebind {
  /** Which entry is listening for a key, if any. */
  listening = $state<string | null>(null)

  /** A key that lands on something else: what was pressed, and who holds it.
   *  Nothing is written until this is answered one way or the other. */
  clash = $state<{ id: string; key: string; holders: Shortcut[] } | null>(null)

  /** Why the last keystroke was not taken, for the row that was listening. */
  turnedDown = $state<{ id: string; reason: string } | null>(null)

  /** Starts listening on a row, or stops if it was already the one. */
  listen(id: string) {
    const same = this.listening === id
    this.forget()
    this.listening = same ? null : id
  }

  /** Nothing left listening behind a closed panel or a pane that moved on. */
  forget() {
    this.listening = null
    this.clash = null
    this.turnedDown = null
  }

  /** Takes the key over: whoever held it is left with none, and the reader
   *  can put that back from the row it came from. */
  takeOver() {
    const clash = this.clash
    if (!clash) return

    for (const holder of clash.holders) shortcuts.set(holder.id, null)
    shortcuts.set(clash.id, clash.key)
    this.clash = null
  }

  /** Reads one keystroke for whichever row is listening.
   *
   *  Escape steps out of recording and Backspace takes the key away, the way
   *  every other shortcut editor does it. Escape and Backspace as shortcuts of
   *  their own are in the fixed list, so nothing is lost by spending them. */
  record(event: KeyboardEvent) {
    const id = this.listening
    if (!id) return

    if (event.key === 'Escape') {
      this.listening = null
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      shortcuts.set(id, null)
      this.listening = null
      return
    }

    const key = readCombination(event, shortcuts.platform)
    // Still only modifiers down: keep waiting for the key itself, or for the same
    // modifier a second time; see `tapped`.
    if (!key) return

    this.take(id, key)
  }

  /** A modifier tapped twice while a row is listening, which is that row's key when
   *  the window runs it. A key the editor reads is CodeMirror's, which has no such
   *  thing as a double tap, so there the row goes on waiting. See tapped.ts, which
   *  hands the tap here rather than to the palette while a row is listening. */
  tapped(key: Modifier) {
    const id = this.listening
    if (!id || BY_ID.get(id)?.scope !== 'app') return

    this.take(id, writeTap(key, shortcuts.platform))
  }

  /** A key for a row, taken if nothing is against it and nobody else holds it. */
  private take(id: string, key: string) {
    const reason = shortcuts.refuse(key)
    if (reason) {
      this.turnedDown = { id, reason }
      this.listening = null
      return
    }

    const holders = shortcuts.conflicts(id, key)
    this.listening = null
    if (holders.length) this.clash = { id, key, holders }
    else shortcuts.set(id, key)
  }
}
