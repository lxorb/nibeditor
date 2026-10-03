/** The search engine this device's address field sends words to: Settings' one row.
 *
 *  Google until somebody chooses otherwise (Emil's call; see address.ts), one of Chrome's
 *  list for the reader's region, or a custom address with `%s` where the words go. This
 *  device's, like Memory saver beside it: Chrome keeps it with the profile, and nib's
 *  profile is the machine's. What the list is and what a choice makes of the words is
 *  engines.ts. */

import { isRecord, isString, keep, stored } from '../stored'
import { SEARCH } from './address'
import { engineById, isEngineAddress } from './engines'

const KEY = 'nib:search-engine'

/** The id a custom engine is chosen under. */
export const CUSTOM = 'custom'

interface Choice {
  /** An engine's id, or `CUSTOM`. */
  id: string
  /** The custom engine's address, kept while another is chosen so going back finds it. */
  custom: string
}

function read(): Choice {
  const kept = stored(KEY)
  if (!isRecord(kept)) return { id: 'google', custom: '' }

  const custom = isString(kept.custom) && isEngineAddress(kept.custom) ? kept.custom.trim() : ''
  const id = isString(kept.id) ? kept.id : 'google'
  if (id === CUSTOM) return custom ? { id, custom } : { id: 'google', custom }
  return { id: engineById(id) ? id : 'google', custom }
}

class SearchEngine {
  private choice = $state<Choice>(read())

  /** The chosen engine's id, or `CUSTOM`. */
  get id(): string {
    return this.choice.id
  }

  /** The custom address as it was last written, chosen or not. */
  get custom(): string {
    return this.choice.custom
  }

  /** Where the words go now, `%s` where they go. */
  get url(): string {
    if (this.choice.id === CUSTOM) return this.choice.custom || SEARCH
    return engineById(this.choice.id)?.url ?? SEARCH
  }

  /** One of the list, or `CUSTOM` once a custom address is written. */
  choose(id: string) {
    if (id === CUSTOM ? !this.choice.custom : !engineById(id)) return
    this.write({ ...this.choice, id })
  }

  /** A custom engine's address, chosen as it is written. False for one that cannot take a
   *  search, which leaves the choice as it was. */
  setCustom(url: string): boolean {
    if (!isEngineAddress(url)) return false
    this.write({ id: CUSTOM, custom: url.trim() })
    return true
  }

  private write(next: Choice) {
    this.choice = next
    keep(KEY, JSON.stringify(next))
  }
}

export const searchEngine = new SearchEngine()
