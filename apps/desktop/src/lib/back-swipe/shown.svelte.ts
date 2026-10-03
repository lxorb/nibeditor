/** The arrow a swipe draws, as state: where it is, how far along, and whether it has
 *  been decided. Written by swipes.ts, drawn by SwipeArrow.svelte, and read by a
 *  web tab, whose page the arrow is cut out of while it is over it; see covers.ts.
 *
 *  A module of its own and nothing else in it, so a web tab can follow the arrow
 *  without carrying the listeners that move it. */

import type { Side } from './gesture'

/** Where the arrow comes in, in the window's own pixels: the note or the page under the
 *  pane's head, which the arrow is clipped to. */
export interface Room {
  x: number
  y: number
  width: number
  height: number
}

/** `tracking` while the fingers are on, then `went` or `stayed` while it plays out. */
export type Stage = 'tracking' | 'went' | 'stayed'

export const swiping = $state<{
  /** The tab it is over, or null for no arrow at all. */
  tab: string | null
  room: Room | null
  side: Side
  stage: Stage
  /** One where letting go goes; past one it runs a little further and stops. */
  progress: number
  /** Counts every change, for a web tab to place its page again on each. */
  turn: number
}>({ tab: null, room: null, side: 'left', stage: 'tracking', progress: 0, turn: 0 })
