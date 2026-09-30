/** Chrome's tab hover card, as numbers and words: how long it waits, where it hangs
 *  and what it says. Read off `tab_hover_card_controller.cc` and
 *  `tab_hover_card_bubble_view.cc`; see docs/chrome-tabs.md. Pure, so the whole of it
 *  is tested without a window; hover-card.svelte.ts is what runs it. */

import { withinSpace } from '../space-paths'
import { WIDTH } from './layout'

/** Chrome's wait, before the first card, on a logarithmic scale: 300 ms while the tabs
 *  are no wider than a pinned one, 800 ms at the standard width, and half a second more
 *  once they are all that wide - a tab whose whole name is already on it has less to
 *  tell. Measured on the widest tab of the strip, so every tab of one strip waits the
 *  same. */
export function showDelay(widest: number): number {
  const least = WIDTH.pinned
  if (widest <= least) return 300

  const along = Math.log(widest - least + 1) / Math.log(WIDTH.standard - least + 1)
  return Math.round(300 + 500 * Math.min(along, 1)) + (widest >= WIDTH.standard ? 500 : 0)
}

/** Back over a tab this soon after leaving the strip, the card comes at once: the
 *  pointer only slipped off. */
export const REENTRY = 300

/** How far below the tab the card hangs, and how close to the window's edges it may
 *  come. */
const BELOW = 4
const MARGIN = 8

/** A tab's body on the glass. */
export interface Anchor {
  left: number
  right: number
  bottom: number
}

/** Where the card's corner goes: under the tab, from its leading edge - the left, or
 *  the right in a language that reads the other way - and kept inside the window. */
export function spot(
  anchor: Anchor,
  width: number,
  room: number,
  factor: number,
): { x: number; y: number } {
  const start = factor > 0 ? anchor.left : anchor.right - width
  const x = Math.min(Math.max(start, MARGIN), Math.max(MARGIN, room - width - MARGIN))
  return { x, y: anchor.bottom + BELOW }
}

/** The site a page is on, the way Chrome's card names it: the host, without the
 *  `www.` nobody reads. Nothing for an address that is not a site. */
export function siteOf(address: string | null | undefined): string {
  if (!address) return ''
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** A space as far as this needs one. */
export interface Place {
  name: string
  root: string
}

/** Where a file lives: its space, and the folders down to it. Nothing for a file in
 *  no space, which has nowhere to say. */
export function whereOf(path: string | null, spaces: readonly Place[]): string {
  if (!path) return ''

  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside !== null) return [space.name, ...inside.split('/').slice(0, -1)].join(' / ')
  }

  return ''
}
