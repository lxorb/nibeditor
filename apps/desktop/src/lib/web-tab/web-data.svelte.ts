/** Which of the three each space keeps its website data in.
 *
 *  This device's choice, kept beside the other things a device keeps for itself, until
 *  web logins travel: then it is the space's on the account (`spaces.web_store`), so
 *  every computer puts a space's pages in the same store and the same logins follow it
 *  (docs/sync-v2.md section 6.1, open question 3). The device's own stays as what a
 *  space the account does not have, or a device signed out, goes by. Keyed by the space's
 *  id, which a rename keeps - the store is named after the same id, see web-data.ts.
 *
 *  A space that has never been asked is **global**, which is what every space was
 *  before there was a choice, so nobody's logins move because the setting exists. And
 *  changing it loses nothing: a store nobody is using any more stays on disk, and
 *  choosing it again is choosing the logins that are in it. */

import { isRecord, keep, stored, stringList } from '../stored'
import { historyKey, hostOf, isWebData, siteOf, storeName, type WebData } from './web-data'

const STORAGE_KEY = 'nib:web-data'

/** The spaces whose choice on this device has gone up to the account already, so it
 *  goes up once and the account's is what counts after that. */
const MOVED_UP = 'nib:web-data-up'

function read(): Record<string, WebData> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, WebData> = {}
  for (const [space, choice] of Object.entries(saved)) {
    if (isWebData(choice) && choice !== 'global') out[space] = choice
  }

  return out
}

/** A space as the account lists it, as much of it as the choice needs. */
export interface AccountSpace {
  id: string
  role: string
  webStore?: unknown
}

/** Writes a space's choice to the account. */
export type WriteUp = (space: string, choice: WebData) => Promise<void>

class WebDataChoices {
  private kept = $state<Record<string, WebData>>(read())
  /** The account's choice per space, while web logins travel; null otherwise. */
  private held = $state<Record<string, WebData> | null>(null)
  /** Which spaces this account may change the choice of: the ones it owns. */
  private owned = new Set<string>()
  private writeUp: WriteUp | null = null

  of(space: string | null): WebData {
    if (space === null) return 'global'
    return this.held?.[space] ?? this.kept[space] ?? 'global'
  }

  set(space: string, choice: WebData) {
    if (this.of(space) === choice) return

    // The account's, where it has the space: written there, and shown at once.
    if (this.held && space in this.held) {
      this.held = { ...this.held, [space]: choice }
      if (this.owned.has(space)) void this.writeUp?.(space, choice).catch(() => undefined)
      return
    }

    // Global is what nothing says, so choosing it takes the space off the list.
    const next = Object.fromEntries(Object.entries(this.kept).filter(([one]) => one !== space))
    if (choice !== 'global') next[space] = choice

    this.kept = next
    keep(STORAGE_KEY, JSON.stringify(next))
  }

  /** The account's spaces, whenever they are listed, while web logins travel: their
   *  choices become the ones that count, and a choice this device made for a space the
   *  account still keeps on Global goes up, once. Answers the spaces whose store
   *  changed, whose open pages are built again in it. It reads what it writes, so an
   *  effect calls it untracked; see web-sync.svelte.ts. */
  follow(spaces: readonly AccountSpace[], writeUp: WriteUp): string[] {
    this.writeUp = writeUp
    this.owned = new Set(spaces.filter((one) => one.role === 'owner').map((one) => one.id))

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away
    const moved = new Set(stringList(stored(MOVED_UP)) ?? [])
    const next: Record<string, WebData> = {}
    for (const space of spaces) {
      const said = isWebData(space.webStore) ? space.webStore : 'global'
      const mine = this.kept[space.id]
      if (said === 'global' && mine && !moved.has(space.id) && this.owned.has(space.id)) {
        next[space.id] = mine
        void writeUp(space.id, mine).catch(() => undefined)
      } else {
        next[space.id] = said
      }
      moved.add(space.id)
    }
    keep(MOVED_UP, JSON.stringify([...moved]))

    const changed = spaces
      .map((space) => space.id)
      .filter((id) => (next[id] ?? 'global') !== this.of(id))
    this.held = next
    return changed
  }

  /** Web logins no longer travel: each device's own choice again. */
  unfollow() {
    this.held = null
    this.writeUp = null
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
