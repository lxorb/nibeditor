/** A web tab saved into another space: its page belongs to that space now, and so to
 *  its web data, the way a `.url` file's page always belongs to the space holding the
 *  file. Where that is another store than the one the page was built in, it is built
 *  again there, where it was and on the page it was on - Arc's answer for a tab moved
 *  into a space with another profile; Chrome cannot move a tab between profiles at all
 *  - and `rehomed` names the space under the bar for a moment, because a site that
 *  signs out without a word looks like a site that broke. A page not running is built
 *  in the right store when it is next looked at, and needs saying nothing.
 *
 *  The store is asked the one way every page and every web login asks it (`store` in
 *  web-data.svelte.ts), so a lease and a page never disagree about where a site is.
 *  Fetched with the first save that needs it. */

import { pages } from './pages.svelte'
import { webData } from './web-data.svelte'

/** How long the line stays: long enough to read a short sentence. */
const SAID_FOR = 4000

export async function rehome(tabId: string, space: string | null, name: string): Promise<void> {
  const page = pages.of(tabId)
  const was = page.space
  page.space = space
  const url = page.url
  if (!page.live || url === null || was === space) return

  const [from, to] = await Promise.all([webData.store(was, url), webData.store(space, url)])
  if (from === to) return

  const shown = page.shown ? page.pane : null
  await pages.park(tabId)
  if (shown) await pages.show(tabId, url, shown)

  page.rehomed = name
  setTimeout(() => {
    if (page.rehomed === name) page.rehomed = null
  }, SAID_FOR)
}
