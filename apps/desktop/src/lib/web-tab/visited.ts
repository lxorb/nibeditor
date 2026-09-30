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
import { forget } from './favicons'
import { completion, suggested, type Completion } from './omnibox'
import { named, typedTo, unvisited, visitKey, visited as arrived, visitsFrom } from './visits'
import type { Visit } from './visits'

/** A history is kept under a storage key of its own, which is its whole name: the one
 *  every space shares, or a space's own where the space keeps its web data apart. The
 *  caller says which, from `webData.history`; see web-data.ts. */
type Book = string

class Visited {
  /** The rows of each history read so far, each read the first time anything asks. */
  private readonly books = new Map<Book, readonly Visit[]>()

  /** Where each tab was last counted as being, so the engine saying the same page
   *  again - its title arrived, its mark arrived - is not another visit. */
  private readonly counted = new Map<string, string>()

  /** The rows, read the first time anything asks. */
  private rows(book: Book): readonly Visit[] {
    let list = this.books.get(book)
    if (!list) {
      list = visitsFrom(stored(book))
      this.books.set(book, list)
    }
    return list
  }

  /** Written as it changes, which is at most twice a page: the engine reports a page
   *  three times as it lands - the page, its title, its mark - and only the first two
   *  change a row. See `named` in visits.ts. */
  private write(book: Book, next: readonly Visit[]) {
    if (next === this.books.get(book)) return

    this.books.set(book, next)
    keep(book, JSON.stringify(next))
  }

  /** Reads the list now, because somebody is about to type. */
  wake(book: Book) {
    this.rows(book)
  }

  /** A tab is on `url`, and the page calls itself `title` (or has not said yet). A new
   *  address in the tab is a visit; the same one again is the page saying more about
   *  itself. */
  saw(book: Book, tab: string, url: string, title: string) {
    const key = visitKey(url)
    if (key === null) return

    const now = Date.now()
    if (this.counted.get(tab) === key) {
      this.write(book, named(this.rows(book), key, title))
      return
    }

    this.counted.set(tab, key)
    this.write(book, arrived(this.rows(book), key, title, now))
  }

  /** Somebody typed their way to `url`. */
  typed(book: Book, url: string) {
    this.write(book, typedTo(this.rows(book), url, Date.now()))
  }

  /** The tab has closed. */
  left(tab: string) {
    this.counted.delete(tab)
  }

  /** Takes one address out, which is Shift+Delete on a row of the list, and the mark
   *  this device kept for it: a page forgotten is forgotten everywhere it was kept. */
  remove(book: Book, url: string) {
    this.write(book, unvisited(this.rows(book), url))
    forget(url)
  }

  /** What a page called itself the last time a tab was on it, or the empty string:
   *  the words a row of the history under a held arrow reads. */
  titleOf(book: Book, url: string): string {
    const key = visitKey(url)
    return this.rows(book).find((one) => one.url === key)?.title ?? ''
  }

  /** The rest of an address `typed` is the start of; see omnibox.ts. */
  complete(book: Book, typed: string): Completion | null {
    return completion(this.rows(book), typed, Date.now())
  }

  /** The pages worth offering under the field for `typed`. */
  suggest(book: Book, typed: string): Visit[] {
    return suggested(this.rows(book), typed, Date.now())
  }
}

export const visited = new Visited()
