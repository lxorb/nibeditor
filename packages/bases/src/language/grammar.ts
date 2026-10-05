/** What one language says, as a table quick add reads (docs/tasks.md 5.6).
 *
 *  Words, not code: a third language is a third file of these rows, and the reader
 *  (when.ts, repeat.ts, parse.ts) never names a word of any language itself. Every
 *  word is written lower case and without the dot an abbreviation may carry; a
 *  phrase of several words is an array of them.
 *
 *  Weekdays and months are numbered the way dates.ts numbers them: 0 for Sunday to
 *  6 for Saturday, 1 for January to 12 for December. */

/** A unit a span of time is counted in. */
export type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface Grammar {
  /** `en`, `de`. */
  lang: string

  /** Days by their names. */
  today: readonly string[]
  tomorrow: readonly string[]
  /** The day after tomorrow, as one word or as a phrase. */
  dayAfter: readonly (readonly string[])[]
  yesterday: readonly string[]

  /** Weekdays by every name they are written with. */
  weekdays: Readonly<Record<string, number>>
  /** Names that are also ordinary words (`sun`, `sat`, `Do`, `So`): a day only after one
   *  of `context`, or where the whole phrase is already a date (`{Fr}`, `!Mo 9`). */
  shortDays: ReadonlySet<string>
  /** Words after which a short day name is a day. */
  context: ReadonlySet<string>

  months: Readonly<Record<string, number>>

  /** `next` before a weekday, `nächste Woche`, `nächsten Monat`. */
  next: ReadonlySet<string>
  /** `this` before a weekday: the coming one, today counted. */
  coming: ReadonlySet<string>
  /** The words for a week, a month and a year after `next`. */
  week: ReadonlySet<string>
  month: ReadonlySet<string>
  year: ReadonlySet<string>
  /** The last day of this month. */
  endOfMonth: readonly (readonly string[])[]
  /** The coming Saturday. */
  weekend: readonly (readonly string[])[]

  /** `in` before a span: `in 3 days`. */
  within: ReadonlySet<string>
  /** Units by every word they are written with, plural and short forms included. */
  units: Readonly<Record<string, Unit>>
  /** Small numbers written as words: `a`, `one`, `zwei`. */
  numbers: Readonly<Record<string, number>>

  /** Words a date stands behind and that go with it: `on`, `am`, `by`. */
  dayWords: ReadonlySet<string>
  /** Words a time stands behind: `at`, `um`. */
  timeWords: ReadonlySet<string>
  /** `pm` and `am`; empty where the clock is read in 24 hours only. */
  meridiem: Readonly<Record<string, 'am' | 'pm'>>
  /** A word after the hour that says it is one: `Uhr`. */
  oclock: ReadonlySet<string>
  /** Times of day by name: `noon`, `mittags`. */
  times: Readonly<Record<string, string>>
  /** A day and a time in one phrase: `tonight`, `heute Abend`, `morgen früh`. The
   *  first word names the day the way `today` and `tomorrow` do. */
  dayTimes: readonly { words: readonly string[]; day: 'today' | 'tomorrow'; time: string }[]
  /** Parts of the day as a time: after `every` (`every morning`) and after a day word
   *  (`am Abend`), where the German one would otherwise be read as tomorrow. */
  partsOfDay: Readonly<Record<string, string>>

  /** Repeating. */
  every: ReadonlySet<string>
  /** `every!`, `jeden!`: counted from the day it is done. */
  everyDone: ReadonlySet<string>
  /** `other`, `zweite`: every second. */
  other: ReadonlySet<string>
  /** `last`, `letzten`. */
  last: ReadonlySet<string>
  /** One word that is a whole rule: `daily`, `werktags`, `montags`. */
  rules: Readonly<Record<string, string>>
  /** `starting`, `ab`: the rule's first day. */
  starting: ReadonlySet<string>
  /** `until`, `bis`: its last. */
  until: ReadonlySet<string>
  /** The weekdays as a unit of their own: `weekday`, `Werktag`. */
  workdays: ReadonlySet<string>
  /** `weekend` as a unit of a rule. */
  weekends: ReadonlySet<string>

  /** `for` before a duration; `für`. */
  lasting: ReadonlySet<string>
  /** Whether a duration may stand without `for`: German writes `1,5 Std` alone. */
  bareDuration: boolean

  /** An ordinal written with figures: `6th`, `6.`. */
  ordinal: RegExp
  /** Ordinals written out, `first`, `ersten`, the ones a rule counts with. */
  ordinals: Readonly<Record<string, number>>
  /** Words between a day word and a day of the month: `on the 15th`, `bis zum 5.`. */
  articles: ReadonlySet<string>
  /** `6/10` read day first, or month first (`en-US`). */
  monthFirst: boolean
}
