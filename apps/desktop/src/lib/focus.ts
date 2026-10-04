/** Where the keyboard is, and how to put it somewhere else.
 *
 *  The regions are marked in the page with `data-region`, one attribute on an
 *  element that was already there, so the order F6 walks is the order the window
 *  is built in and cannot drift from it. Nothing here decides what the regions
 *  are or which one is next - that is regions.ts, which is arithmetic on a list
 *  and has the tests. This is the half that has to touch the DOM.
 *
 *  A region is entered at its first tab stop, which for a list is the row the
 *  roving tabindex left standing: the note you have open, not the top of the
 *  folder. See roving.ts. */

import { isRegion, type Region, REGIONS, stepRegion } from './regions'
import type { Panel } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** Everything a key can land on. `[tabindex="0"]` first, because that is what a
 *  composite widget leaves standing for Tab and is the row a region should be
 *  entered at; the rest is what a browser would have stopped on anyway. */
const FOCUSABLE =
  '[tabindex="0"], button, input, select, textarea, a[href], summary, [contenteditable="true"]'

/** Whether a key could actually land on it: not disabled, not hidden, not taken
 *  out of the tab sequence, and drawn somewhere. A button inside a panel that is
 *  slid off the side has no boxes at all. */
function reachable(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.matches(':disabled') || node.getAttribute('aria-hidden') === 'true') return false
  if (node.closest('[inert]')) return false
  if (node.tabIndex < 0) return false

  return node.getClientRects().length > 0
}

/** Whether a region is on screen and can hold the keyboard. A shut right side keeps
 *  its box for the slide back in, and is inert and hidden while it waits: a focus put
 *  there goes nowhere, and F6 stood still on the status bar in front of it. */
function standing(box: HTMLElement): boolean {
  if (box.getClientRects().length === 0 || box.closest('[inert]')) return false
  return getComputedStyle(box).visibility !== 'hidden'
}

function boxOf(name: Region): HTMLElement | null {
  for (const found of document.querySelectorAll<HTMLElement>(`[data-region="${name}"]`)) {
    if (!standing(found)) continue
    // A panel that crossfades has two of itself on screen for a moment. The one
    // that counts is the one holding what is open now; the other is on its way out,
    // and putting the keyboard in it means putting it nowhere a frame later.
    if (found.dataset.panel !== undefined && found.dataset.panel !== workspace.panel) continue

    return found
  }

  return null
}

/** The regions on screen. The sidebar may be shut, the strip belongs to a
 *  desktop, and the status bar is left out over a canvas, a page note and the
 *  graph - see `hasStatusBar` in regions.ts: what is here is what the window
 *  happens to be drawing. */
function regionsOn(): Region[] {
  return REGIONS.filter((name) => boxOf(name) !== null)
}

/** Which region the keyboard is in. The nearest one wins, which is what a note
 *  inside a pane inside the panes needs. */
function regionHere(): Region | null {
  const at = document.activeElement
  const box = at instanceof Element ? at.closest('[data-region]') : null
  const name = box?.getAttribute('data-region')

  return isRegion(name) ? name : null
}

/** A region, or one panel's body inside it where one is named: the right side is
 *  one region holding its strip and its body. */
function within(name: Region, panel?: Panel): HTMLElement | null {
  const region = boxOf(name)
  return (panel ? region?.querySelector<HTMLElement>(`[data-panel="${panel}"]`) : null) ?? region
}

/** The first thing in a region a key can land on. */
function entryOf(name: Region, panel?: Panel): HTMLElement | null {
  const box = within(name, panel)
  if (!box) return null

  // A note is one element that takes the keyboard for the whole of itself, and
  // it is the element CodeMirror listens on rather than the box around it. A
  // panel's own field says so with `data-entry`.
  const writing = box.querySelector('.cm-content, [data-entry]')
  if (writing instanceof HTMLElement) return writing

  // Past the edge that resizes the side, which is a control for the region.
  for (const one of box.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (reachable(one) && one.getAttribute('role') !== 'separator') return one
  }

  // Nothing in it to stand on - a Links panel for a note nothing points at, a
  // status bar with no numbers showing - so the region itself takes the keyboard.
  // A region a key walks to has to be able to hold it, or the press lands on the
  // page and the next one starts from nowhere. The practices say the same: the
  // first thing in the region, else the region.
  if (box.tabIndex < 0 && !box.hasAttribute('tabindex')) box.tabIndex = -1
  return box
}

