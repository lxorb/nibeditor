/** Delete browsing data: what goes, from where, and the going.
 *
 *  Chrome's dialog (Ctrl+Shift+Delete), in its own words and with its own choices: a time
 *  range - the last fifteen minutes to all time - and three kinds, Browsing history,
 *  Cookies and other site data, Cached images and files - over the store every page
 *  shares and the own stores of the web notes kept apart that are open (#239).
 *
 *  The history is this device's and goes here: its rows over the range, the marks kept
 *  for them, and the place each note on one of those pages was left at (visited.ts,
 *  place.ts). The rest is the engine's, cleared by its own call in the crate, store by
 *  store; see src-tauri/src/web_clear.rs. A private tab's store is in memory and goes
 *  with its last tab, so nothing here reaches it. Fetched with the dialog. */

import { invoke } from '../tauri'
import { placesForgotten } from './place'
import { visited } from './visited'
import { ownStore, webData } from './web-data.svelte'

/** Chrome's time ranges, newest first, as how far back each reaches; all time is null. */
const RANGES = {
  quarter: 15 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 28 * 24 * 60 * 60_000,
  all: null,
} as const

export type Range = keyof typeof RANGES

/** Chrome's own default: the last hour. */
export const DEFAULT_RANGE: Range = 'hour'

/** What the dialog asks for. */
export interface Asked {
  range: Range
  history: boolean
  site: boolean
  cache: boolean
}

/** When a range starts, in milliseconds since 1970, or nought for all time. */
export function sinceFor(range: Range, now: number): number {
  const back = RANGES[range]
  return back === null ? 0 : now - back
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

/** The stores and the history a clearing reaches: the store every page shares, and the
 *  own store of each web note in `apart` that keeps its web data apart, which is every
 *  open one - Firefox clears each container too. A note kept apart that is not open keeps
 *  its own until it is. */
export function reach(apart: readonly (string | null)[]): {
  stores: (string | null)[]
  books: string[]
} {
  const own = apart.map((one) => ownStore(one)).filter((one) => one !== null)
  return { stores: [null, ...new Set(own)], books: [webData.history()] }
}

/** Deletes what was asked, from the shared store and the stores of the web notes kept
 *  apart in `apart`. The engine first, while the history still says which sites the
 *  range visited - nib's own Chromium clears site by site - and the history after. */
export async function clearData(
  asked: Asked,
  apart: readonly (string | null)[],
  now = Date.now(),
): Promise<void> {
  const since = sinceFor(asked.range, now)
  const { stores, books } = reach(apart)

  if (asked.site || asked.cache) {
    const sites = new Set<string>()
    for (const book of books) {
      for (const visit of visited.all(book)) {
        const origin = visit.last >= since ? originOf(visit.url) : null
        if (origin) sites.add(origin)
      }
    }
    await invoke('web_clear', {
      stores,
      clearing: { since, site: asked.site, cache: asked.cache },
      sites: [...sites],
    })
  }

  if (asked.history) {
    const gone = new Set(books.flatMap((book) => visited.removeSince(book, since)))
    placesForgotten(since <= 0 ? null : gone)
  }
}
