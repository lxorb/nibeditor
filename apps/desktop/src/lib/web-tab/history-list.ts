/** What the History page lists: every page of the tab's history, newest first, under the
 *  day it was last open, narrowed by what is typed in its search field.
 *
 *  Chrome's shape (chrome://history): one list, day headings, a time against each row,
 *  and one search field over the titles and the addresses. A page is one row at the
 *  last time it was open, because the history behind it is one row per page (see
 *  visits.ts) - which is what a reader looking for "that page from Tuesday" wants
 *  anyway, and what Chrome's own list gives once it folds a day's repeats.
 *
 *  Pure, and the rows are flat so a list of thousands can be drawn a screenful at a
 *  time: every row the same height, a heading the same as a row, and which of them are
 *  on screen is arithmetic. See WebHistory.svelte. */

import type { Visit } from './visits'

/** One line of the list: a day's heading, or a page. */
export type HistoryRow =
  { kind: 'day'; key: string; day: number } | { kind: 'visit'; key: string; visit: Visit }

/** Midnight before `time`, on this computer's clock. */
export function dayOf(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The host a page is on, without `www.`, the way the list shows it beside the title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** Whether a page answers what was typed: every word somewhere in its title or its
 *  address, any case, as Chrome's history search reads it. */
export function answers(visit: Visit, typed: string): boolean {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true

  const said = `${visit.title} ${visit.url}`.toLowerCase()
  return words.every((word) => said.includes(word))
}

/** The rows for `list` narrowed by `typed`, newest first, a heading before each day. */
export function historyRows(list: readonly Visit[], typed: string): HistoryRow[] {
  const found = list
    .filter((one) => answers(one, typed))
    .sort((one, other) => other.last - one.last)

  const rows: HistoryRow[] = []
  let day = Number.NaN
  for (const visit of found) {
    const its = dayOf(visit.last)
    if (its !== day) {
      day = its
      rows.push({ kind: 'day', key: `day:${String(its)}`, day: its })
    }
    rows.push({ kind: 'visit', key: visit.url, visit })
  }
  return rows
}

/** What a day's heading says: Today, Yesterday, or the date as the reader's language
 *  writes it - with the weekday, as Chrome's do. `words` are the first two, translated. */
export function dayName(
  day: number,
  now: number,
  locale: string,
  words: { today: string; yesterday: string },
): string {
  const today = dayOf(now)
  if (day === today) return words.today
  if (day === dayOf(today - 1)) return words.yesterday

  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: new Date(day).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  }).format(day)
}

/** Which rows are on screen: from the first one the scroll has reached to the last one
 *  the height shows, and a few either side so a fast wheel never shows a gap. */
export function onScreen(
  scrolled: number,
  height: number,
  rowHeight: number,
  count: number,
  spare = 8,
): { from: number; to: number } {
  const from = Math.max(0, Math.floor(scrolled / rowHeight) - spare)
  const to = Math.min(count, Math.ceil((scrolled + height) / rowHeight) + spare)
  return { from, to: Math.max(from, to) }
}
