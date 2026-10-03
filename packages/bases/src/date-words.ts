/** Dates in words, as Bases expressions: `today`, `tomorrow`, `friday`, `next
 *  mon`, `in 3 days`, `-365 days`, `+4 hours`, `oct 6`, `6. Oktober`, `6/10`,
 *  `2026-10-06`, in English and German. What Todoist's filters and the Tasks
 *  plugin's queries both say about a day; quick add's own grammar is the
 *  language tables (lane 3), which read far more.
 *
 *  Relative words stay relative (`today() + "1d"`), so a saved filter is right on
 *  every day it is read. */

import { civil, isoOf } from './dates'

export interface DateWordOptions {
  /** The app's language; `en-US` reads `6/10` as June 10, every other one as 6 October. */
  lang?: string
  /** `YYYY-MM-DD`, for the year of a date written without one. */
  today?: string
}

const quote = (text: string) => JSON.stringify(text)

const DAYS: Record<string, number> = {
  monday: 1,
  mon: 1,
  montag: 1,
  mo: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  dienstag: 2,
  di: 2,
  wednesday: 3,
  wed: 3,
  mittwoch: 3,
  mi: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  donnerstag: 4,
  do: 4,
  friday: 5,
  fri: 5,
  freitag: 5,
  fr: 5,
  saturday: 6,
  sat: 6,
  samstag: 6,
  sa: 6,
  sunday: 7,
  sun: 7,
  sonntag: 7,
  so: 7,
}

const MONTHS: Record<string, number> = {}
;[
  ['january', 'jan', 'januar', 'jän'],
  ['february', 'feb', 'februar'],
  ['march', 'mar', 'märz', 'mär', 'maerz'],
  ['april', 'apr'],
  ['may', 'mai'],
  ['june', 'jun', 'juni'],
  ['july', 'jul', 'juli'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct', 'oktober', 'okt'],
  ['november', 'nov'],
  ['december', 'dec', 'dezember', 'dez'],
].forEach((names, at) => names.forEach((name) => (MONTHS[name] = at + 1)))

const TODAY = new Set(['today', 'tod', 'heute'])
const TOMORROW = new Set(['tomorrow', 'tmr', 'tom', 'morgen'])
const YESTERDAY = new Set(['yesterday', 'gestern'])

/** The next day of the week with this ISO number (1 Monday to 7 Sunday), today
 *  counted when `fromToday`. */
export function weekdayFrom(day: number, fromToday: boolean): string {
  const ahead = `(${day} - number(today().format("E")) + 7) % 7`
  return fromToday
    ? `today() + duration((${ahead}) + "d")`
    : `today() + duration(((${ahead}) || 7) + "d")`
}

/** A span written `4 hours`, `3 days`, `2 weeks`: Bases' duration words. */
function spanOf(count: string, unit: string): { text: string; clock: boolean } | null {
  const word = unit.toLowerCase()
  if (/^(hours?|hrs?|h|stunden?|std)$/.test(word)) return { text: `${count}h`, clock: true }
  if (/^(minutes?|mins?|m|minuten?)$/.test(word)) return { text: `${count}m`, clock: true }
  if (/^(days?|d|tage?n?)$/.test(word)) return { text: `${count}d`, clock: false }
  if (/^(weeks?|w|wochen?)$/.test(word)) return { text: `${count}w`, clock: false }
  if (/^(months?|monate?n?)$/.test(word)) return { text: `${count}M`, clock: false }
  if (/^(years?|jahre?n?)$/.test(word)) return { text: `${count}y`, clock: false }
  return null
}

/** A date in Todoist's words as a Bases expression for that date; `clock` when it
 *  is a moment rather than a day. */
export function dateWords(
  words: string,
  options: DateWordOptions,
): { expression: string; clock: boolean } | null {
  const text = words.trim().toLowerCase().replace(/\s+/g, ' ')
  if (TODAY.has(text)) return { expression: 'today()', clock: false }
  if (TOMORROW.has(text)) return { expression: 'today() + "1d"', clock: false }
  if (YESTERDAY.has(text)) return { expression: 'today() - "1d"', clock: false }
  if (text === 'now' || text === 'jetzt') return { expression: 'now()', clock: true }
  if (civil(text)) return { expression: `date(${quote(text)})`, clock: false }

  const relative = /^(?:in )?([+-]?)(\d+) ([a-zäö]+)(?: ago| her)?$/.exec(text)
  if (relative) {
    const span = spanOf(relative[2] ?? '0', relative[3] ?? '')
    if (span) {
      const back = relative[1] === '-' || / (ago|her)$/.test(text)
      return {
        expression: `${span.clock ? 'now()' : 'today()'} ${back ? '-' : '+'} "${span.text}"`,
        clock: span.clock,
      }
    }
  }

  const next = /^(?:next|nächsten?|naechsten?) ([a-zäö]+)$/.exec(text)
  const nextDay = next ? DAYS[next[1] ?? ''] : undefined
  if (nextDay !== undefined) return { expression: weekdayFrom(nextDay, false), clock: false }
  const day = DAYS[text]
  if (day !== undefined) return { expression: weekdayFrom(day, true), clock: false }

  const year = Number((options.today ?? new Date().toISOString()).slice(0, 4))
  const named =
    /^(?:([a-zäö]+)\.? (\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th|\.)? ([a-zäö]+)\.?)(?:,? (\d{4}))?$/.exec(
      text,
    )
  if (named) {
    const month = MONTHS[named[1] ?? named[4] ?? '']
    const dayOf = Number(named[2] ?? named[3])
    const iso = month ? isoOf(named[5] ? Number(named[5]) : year, month, dayOf) : ''
    if (civil(iso)) return { expression: `date(${quote(iso)})`, clock: false }
  }

  const numeric = /^(\d{1,2})[./](\d{1,2})\.?(?:[./](\d{2,4}))?$/.exec(text)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    const [dayOf, month] = options.lang === 'en-US' ? [second, first] : [first, second]
    const written = numeric[3] ? Number(numeric[3]) : year
    const iso = isoOf(written < 100 ? 2000 + written : written, month, dayOf)
    if (civil(iso)) return { expression: `date(${quote(iso)})`, clock: false }
  }
  return null
}
