/** Whether the content under the fingers would take a sideways scroll itself.
 *
 *  Chrome only lets a swipe start where the scroll is left over: every scroller from the
 *  element under the pointer up to the page has had its turn and is at its edge that way.
 *  A wide table in a note, a code block that does not wrap, the stacked pane's row of
 *  columns - each takes the scroll while it can, and the swipe starts at their edge.
 *
 *  And a scroller that says `overscroll-behavior-x: contain` or `none` keeps whatever it
 *  leaves over: that is the line a page draws to say "no swipe here", and the one Google
 *  Sheets draws. So the chain stops there and both ways are the content's.
 *
 *  Read in the app from the element a wheel arrived at up to the pane, never above it:
 *  the window itself says `overscroll-behavior: none` for a browser that would otherwise
 *  go back on it (base.css). A web page answers the same question for itself, up to its
 *  own root; see src-tauri/src/web_swipe.js. */

import type { Side } from './gesture'

/** One scroller, as much of it as the question needs. */
export interface Scroller {
  /** How far along it is, and how far it can go, in CSS pixels. Right to left counts
   *  from nought down, the way browsers write `scrollLeft` for it now. */
  left: number
  range: number
  rtl: boolean
  /** Whether it keeps what it leaves over: `overscroll-behavior-x: contain` or `none`. */
  keeps: boolean
}

/** Half a pixel short of an edge is the edge: a zoomed page stops at fractions. */
const SLACK = 0.5

/** Which way each scroller of a chain, innermost first, would still take a scroll. */
export function taken(chain: readonly Scroller[]): Record<Side, boolean> {
  const both = { left: false, right: false }
  for (const one of chain) {
    const least = one.rtl ? -one.range : 0
    const most = one.rtl ? 0 : one.range
    if (one.left > least + SLACK) both.left = true
    if (one.left < most - SLACK) both.right = true
    if (one.keeps) return { left: true, right: true }
  }
  return both
}

/** The scrollers from `from` up to `root`, `root` included, innermost first: every
 *  element that may scroll sideways and has somewhere to go, and every scroll container
 *  that keeps what it leaves over. */
export function chainOf(from: Element | null, root: Element): Scroller[] {
  const chain: Scroller[] = []
  for (let at = from; at; at = at.parentElement) {
    const style = at.ownerDocument.defaultView?.getComputedStyle(at)
    if (style) {
      // Only a scroll container has an overscroll to keep.
      const container = style.overflowX !== 'visible' && style.overflowX !== 'clip'
      const keeps =
        container &&
        (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none')
      const sideways = /auto|scroll|overlay/.test(style.overflowX)
      const range = at.scrollWidth - at.clientWidth
      if ((sideways && range > SLACK) || keeps) {
        chain.push({
          left: at.scrollLeft,
          range: Math.max(0, range),
          rtl: style.direction === 'rtl',
          keeps,
        })
      }
    }
    if (at === root) break
  }
  return chain
}
