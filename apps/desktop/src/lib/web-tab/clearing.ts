/** Delete browsing data: what goes, from where, and the going.
 *
 *  Chrome's dialog (Ctrl+Shift+Delete), in its own words and with its own choices: a time
 *  range - the last fifteen minutes to all time - and three kinds, Browsing history,
 *  Cookies and other site data, Cached images and files. A space whose web data is kept
 *  apart (web-data.ts) adds one more, as a browser with profiles has: this space's data,
 *  or every space's.
 *
 *  The history is this device's and goes here: its rows over the range, the marks kept
 *  for them, and the place each note on one of those pages was left at (visited.ts,
 *  place.ts). The rest is the engine's, cleared by its own call in the crate, store by
 *  store; see src-tauri/src/web_clear.rs. A private tab's store is in memory and goes
 *  with its last tab, so nothing here reaches it. Fetched with the dialog. */

import { invoke } from '../tauri'
import { placesForgotten } from './place'
import { visited } from './visited'
import { webData } from './web-data.svelte'

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
  /** Every space's data rather than this space's. */
  everywhere: boolean
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

/** The stores and histories a clearing reaches: this space's, or every space's as well
 *  as the one they share. A space kept per site has a store for each site it has been
 *  to, which its history names. */
export async function reach(
  space: string | null,
  spaces: readonly string[],
  everywhere: boolean,
): Promise<{ stores: (string | null)[]; books: string[] }> {
  const asked = everywhere ? [null, ...spaces] : [space]
  const stores = new Set<string | null>()
  const books = new Set<string>()
  for (const one of asked) {
    const book = webData.history(one)
    books.add(book)
    stores.add(await webData.store(one, null))
    if (webData.of(one) === 'site') {
      for (const visit of visited.all(book)) stores.add(await webData.store(one, visit.url))
    }
  }
  return { stores: [...stores], books: [...books] }
}

/** Whether any of `spaces` keeps its web data apart, which is when the dialog asks
 *  whose data goes. */
export function keptApart(spaces: readonly string[]): boolean {
  return spaces.some((one) => webData.of(one) !== 'global')
}

/** Deletes what was asked, for the tab's `space` and the window's `spaces`. The engine
 *  first, while the history still says which sites the range visited - nib's own
 *  Chromium clears site by site - and the history after. */
export async function clearData(
  asked: Asked,
  space: string | null,
  spaces: readonly string[],
  now = Date.now(),
): Promise<void> {
  const since = sinceFor(asked.range, now)
  const { stores, books } = await reach(space, spaces, asked.everywhere)

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
