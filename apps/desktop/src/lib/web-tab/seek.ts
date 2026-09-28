/** Finding words in a web tab's page, from the bar under the web bar or from the page's
 *  own keys.
 *
 *  The engine marks and counts, and the tally comes back on the page's state; see
 *  web_find.rs and heard.ts. Ctrl+F is the page's first, as in Chrome: a site with a find
 *  of its own keeps the key, and one without asks for this one, which the crate says to
 *  the window as one of three words for the tab it came from (see web_opens.rs). The
 *  words are read here, so nothing a page says reaches anything but its own tab's find. */

import { isRecord } from '../stored'
import { invoke } from '../tauri'
import type { Page } from './pages.svelte'

/** What a page's keys asked of the find: to open it, or a step through its matches. */
export type Sought = 'open' | 'next' | 'previous'

/** A page's ask, as the crate says it. */
export interface Asked {
  tab: string
  look: Sought
}

const SOUGHT: readonly Sought[] = ['open', 'next', 'previous']

export function readAsked(value: unknown): Asked | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const look = SOUGHT.find((one) => one === value.look)
  return look ? { tab: value.tab, look } : null
}

/** Looks for words in the page: a new word from the top, or the next or the one before.
 *  No word at all lets go of the last one's marks. */
export function seek(tab: string, page: Page, query: string, look: 'fresh' | 'next' | 'previous') {
  page.find.query = query
  if (!query) {
    page.find.count = 0
    page.find.at = -1
    void invoke('web_find_stop', { tab }).catch(() => undefined)
    return
  }
  void invoke('web_find', { tab, term: query, look }).catch(() => undefined)
}

/** Closes the bar, and the page is the page again. */
export function shut(tab: string, page: Page) {
  page.find.open = false
  void invoke('web_find_stop', { tab }).catch(() => undefined)
}

/** Ctrl+F opens the bar; Ctrl+G and F3 step, or open it when it is shut, as in Chrome.
 *  The tab's own keys and the page's asks both come through here. */
export function sought(tab: string, page: Page, look: Sought) {
  if (look === 'open' || !page.find.open) {
    page.find.open = true
    return
  }
  seek(tab, page, page.find.query, look)
}
