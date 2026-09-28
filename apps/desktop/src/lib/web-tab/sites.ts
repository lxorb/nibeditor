/** What this device remembers about a site beside what it may do: whether it is muted,
 *  and how large it is drawn.
 *
 *  Chrome keeps both by site. "Mute site" in a tab's menu silences that site in every
 *  tab and the next time it is opened, until it is unmuted; a page zoomed with Ctrl and
 *  the wheel opens at that size again, and every other site at a hundred per cent. A
 *  zoom kept for one tab only was the bug: a new site in the same tab was drawn at the
 *  last site's size, and the site the reader had made larger was small again tomorrow.
 *
 *  By site as the bar shows it (`siteOf`), and this device's, like the permissions
 *  beside it: it is about this screen and these speakers. Nothing is kept for a site at
 *  its defaults, so the store holds only what somebody chose. */

import { withOrWithout } from '../records'
import { isNumber, keep, recordOf, stored, stringList } from '../stored'

const MUTED_KEY = 'nib:web-muted'
const ZOOMS_KEY = 'nib:web-zooms'

/** The sites muted, read once and written through. */
let muted: Set<string> | null = null
/** How large each site is drawn where it is not a hundred per cent. */
let zooms: Record<string, number> | null = null

function mutedNow(): Set<string> {
  muted ??= new Set(stringList(stored(MUTED_KEY)) ?? [])
  return muted
}

function zoomsNow(): Record<string, number> {
  zooms ??= recordOf(stored(ZOOMS_KEY), isNumber)
  return zooms
}

/** Whether a site is muted. Nothing is, before anybody said so. */
export function isMuted(site: string): boolean {
  return site !== '' && mutedNow().has(site)
}

/** Mutes a site, or lets it be heard again. */
export function setMuted(site: string, on: boolean): void {
  if (!site) return

  const all = mutedNow()
  if (on) all.add(site)
  else all.delete(site)
  keep(MUTED_KEY, JSON.stringify([...all]))
}

/** How large a site is drawn: what it was left at, or a hundred per cent. */
export function zoomOf(site: string): number {
  return zoomsNow()[site] ?? 1
}

/** Remembers how large a site is drawn. A hundred per cent is forgetting it. */
export function keepZoom(site: string, factor: number): void {
  if (!site || !Number.isFinite(factor) || factor <= 0) return

  // The engine answers in doubles, and 1.1 comes back as 1.1000000238. Two places
  // is every rung of the ladder, and makes one answer of the two.
  const round = Math.round(factor * 100) / 100
  zooms = withOrWithout(zoomsNow(), site, round === 1 ? null : round)
  keep(ZOOMS_KEY, JSON.stringify(zooms))
}

/** Forgets what was read, for a test that writes storage underneath. */
export function reread(): void {
  muted = null
  zooms = null
}
