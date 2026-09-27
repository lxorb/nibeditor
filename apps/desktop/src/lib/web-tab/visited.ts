/** This device's history of web pages: written as tabs arrive at them, read by the
 *  address field.
 *
 *  **Nothing is read at launch.** nib opens in under a second, and a list of five
 *  hundred addresses is not something the first frame needs: it is read the first time
 *  an address field takes the keyboard (`wake`), or the first time a tab arrives at a
 *  page, whichever comes first - both of them long after the window is up.
 *
 *  This device's, beside the other things a device keeps for itself (see stored.ts),
 *  and never on the account: where somebody has been is theirs, and a history that
 *  followed them onto every machine they signed in on is not what a browser's history
 *  is. The rows and what is done to them are visits.ts; what is offered from them is
 *  omnibox.ts. */

import { keep, stored } from '../stored'
import { completion, suggested, type Completion } from './omnibox'
import { named, typedTo, unvisited, visitKey, visited as arrived, visitsFrom } from './visits'
import type { Visit } from './visits'

const STORAGE_KEY = 'nib:web-visits'

class Visited {
  private list: readonly Visit[] | null = null

  /** Where each tab was last counted as being, so the engine saying the same page
   *  again - its title arrived, its mark arrived - is not another visit. */
  private readonly counted = new Map<string, string>()

  /** The rows, read the first time anything asks. */
  private get rows(): readonly Visit[] {
    this.list ??= visitsFrom(stored(STORAGE_KEY))
    return this.list
  }

  /** Written as it changes, which is at most twice a page: the engine reports a page
   *  three times as it lands - the page, its title, its mark - and only the first two
   *  change a row. See `named` in visits.ts. */
  private set rows(next: readonly Visit[]) {
    if (next === this.list) return

    this.list = next
    keep(STORAGE_KEY, JSON.stringify(next))
  }

  /** Reads the list now, because somebody is about to type. */
  wake() {
    this.list ??= visitsFrom(stored(STORAGE_KEY))
  }

  /** A tab is on `url`, and the page calls itself `title` (or has not said yet). A new
   *  address in the tab is a visit; the same one again is the page saying more about
   *  itself. */
  saw(tab: string, url: string, title: string) {
    const key = visitKey(url)
    if (key === null) return

    const now = Date.now()
    if (this.counted.get(tab) === key) {
      this.rows = named(this.rows, key, title)
      return
    }

    this.counted.set(tab, key)
    this.rows = arrived(this.rows, key, title, now)
  }

  /** Somebody typed their way to `url`. */
  typed(url: string) {
    this.rows = typedTo(this.rows, url, Date.now())
  }

  /** The tab has closed. */
  left(tab: string) {
    this.counted.delete(tab)
  }

  /** Takes one address out, which is Shift+Delete on a row of the list. */
  remove(url: string) {
    this.rows = unvisited(this.rows, url)
  }

  /** The rest of an address `typed` is the start of; see omnibox.ts. */
  complete(typed: string): Completion | null {
    return completion(this.rows, typed, Date.now())
  }

  /** The pages worth offering under the field for `typed`. */
  suggest(typed: string): Visit[] {
    return suggested(this.rows, typed, Date.now())
  }
}

export const visited = new Visited()
