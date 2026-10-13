/** How wide a sidebar is, and the drag along its edge that changes it.
 *
 *  A habit of the machine rather than of the account: a laptop and a wide
 *  monitor want different widths, so this is kept here and never synced. Null
 *  means the default from the theme tokens, which is also what a double click
 *  on the edge puts back.
 *
 *  One of these per side. The two sides are two columns and a reader who wants a
 *  wide file list does not thereby want a wide outline beside their note, so each
 *  is remembered under its own key - and the edge is mirrored: the right side's
 *  handle is on its left, where dragging left makes it wider. */

import type { PanelSide } from './workspace.svelte'
import { readingFactor } from './direction'
import { forget, isNumber, keep, stored } from './stored'
import { unselectable } from './unselectable'
import { viewport } from './viewport.svelte'

const STORAGE_KEY = 'nib:sidebar-width'
const NARROWEST = 180
const WIDEST = 520

/** Where a side's width is kept. The left side keeps the key it always had, so
 *  a width somebody set before there was a right side is still their width. */
function keyFor(side: PanelSide): string {
  return side === 'right' ? `${STORAGE_KEY}-right` : STORAGE_KEY
}

function saved(side: PanelSide): number | null {
  const width = stored(keyFor(side))
  return isNumber(width) && width >= NARROWEST && width <= WIDEST ? width : null
}

/** Writes the width down, through the one place that writes: a width nobody can
 *  remember is not worth failing a drag over, and the sidebar is the width it is
 *  either way - just not after a restart. See `keep` in stored.ts. */
function write(side: PanelSide, width: number | null) {
  if (width === null) forget(keyFor(side))
  else keep(keyFor(side), String(width))
}

/** One step of an arrow key. A whole row's worth rather than a pixel: a hand
 *  moving the edge with a key is placing the panel, not measuring it. */
const STEP = 16

export class SidebarWidth {
  /** The two ends, for the handle to say where along them it is. */
  readonly narrowest = NARROWEST
  readonly widest = WIDEST

  /** Null means the default width from the theme tokens. */
  pixels = $state<number | null>(null)

  /** Which side this is, asked rather than given: the component that owns one of
   *  these holds its side as a prop, and a prop read once at construction is a
   *  value Svelte is right to warn about. */
  constructor(private readonly which: () => PanelSide = () => 'left') {
    this.pixels = saved(which())
  }

  private get side(): PanelSide {
    return this.which()
  }

  /** Which way the edge goes: the right side's handle is on its left, so a drag
   *  to the left makes it wider. And under an interface that reads right to left
   *  the two panels have swapped ends of the window, so both answers swap with
   *  them: the same drag has to widen the panel it is on either way. */
  private get towards(): number {
    return (this.side === 'right' ? -1 : 1) * readingFactor()
  }

  /** True while a finger or pointer is on the edge, so the panel can turn its
   *  transitions off and follow instead of easing after. */
  dragging = $state(false)

  /** How to end the drag that is on, if one is; see `release`. */
  private ending: (() => void) | null = null

  /** Puts the default back. */
  reset() {
    this.pixels = null
    write(this.side, null)
  }

  /** The same edge, moved with a key: the arrows a step at a time, Home and End
   *  to either end, and Enter or Space the default back - which is what a double
   *  click on the handle does. True when the press was the handle's.
   *
   *  Here and not in the component, because how far a step goes and how wide the
   *  panel may be are this module's to say and the drag already says them. The
   *  panel is measured for the one case where the width is still the theme's own
   *  and there is no number yet to step from. */
  step(key: string, panel: HTMLElement | undefined): boolean {
    const from = this.pixels ?? panel?.getBoundingClientRect().width ?? NARROWEST

    const put = (width: number) => {
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))
      write(this.side, this.pixels)
      return true
    }

    switch (key) {
      case 'ArrowLeft':
        return put(from - STEP * this.towards)
      case 'ArrowRight':
        return put(from + STEP * this.towards)
      case 'Home':
        return put(NARROWEST)
      case 'End':
        return put(WIDEST)
      case 'Enter':
      case ' ':
        this.reset()
        return true
      default:
        return false
    }
  }

  /** Ends the drag from outside it, for the one case where no `pointerup` will:
   *  the sidebar can be closed - Escape, the back gesture, a note chosen on a
   *  phone - while a finger is still on the edge, and then the handle goes and
   *  the window is left wearing a resize cursor with nothing selectable. */
  release() {
    this.ending?.()
  }

  /** The edge follows the pointer; letting go keeps the width. Pointer capture
   *  keeps the events coming even once the pointer has left the thin handle,
   *  which it does in the first few pixels of any drag.
   *
   *  `panel` is the element being resized, measured once at the start: reading
   *  it on every move would measure the width this drag has already set. */
  start(event: PointerEvent, panel: HTMLElement | undefined) {
    if (viewport.touch || event.button !== 0 || !panel) return

    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) return

    const startX = event.clientX
    const from = panel.getBoundingClientRect().width

    handle.setPointerCapture(event.pointerId)
    this.dragging = true
    // The document keeps its own cursor and selection out of the way for the
    // length of the drag.
    document.body.style.cursor = 'col-resize'
    unselectable(document.body, true)

    const move = (moved: PointerEvent) => {
      const moving = (moved.clientX - startX) * this.towards
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, from + moving)))
    }

    const stop = () => {
      if (!this.ending) return
      this.ending = null

      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)

      this.dragging = false
      document.body.style.cursor = ''
      unselectable(document.body, false)
      if (this.pixels !== null) write(this.side, this.pixels)
    }

    this.ending = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
}
