/** Which of the three each space keeps its website data in, on this device.
 *
 *  This device's rather than the account's, beside the other things a device keeps for
 *  itself: the stores are folders on this machine, and a space kept apart here says
 *  nothing about how another machine's cookies are kept. Keyed by the space's id, which
 *  a rename keeps - the store is named after the same id, see web-data.ts.
 *
 *  A space that has never been asked is **global**, which is what every space was
 *  before there was a choice, so nobody's logins move because the setting exists. And
 *  changing it loses nothing: a store nobody is using any more stays on disk, and
 *  choosing it again is choosing the logins that are in it. */

import { isRecord, keep, stored } from '../stored'
import { historyKey, hostOf, isWebData, siteOf, storeName, type WebData } from './web-data'

const STORAGE_KEY = 'nib:web-data'

function read(): Record<string, WebData> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, WebData> = {}
  for (const [space, choice] of Object.entries(saved)) {
    if (isWebData(choice) && choice !== 'global') out[space] = choice
  }

  return out
}

class WebDataChoices {
  private kept = $state<Record<string, WebData>>(read())

  of(space: string | null): WebData {
    return (space === null ? undefined : this.kept[space]) ?? 'global'
  }

  set(space: string, choice: WebData) {
    if (this.of(space) === choice) return

    // Global is what nothing says, so choosing it takes the space off the list.
    const next = Object.fromEntries(Object.entries(this.kept).filter(([one]) => one !== space))
    if (choice !== 'global') next[space] = choice

    this.kept = next
    keep(STORAGE_KEY, JSON.stringify(next))
  }

  /** The address field's history for a space; see `historyKey`. */
  history(space: string | null): string {
    return historyKey(this.of(space), space)
  }

  /** The store a page at `url` in `space` goes in, or null for the shared one.
   *
   *  The public suffix list is fetched only here and only for a space kept per site:
   *  it is a hundred kilobytes that nobody else needs, and never in front of the first
   *  paint. See `siteOf` in web-data.ts for what a site is. */
  async store(space: string | null, url: string | null): Promise<string | null> {
    const choice = this.of(space)
    if (!space || choice === 'global') return null

    const host = hostOf(url)
    if (choice === 'space' || !host) return storeName(choice, space, null)

    const { getDomain } = await import('tldts')
    const site = siteOf(host, (one) => getDomain(one, { allowPrivateDomains: true }))
    return storeName(choice, space, site)
  }
}

export const webData = new WebDataChoices()
