/** What each page has said it stands on: per tab while it is open, and per address for
 *  the next time, so a tab opened again - or a page of a site seen before - wears its
 *  colour before it has loaded rather than after.
 *
 *  Kept the way the favicon cache keeps marks (see `favicons` in web-tab/pages.svelte.ts):
 *  by the page's origin and path, and a page never seen borrows its origin's colour, never
 *  the registrable site's. Small and bounded: a colour is seven characters. */

import { type Rgb, rgbOf } from '../legibility'
import { isNumber, isRecord, isString, keep, stored } from '../stored'
import { keysOf } from '../web-tab/pages.svelte'

const KEY = 'nib:glass-grounds'

/** How many addresses are kept; the least lately seen go first. */
const MOST = 300

/** A colour, and when it was last said. */
type Kept = [colour: string, said: number]

function read(): Map<string, Kept> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once; what is drawn is `live`
  const held = new Map<string, Kept>()
  const said = stored(KEY)
  if (!isRecord(said)) return held
  for (const [key, one] of Object.entries(said)) {
    if (Array.isArray(one) && isString(one[0]) && rgbOf(one[0]) && isNumber(one[1])) {
      held.set(key, [one[0], one[1]])
    }
  }
  return held
}

class Grounds {
  /** What each open tab's page last said, and where it was when it said it. */
  private live = $state<Record<string, { at: string | null; colour: string | null }>>({})
  private kept: Map<string, Kept> | null = null

  private index(): Map<string, Kept> {
    this.kept ??= read()
    return this.kept
  }

  /** The colour a tab's page stands on: what it said where it is now, else what this
   *  device saw at that address or its origin. */
  of(tab: string, address: string | null): Rgb | null {
    const mine = this.live[tab]
    if (mine?.at === address) return mine.colour === null ? null : rgbOf(mine.colour)

    const keys = keysOf(address)
    if (!keys) return null
    for (const key of keys) {
      const found = this.index().get(key)
      if (found) return rgbOf(found[0])
    }
    return null
  }

  /** Whether a tab's page has said anything where it is now, colour or none. */
  heard(tab: string, address: string | null): boolean {
    return this.live[tab]?.at === address
  }

  /** What a tab's page said, at its address; null for a page that said nothing. */
  said(tab: string, address: string | null, colour: string | null): void {
    this.live = { ...this.live, [tab]: { at: address, colour } }

    const keys = keysOf(address)
    if (!keys || colour === null) return
    const index = this.index()
    const now = Date.now()
    for (const key of keys) index.set(key, [colour, now])

    if (index.size > MOST) {
      const oldest = [...index.entries()].sort((one, two) => one[1][1] - two[1][1])
      for (const [key] of oldest.slice(0, index.size - MOST)) index.delete(key)
    }
    keep(KEY, JSON.stringify(Object.fromEntries(index)))
  }
}

export const grounds = new Grounds()
