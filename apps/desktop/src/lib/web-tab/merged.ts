/** The stores the spaces kept, folded into the one every page shares (#239).
 *
 *  Until 2026-10-13 a space could keep its web data apart, in a store of its own or a
 *  store per site, and the choice was this device's (`nib:web-data`). The choice is gone,
 *  and the logins in those stores must not go with it. So once, before the first page
 *  of the run is built, each store a space kept is merged into the shared one by the
 *  crate (`web_merge`, src-tauri/src/web_state/merge.rs): its cookies one by one, and the
 *  storage of each origin the space's history names, where the shared store holds none
 *  for it. The space's history is folded into the shared history. Nothing is deleted:
 *  the old stores stay on disk as they were.
 *
 *  Marked done only once every store has been merged, so a launch that could not - the
 *  window closed half way - tries again at the next. On nib's own Chromium, which keeps
 *  each store as a profile the merge cannot reach, it is marked done at once: there a
 *  space's logins stay in its profile, as docs/web-tabs.md says. */

import { forget, isRecord, keep, stored, storedText } from '../stored'
import { invoke, isDesktop } from '../tauri'
import { hostOf, isWebData, siteOf, storeName, type WebData } from './web-data'
import { HISTORY } from './web-data.svelte'
import { bounded, type Visit } from './visits'

/** Where the choices were kept, and what the account was told of them. */
const OLD = 'nib:web-data'
const OLD_UP = 'nib:web-data-up'

/** That the merge is done on this computer, and when. */
export const MERGED = 'nib:web-data-merged'

/** One store to merge: its name, and the origins whose storage goes with it. */
interface Merge {
  from: string
  origins: string[]
}

/** The choices this device had made, the spaces kept apart only. */
export function oldChoices(saved: unknown): Record<string, Exclude<WebData, 'global'>> {
  if (!isRecord(saved)) return {}
  const out: Record<string, Exclude<WebData, 'global'>> = {}
  for (const [space, choice] of Object.entries(saved)) {
    if (isWebData(choice) && choice !== 'global') out[space] = choice
  }
  return out
}

/** The history a space kept apart had of its own. */
export function oldHistory(space: string): string {
  return `${HISTORY}:${space}`
}

/** The origin of a web address, or null. */
function originOf(url: string): string | null {
  try {
    const at = new URL(url)
    return at.protocol === 'https:' || at.protocol === 'http:' ? at.origin : null
  } catch {
    return null
  }
}

/** Every store the spaces kept, and the origins each one's storage is read for: a space's
 *  own store with every origin its history went to, and for a space kept per site a store
 *  per site with that site's origins. Pure: `historyOf` and `registrable` are handed in. */
export function planned(
  choices: Record<string, Exclude<WebData, 'global'>>,
  historyOf: (space: string) => readonly Visit[],
  registrable: (host: string) => string | null,
): Merge[] {
  const out: Merge[] = []
  for (const [space, choice] of Object.entries(choices)) {
    const origins = [
      ...new Set(
        historyOf(space)
          .map((one) => originOf(one.url))
          .filter((one) => one !== null),
      ),
    ]
    if (choice === 'space') {
      const from = storeName('space', space, null)
      if (from) out.push({ from, origins })
      continue
    }
    const bySite = new Map<string, string[]>()
    for (const origin of origins) {
      const host = hostOf(origin)
      if (!host) continue
      const site = siteOf(host, registrable)
      bySite.set(site, [...(bySite.get(site) ?? []), origin])
    }
    for (const [site, theirs] of bySite) {
      const from = storeName('site', space, site)
      if (from) out.push({ from, origins: theirs })
    }
  }
  return out
}

/** Two histories as one: a page in both is one row, its visits and typings added up, as
 *  recent as its later side and called what that side last called it, and no longer
 *  than a history may be. What a space's own history became when web data
 *  stopped being kept per space (#239); see `mergeOld`. */
export function folded(into: readonly Visit[], from: readonly Visit[]): readonly Visit[] {
  const rows = new Map(into.map((one) => [one.url, one]))
  for (const one of from) {
    const was = rows.get(one.url)
    rows.set(
      one.url,
      was
        ? {
            url: one.url,
            title: (one.last > was.last ? one.title : was.title) || one.title || was.title,
            visits: was.visits + one.visits,
            typed: was.typed + one.typed,
            last: Math.max(was.last, one.last),
          }
        : one,
    )
  }
  return bounded([...rows.values()])
}

/** What the crate says on an engine the merge cannot reach. */
const NOT_HERE = 'cannot be carried on this engine'

/** Merges every store the spaces kept, once; see the top of this file. */
export async function mergeOld(): Promise<void> {
  if (!isDesktop || storedText(MERGED) !== null) return

  const choices = oldChoices(stored(OLD))
  const spaces = Object.keys(choices)
  if (spaces.length === 0) {
    keep(MERGED, new Date().toISOString())
    return
  }

  const [{ visited }, { getDomain }] = await Promise.all([import('./visited'), import('tldts')])
  const plan = planned(
    choices,
    (space) => visited.all(oldHistory(space)),
    (host) => getDomain(host, { allowPrivateDomains: true }),
  )

  let whole = true
  for (const one of plan) {
    try {
      await invoke('web_merge', { from: one.from, origins: one.origins })
    } catch (error) {
      if (!String(error).includes(NOT_HERE)) whole = false
      console.warn(`nib: ${one.from} could not be merged into the shared web data`, error)
    }
  }
  if (!whole) return

  for (const space of spaces) {
    const from = oldHistory(space)
    visited.fold(from, HISTORY, folded(visited.all(HISTORY), visited.all(from)))
  }
  forget(OLD)
  forget(OLD_UP)
  keep(MERGED, new Date().toISOString())
}
