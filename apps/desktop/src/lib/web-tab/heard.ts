/** What the engine says about a page beside where it is, landed on the tab's state.
 *
 *  Four things, each of them something a browser shows without being asked: the page is
 *  playing sound, or is muted; something in it holds the whole screen; it was zoomed
 *  inside the page; and how many matches a find found and which one is lit. The crate
 *  says them (see web_page.rs and web_find.rs); this reads them, because an event is a
 *  boundary like any other, and puts them where the tab strip, the bar and the find bar
 *  read them. And what the page asks: its find or its address field, when its own keys
 *  for them went by it; see passed.svelte.ts.
 *
 *  Two of them are also where a site's own memory is kept honest. A site somebody muted
 *  is muted in whichever tab it starts playing in, and a site that is not is heard again
 *  in a tab that was muted for the last one; and a zoom, however it was made, is the
 *  size that site opens at next time. See sites.ts. Fetched with the first page, like
 *  the rest of what the pages' listeners need. */

import type { listen as Listen } from '@tauri-apps/api/event'
import { isRecord } from '../stored'
import { mute } from './mute'
import type { Page } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { answer, readAsk } from './passed.svelte'
import { isMuted, keepZoom } from './sites'

/** What the crate said about one tab's page. */
export type Said = { tab: string } & (
  | { said: 'sound'; playing: boolean; muted: boolean }
  | { said: 'fill'; on: boolean }
  | { said: 'zoom'; factor: number }
)

/** How many matches a find has and which is lit, from nought, or -1 for none. */
export interface Found {
  tab: string
  count: number
  at: number
}

export function readSaid(value: unknown): Said | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const { tab, said } = value
  if (said === 'sound') {
    return { tab, said, playing: value.playing === true, muted: value.muted === true }
  }
  if (said === 'fill') return { tab, said, on: value.on === true }
  if (said === 'zoom' && typeof value.factor === 'number' && value.factor > 0) {
    return { tab, said, factor: value.factor }
  }
  return null
}

export function readFound(value: unknown): Found | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const { tab, count, at } = value
  if (typeof count !== 'number' || typeof at !== 'number') return null
  return { tab, count: Math.max(0, count), at: count > 0 && at >= 0 ? at : -1 }
}

export function heard(page: Page, said: Said): void {
  switch (said.said) {
    case 'sound': {
      page.playing = said.playing
      page.muted = said.muted
      // A page in a tab keeps whatever it was told last, and a tab carries on to other
      // sites: so the site it is on now decides, the moment there is sound to decide
      // about.
      const quiet = isMuted(siteOf(page.url))
      if (said.playing && said.muted !== quiet) mute(said.tab, page, quiet)
      return
    }
    case 'fill':
      page.filling = said.on
      return
    case 'zoom':
      page.zoom = said.factor
      keepZoom(siteOf(page.url), said.factor)
      return
  }
}

export function found(page: Page, said: Found): void {
  page.find.count = said.count
  page.find.at = said.at
}

/** The three events, heard for every page in the window: `page` is the tab's state, or
 *  nothing for a tab that has gone. Started with the first page; see `listen` in
 *  pages.svelte.ts. */
export async function listening(
  listen: typeof Listen,
  page: (tab: string) => Page | undefined,
): Promise<void> {
  await listen('nib://web-page', (event) => {
    const said = readSaid(event.payload)
    const one = said && page(said.tab)
    if (one) heard(one, said)
  })
  await listen('nib://web-found', (event) => {
    const said = readFound(event.payload)
    const one = said && page(said.tab)
    if (one) found(one, said)
  })
  // The page's own keys for find and the address field that nothing in it took; see
  // passed.svelte.ts.
  await listen('nib://web-passed', (event) => {
    const ask = readAsk(event.payload)
    const one = ask && page(ask.tab)
    if (one) answer(ask.tab, one, ask.key)
  })
}
