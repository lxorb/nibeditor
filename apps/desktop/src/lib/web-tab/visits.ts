/** The pages this device has opened in a web tab: what the address field finishes
 *  a word from.
 *
 *  Emil, 2026-09-27: *"if I already opened moodle-app2.let.ethz.ch then it should
 *  kinda of complete in the same way it does it for other browser"*. A browser's
 *  omnibox is its history read backwards, so this is the history - one row per
 *  address, with the four facts Chrome ranks a row by: how often it was visited, how
 *  often somebody typed their way to it, when it was last open, and what it called
 *  itself.
 *
 *  Pure. The rows arrive and leave as values, so a test can hold the whole of what a
 *  visit does to the list; the store that keeps them is visited.ts, and what is made
 *  of them for somebody typing is omnibox.ts.
 *
 *  Bounded, the way everything this device keeps is bounded: the five hundred most
 *  recently open, and the rest forgotten oldest first. That is more sites than anybody
 *  goes back to, and small enough that reading every row on every keystroke costs
 *  nothing anybody could measure. */

import { isNumber, isRecord, isString } from '../stored'
import { isWebAddress } from './address'

/** How many addresses are kept. */
export const MOST_VISITS = 500

/** An address longer than this is a page's state rather than a place - a search with
 *  a query string the length of a paragraph - and nobody types their way back to it. */
const LONGEST_ADDRESS = 2048

/** A title is a row's second half, and a row is one line. */
const LONGEST_TITLE = 200

/** One address somebody has been to. */
export interface Visit {
  url: string
  /** What the page called itself the last time it said, or the empty string. */
  title: string
  /** How many times a tab arrived here. */
  visits: number
  /** How many of those began in the address field - the one fact Chrome weighs above
   *  all the others, because an address somebody typed is one they will type again. */
  typed: number
  /** When it was last open, in milliseconds. */
  last: number
}

/** The address a row is kept under: the page without its fragment, because `#intro`
 *  and `#usage` are one page scrolled to two places. Null for an address a web tab
 *  would not open and for one too long to be worth a row. */
export function visitKey(url: string): string | null {
  if (url.length > LONGEST_ADDRESS || !isWebAddress(url)) return null

  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

function readVisit(value: unknown): Visit | null {
  if (!isRecord(value)) return null

  const { url, title, visits, typed, last } = value
  if (!isString(url) || !isNumber(visits) || !isNumber(typed) || !isNumber(last)) return null

  const key = visitKey(url)
  if (key === null) return null

  return { url: key, title: isString(title) ? title : '', visits, typed, last }
}

/** What an earlier run wrote down, row by row: one unreadable row says nothing about
 *  the others. Bounded again on the way in, so a list written by a build that kept
 *  more is still one this build can read in no time. */
export function visitsFrom(value: unknown): Visit[] {
  if (!Array.isArray(value)) return []

  return bounded(value.map(readVisit).filter((one) => one !== null))
}

/** The list, with the least recently open over the bound gone. */
function bounded(list: Visit[]): Visit[] {
  if (list.length <= MOST_VISITS) return list

  return [...list].sort((one, other) => other.last - one.last).slice(0, MOST_VISITS)
}

/** The list with one row changed, or added where it had none. */
function touched(
  list: readonly Visit[],
  url: string,
  change: (was: Visit) => Visit,
): readonly Visit[] {
  const key = visitKey(url)
  if (key === null) return list

  const at = list.findIndex((one) => one.url === key)
  if (at >= 0) return list.map((one, index) => (index === at ? change(one) : one))

  return bounded([...list, change({ url: key, title: '', visits: 0, typed: 0, last: 0 })])
}

function titled(title: string, was: string): string {
  const said = title.trim().slice(0, LONGEST_TITLE)
  return said || was
}

/** A tab arrived at `url`. */
export function visited(
  list: readonly Visit[],
  url: string,
  title: string,
  now: number,
): readonly Visit[] {
  return touched(list, url, (was) => ({
    ...was,
    title: titled(title, was.title),
    visits: was.visits + 1,
    last: now,
  }))
}

/** The page at `url` has said what it is called. Not a visit: the engine reports a
 *  page's title after it reports the page. */
export function named(list: readonly Visit[], url: string, title: string): readonly Visit[] {
  const said = titled(title, '')
  const key = visitKey(url)
  if (!said || key === null || !list.some((one) => one.url === key && one.title !== said)) {
    return list
  }

  return touched(list, url, (was) => ({ ...was, title: said }))
}

/** Somebody typed their way to `url`. The visit itself is counted when the page
 *  arrives, which a redirect may make a different address. */
export function typedTo(list: readonly Visit[], url: string, now: number): readonly Visit[] {
  return touched(list, url, (was) => ({ ...was, typed: was.typed + 1, last: now }))
}

/** The list without `url`: Shift+Delete on a row, which is how Chrome takes one
 *  suggestion out of its history. */
export function unvisited(list: readonly Visit[], url: string): readonly Visit[] {
  const key = visitKey(url)
  return list.filter((one) => one.url !== key)
}