/** Puts the keyboard in a region. False where it is not on screen, or the keyboard did
 *  not go there, which is what lets the caller open something and try again and F6
 *  step over it. */
function focusRegion(name: Region, panel?: Panel): boolean {
  const entry = entryOf(name, panel)
  if (!entry) return false

  entry.focus()
  return document.activeElement === entry
}

/** The note. Every list gives the keyboard back to it, because the note is where
 *  people live. */
export function focusEditor(): boolean {
  return focusRegion('editor')
}

/** One region along, wrapping, from wherever the keyboard is. What F6 does.
 *
 *  A region that is on screen but has nothing to stand on is stepped over rather
 *  than stopped on, so the key never appears to do nothing. */
export function stepRegionFocus(direction: number): boolean {
  const present = regionsOn()
  let from: string | null = regionHere()
  // Once round at most: a window where nothing at all can hold the keyboard has to
  // end the walk rather than go round it for ever.
  let left = present.length

  while (left-- > 0) {
    const next = stepRegion(present, from, direction)
    if (!next) return false
    if (focusRegion(next)) return true
    from = next
  }

  return false
}

/** Opens a panel and puts the keyboard in it; pressing the same key again while
 *  the keyboard is already in it gives the note the keyboard back.
 *
 *  One key there and one key back, because the alternative is a key that opens
 *  something and a second key nobody remembers for leaving it. The panel has to
 *  be drawn before it can be stood in, so the second half waits a frame. */
export function revealPanel(panel: Panel): void {
  const side = workspace.sideOf(panel)
  const region: Region = side === 'right' ? 'right' : 'list'
  if (workspace.openOn(side) === panel && regionHere() === region) {
    focusEditor()
    return
  }

  workspace.showPanel(panel)
  settle(region, panel)
}

/** Puts the keyboard in a region, and keeps at it for a few frames while what is
 *  there is still changing.
 *
 *  One press changes what a panel holds, and the panel crossfades: for a moment
 *  there are two of it on screen, and the one a first attempt lands in is the one
 *  on its way out. So this stops only once the keyboard is somewhere that is still
 *  in the page - which, since a region with nothing in it takes the keyboard
 *  itself, is the very next frame in every ordinary case. */
function settle(name: Region, panel?: Panel, left = 8): void {
  requestAnimationFrame(() => {
    const at = document.activeElement
    if (at instanceof HTMLElement && at.isConnected && within(name, panel)?.contains(at)) return

    focusRegion(name, panel)
    if (left > 0) settle(name, panel, left - 1)
  })
}

/** Presses one control of a region, at its own corner, so the menu it opens
 *  arrives under it rather than in the corner of the window.
 *
 *  The key presses the control the pointer would press: the menu is written once,
 *  in the component that owns it, and a chord for it is not a second copy of the
 *  same list. */
function pressRegion(name: Region, what?: string): boolean {
  const found = what === undefined ? null : boxOf(name)?.querySelector(what)
  const entry = found instanceof HTMLElement ? found : entryOf(name)
  if (!entry) return false

  press(entry)
  return true
}

/** Presses one control at its own corner. The click carries a place because a menu
 *  opens at the pointer, and a key has none: a press from the keyboard used to arrive
 *  at 0,0 and hang its menu in the corner of the window. */
function press(entry: HTMLElement): void {
  entry.focus()
  const box = entry.getBoundingClientRect()
  entry.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(box.left + 8),
      clientY: Math.round(box.bottom),
    }),
  )
}

/** The space switcher, from anywhere: the sidebar's own header opens it, so the
 *  sidebar is opened first where it was shut.
 *
 *  The switcher by name and not the first thing in the header, because where the
 *  panel is a drawer the header carries the button that shuts it and pressing that
 *  would close the very panel this is opening. The name is what it says about
 *  itself - the one control up there that hangs a menu. */
const SWITCHER = '[aria-haspopup="menu"]'

export function openSpaces(): void {
  if (pressRegion('space', SWITCHER)) return

  workspace.showPanel('tree')
  requestAnimationFrame(() => {
    pressRegion('space', SWITCHER)
  })
}
