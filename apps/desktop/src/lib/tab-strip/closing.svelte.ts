/** The widths a strip holds still while its tabs are being closed with the pointer.
 *
 *  Chrome's closing mode (docs/chrome-tabs.md): close a tab with the mouse and the
 *  others keep the widths they had, so the close button of the next one slides in
 *  under the pointer and a row of tabs can be closed without moving the hand. The
 *  strip lays itself out again once the hand has left - forty pixels below it or
 *  sixty past its end - or two seconds after a finger closed one, or as soon as a
 *  tab arrives or the order changes. What the widths are is layout.ts; this is
 *  only when they are held. */

import { near, type Rect } from './layout'

/** How long a finger's close holds the widths: a finger has no hover to leave. */
const TOUCH_HOLD = 2000

export class ClosingWidths {
  /** Each tab's width when the first of them was closed, or null while nothing
   *  is being held. */
  widths = $state<ReadonlyMap<string, number> | null>(null)

  /** The order the widths were taken in: any other order ends the hold. */
  private order: readonly string[] = []
  private letGoOfListeners: (() => void) | null = null

  /** Holds the widths. `rect` and `factor` are read as the pointer moves, so a
   *  strip that has scrolled or a language that reads the other way is measured as
   *  it is then. A second close while held keeps what the first one took. */
  hold(
    widths: ReadonlyMap<string, number>,
    order: readonly string[],
    by: 'mouse' | 'touch',
    rect: () => Rect | null,
    factor: () => number,
  ) {
    if (this.widths) return

    this.widths = widths
    this.order = order

    if (by === 'touch') {
      const timer = setTimeout(() => this.letGo(), TOUCH_HOLD)
      this.letGoOfListeners = () => clearTimeout(timer)
      return
    }

    const moved = (event: PointerEvent) => {
      const box = rect()
      if (!box || !near(box, event.clientX, event.clientY, factor())) this.letGo()
    }
    const left = () => this.letGo()

    window.addEventListener('pointermove', moved)
    document.documentElement.addEventListener('pointerleave', left)
    this.letGoOfListeners = () => {
      window.removeEventListener('pointermove', moved)
      document.documentElement.removeEventListener('pointerleave', left)
    }
  }

  /** Whether the strip is still the one the widths were taken of, with tabs
   *  closed and nothing else: anything new, or a new order, and they go. */
  still(order: readonly string[]): boolean {
    if (!this.widths) return false

    let at = 0
    for (const id of order) {
      const found = this.order.indexOf(id, at)
      if (found < 0) {
        this.letGo()
        return false
      }
      at = found + 1
    }

    return true
  }

  letGo() {
    this.letGoOfListeners?.()
    this.letGoOfListeners = null
    this.widths = null
    this.order = []
  }
}
