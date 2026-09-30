/** When a tab fills the window, and when it stops. Pure: the command is fill.ts and the
 *  bar a filled window keeps is FillBar.svelte.
 *
 *  Emil, 2026-09-30: *"a shortcut to make the current tab full screen (to toggle that).
 *  I mean by full screen the full window of nib, not F11 behaviour."* What fills is the
 *  pane being worked in, with whichever of its tabs is in front; everything around it -
 *  both sides, the strips, the other panes, the status bar - goes, and comes back exactly
 *  as it was, because none of it is changed. See docs/keyboard.md, "Full window". */

/** As much of the panes as the rules read. */
export interface Filling {
  /** The pane filling the window, or null. */
  fills: string | null
  /** The pane being worked in. */
  focusedId: string
  /** The tab in front of that pane, or null for a pane showing nothing. */
  showing: string | null
}

/** Whether the pane being worked in may fill the window: it shows something, and the
 *  window is a desktop's. A phone and a tablet already show one document and nothing
 *  beside it. */
export function mayFill(showing: string | null, touch: boolean): boolean {
  return showing !== null && !touch
}

/** Whether a fill still holds.
 *
 *  VS Code's maximized editor group is the rule: the tabs of the group change under it -
 *  Ctrl+Tab, a digit, a link followed, a tab closed with another behind it - and it stays
 *  maximized; working in another group ends it. So a fill lasts while the same pane is
 *  worked in and shows something, and ends when another pane is (a tab of another pane
 *  chosen, a split, a link opened beside) or this one shows nothing (its last tab closed,
 *  Ctrl+D): a window with no strip, no list and no document in it is a window nobody can
 *  find their way out of. */
export function stillFills(panes: Filling): boolean {
  return panes.fills !== null && panes.fills === panes.focusedId && panes.showing !== null
}

/** What the keyboard is on, as far as Escape is concerned. */
export interface Holder {
  closest(selector: string): unknown
  readonly isContentEditable?: boolean
  readonly tagName?: string
}

/** Fields read Escape themselves: a name being typed puts it back, a box of the
 *  settings closes. */
const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Whether Escape may leave the fill: only where nothing else has a use for it.
 *
 *  Escape steps back one level and never does anything (docs/keyboard.md). Inside a pane
 *  the level is the document's own - the find bar, a picture stepped off, vim's normal
 *  mode, a shell's own Escape, a card let go of, a page stopped loading - so there it is
 *  the document's, the way VS Code's maximized group never answers Escape at all. Zen
 *  mode's Escape pressed twice was not copied: a vim hand and bash (which completes on it)
 *  press Escape twice all day. What is left is the keyboard on nothing, or on the bar the
 *  filled window keeps, and there the next level up is the fill. A web page never gives
 *  the app its Escape in the first place. */
export function escapeLeaves(holder: Holder | null): boolean {
  if (holder === null) return true
  if (holder.isContentEditable === true || FIELDS.has(holder.tagName ?? '')) return false

  return holder.closest('[data-pane]') === null
}

/** Whether the bar a filled window keeps may slide away: nothing is holding it - the
 *  pointer, the keyboard, or a menu it opened, which sits outside it while the pointer
 *  is on the menu. */
export function mayHide(held: { pointer: boolean; keyboard: boolean; layers: number }): boolean {
  return !held.pointer && !held.keyboard && held.layers === 0
}

/** How far from the top of the window the pointer brings the bar back, in pixels. Deep
 *  enough to be reached below the few pixels a window with no frame keeps for resizing it,
 *  shallow enough that the top line of what fills is still the tab's own. */
export const EDGE = 6

/** Whether the pointer, at this height in the window, is asking for the bar. */
export function atEdge(y: number): boolean {
  return y >= 0 && y < EDGE
}
