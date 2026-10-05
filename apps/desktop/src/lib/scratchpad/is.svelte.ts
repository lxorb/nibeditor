/** The scratchpad by name in no space, and its card: up or not, and how wide. Eager, so
 *  a card left up has its column before the note is drawn. See pad.ts. */

import { focusEditor } from '../focus'
import { nameOf } from '../space-paths'
import { isRecord, keep, stored } from '../stored'
import { workspace } from '../workspace.svelte'

export const SCRATCHPAD = 'Scratchpad.md'
export const WIDTH = 320

export function isScratchpad(path: string | null | undefined): boolean {
  return !!path && nameOf(path) === SCRATCHPAD && workspace.outside(path)
}

const inCard = () => !!document.activeElement?.closest('[data-scratchpad]')

class Shown {
  on = $state(false)
  width = $state(WIDTH)
  /** A person asked: the card takes the keyboard. */
  calling = $state(false)
  from: HTMLElement | null = null

  constructor() {
    const kept = stored('nib:scratchpad')
    if (!isRecord(kept)) return
    this.on = kept.on === true
    if (typeof kept.width === 'number') this.resize(kept.width)
  }

  show(take = true) {
    this.calling = take
    this.set(true)
  }

  /** Away, the keyboard back where it was. */
  hide() {
    if (inCard()) {
      if (this.from?.isConnected) this.from.focus({ preventScroll: true })
      else focusEditor()
    }
    this.from = null
    this.set(false)
  }

  toggle() {
    if (this.on) this.hide()
    else this.show()
  }

  resize(width: number) {
    this.width = width
    this.set(this.on)
  }

  private set(on: boolean) {
    this.on = on
    keep('nib:scratchpad', JSON.stringify({ on, width: this.width }))
  }
}

export const shown = new Shown()

/** Up with the keyboard elsewhere, the keyboard in (VS Code's terminal key); else the
 *  switch. */
export function toggleScratchpad(): void {
  if (__EVEN_PLUGIN__) return
  if (shown.on && !inCard()) shown.calling = true
  else shown.toggle()
}
