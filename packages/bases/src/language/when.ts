/** A day, a time, or both, as somebody types them: `tomorrow 4pm`, `next fri`, `in 3
 *  days`, `oct 6`, `6/10`, `heute Abend`, `morgen um 9`, `16 Uhr`.
 *
 *  Read off one language's table (grammar.ts) at a time, starting at one word and
 *  taking as many as make one phrase. Days are counted on the floating clock of
 *  dates.ts: a date is a day wherever the reader is, and `now` is only asked for its
 *  wall clock. */

import { addDays, addMonths, civil, isoOf, todayOf, weekday } from '../dates'
import type { Grammar, Unit } from './grammar'
import { bare, longestAt, type Word } from './words'

/** Today on the reader's wall clock. */
export interface Clock {
  today: string
  /** Minutes since midnight. */
  minutes: number
}

export function clockOf(now: Date): Clock {
  return {
    today: todayOf(now),
    minutes: now.getHours() * 60 + now.getMinutes(),
  }
}

/** What a phrase said, and the word after it. */
export interface When {
  end: number
  day?: string
  time?: string
  /** Whether a bare hour was taken for the afternoon's: `at 4` as 16:00. */
  guessed?: boolean
}

const pad = (value: number) => String(value).padStart(2, '0')
const timeOf = (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}`

/** The next date that is this weekday, today counted when `fromToday`. */
function weekdayFrom(today: string, day: number, fromToday: boolean): string {
  const ahead = (day - weekday(today) + 7) % 7
  return addDays(today, ahead === 0 && !fromToday ? 7 : ahead)
}

/** A date written without its year: this year's, or next year's where this year's has
 *  gone by, the way Todoist reads `oct 6` in November. */
function comingDate(today: string, month: number, day: number, year?: number): string | null {
  const thisYear = Number(today.slice(0, 4))
  const iso = isoOf(year ?? thisYear, month, day)
  if (!civil(iso)) {
    // The 29th of February, in a year without one: the next year that has it.
    if (year !== undefined || month !== 2 || day !== 29) return null
    for (let next = thisYear + 1; next < thisYear + 8; next++) {
      if (civil(isoOf(next, 2, 29))) return isoOf(next, 2, 29)
    }
    return null
  }
  if (year === undefined && iso < today) return comingDate(today, month, day, thisYear + 1)
  return iso
}

/** A year written with two figures or four. */
const yearOf = (text: string): number | undefined => {
  if (!/^\d{2}(?:\d{2})?$/.test(text)) return undefined
  const year = Number(text)
  return year < 100 ? 2000 + year : year
}

/** A year after a month's name, which only four figures can be: `oct 6 16 Uhr` is a
 *  time, not 2016. */
const fullYear = (word: Word | undefined): number | undefined =>
  /^\d{4}$/.test(word?.key ?? '') ? Number(word?.key) : undefined

/** A count: figures, or one of the table's number words. */
function countOf(word: Word | undefined, g: Grammar): number | null {
  const key = bare(word)
  if (/^\d{1,3}$/.test(key)) return Number(key)
  return g.numbers[key] ?? null
}

/** A day of the month: `6`, `6th`, `6.`. */
function dayOfMonth(word: Word | undefined, g: Grammar): number | null {
  const key = word?.key ?? ''
  const written = g.ordinal.exec(key)?.[1] ?? (/^\d{1,2}$/.test(key) ? key : null)
  const day = written === null ? NaN : Number(written)
  return day >= 1 && day <= 31 ? day : null
}

/** A span added to today: `3 days`, `2 weeks`. */
function after(today: string, count: number, unit: Unit): string {
  switch (unit) {
    case 'day':
      return addDays(today, count)
    case 'week':
      return addDays(today, count * 7)
    case 'month':
      return addMonths(today, count)
    case 'year':
      return addMonths(today, count * 12)
    case 'minute':
    case 'hour':
      return today
  }
}

/** Whether a short day name standing at `at` reads as a day: after a word that says
 *  a day is coming, or where the whole phrase is already known to be a date. */
function dayHere(words: readonly Word[], at: number, g: Grammar, free: boolean): boolean {
  const name = bare(words[at])
  if (!g.shortDays.has(name)) return true
  return free || g.context.has(bare(words[at - 1]))
}

/** A day standing at `at`, without a time. */
export function dayAt(
  words: readonly Word[],
  at: number,
  g: Grammar,
  clock: Clock,
  free = false,
): When | null {
  const { today } = clock
  const key = bare(words[at])
  if (key === '') return null

  if (g.today.includes(key)) return { end: at + 1, day: today }
  if (g.tomorrow.includes(key)) return { end: at + 1, day: addDays(today, 1) }
  if (g.yesterday.includes(key)) return { end: at + 1, day: addDays(today, -1) }

  const dayAfter = longestAt(words, at, g.dayAfter)
  if (dayAfter) return { end: at + dayAfter, day: addDays(today, 2) }

  const monthEnd = longestAt(words, at, g.endOfMonth)
  if (monthEnd)
    return { end: at + monthEnd, day: addDays(addMonths(today.slice(0, 8) + '01', 1), -1) }

  const weekend = longestAt(words, at, g.weekend)
  if (weekend) {
    const now = weekday(today)
    return { end: at + weekend, day: now === 6 || now === 0 ? today : weekdayFrom(today, 6, true) }
  }

  if (g.next.has(key) || g.coming.has(key)) {
    const next = bare(words[at + 1])
    const day = g.weekdays[next]
    if (day !== undefined) return { end: at + 2, day: weekdayFrom(today, day, g.coming.has(key)) }
    if (g.next.has(key) && g.week.has(next))
      return { end: at + 2, day: weekdayFrom(today, 1, false) }
    if (g.next.has(key) && g.weekends.has(next)) {
      // The Saturday after this weekend's; on a Sunday this one is over already.
      const coming = weekdayFrom(today, 6, true)
      return { end: at + 2, day: weekday(today) === 0 ? coming : addDays(coming, 7) }
    }
    if (g.next.has(key) && g.month.has(next)) {
      return { end: at + 2, day: addMonths(`${today.slice(0, 8)}01`, 1) }
    }
    if (g.next.has(key) && g.year.has(next)) {
      return { end: at + 2, day: `${Number(today.slice(0, 4)) + 1}-01-01` }
    }
    return null
  }

  const day = g.weekdays[key]
  if (day !== undefined && dayHere(words, at, g, free)) {
    // `wednesday next week`: that day of the week starting next Monday.
    if (g.next.has(bare(words[at + 1])) && g.week.has(bare(words[at + 2]))) {
      return { end: at + 3, day: addDays(weekdayFrom(today, 1, false), (day + 6) % 7) }
    }
    return { end: at + 1, day: weekdayFrom(today, day, true) }
  }

  if (g.within.has(key)) {
    const count = countOf(words[at + 1], g)
    const unit = g.units[bare(words[at + 2])]
    if (count !== null && unit && unit !== 'minute' && unit !== 'hour') {
      return { end: at + 3, day: after(today, count, unit) }
    }
    return null
  }

  return writtenDate(words, at, g, today)
}

/** A date written out: `2026-10-06`, `6/10`, `6.10.`, `oct 6`, `6th of october`, `6.
 *  Okt 2027`. */
function writtenDate(words: readonly Word[], at: number, g: Grammar, today: string): When | null {
  const key = words[at]?.key ?? ''

  if (civil(key)) return { end: at + 1, day: key }

  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(key)
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(key)
  const numeric = slashed ?? dotted
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    const [day, month] = slashed && g.monthFirst ? [second, first] : [first, second]
    const date = comingDate(today, month, day, yearOf(numeric[3] ?? ''))
    return date ? { end: at + 1, day: date } : null
  }

  // `oct 6`, `october 6th`, `oct 6, 2027`.
  const monthFirst = g.months[bare(words[at])]
  if (monthFirst !== undefined) {
    const day = dayOfMonth(words[at + 1], g)
    if (day === null) return null
    const year = fullYear(words[at + 2])
    const date = comingDate(today, monthFirst, day, year)
    return date ? { end: at + (year ? 3 : 2), day: date } : null
  }

  // `6 oct`, `6th of october`, `6. Okt`, `6. Oktober 2027`.
  const day = dayOfMonth(words[at], g)
  if (day === null) return null
  const of = bare(words[at + 1]) === 'of' ? 1 : 0
  const month = g.months[bare(words[at + 1 + of])]
  if (month === undefined) return null
  const yearAt = at + 2 + of
  const year = fullYear(words[yearAt])
  const date = comingDate(today, month, day, year)
  return date ? { end: year ? yearAt + 1 : yearAt, day: date } : null
}

/** A time of day standing at `at`. `asked` is whether `at` or `um` stood before it,
 *  which is what lets a bare hour be one. */
export function timeAt(
  words: readonly Word[],
  at: number,
  g: Grammar,
  asked: boolean,
): When | null {
  const word = words[at]
  const key = word?.key ?? ''
  if (key === '') return null

  const named = g.times[bare(word)]
  if (named) return { end: at + 1, time: named }

  // `4pm`, `4:30pm`, `4.30pm`, and `4` `pm` as two words.
  const glued = /^(\d{1,2})(?:[:.](\d{2}))?(a\.?m\.?|p\.?m\.?)$/.exec(key)
  const clock = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(key)
  const next = bare(words[at + 1])
  const half = glued?.[3]?.replace(/\./g, '').replace(/^(a|p)m$/, '$1m')
  const meridiem = half ? g.meridiem[half] : (g.meridiem[next] ?? g.meridiem[`${next}.`])
  const hoursText = glued?.[1] ?? clock?.[1]
  if (hoursText === undefined) return null
  if (glued && Object.keys(g.meridiem).length === 0) return null

  const hours = Number(hoursText)
  const minutes = Number(glued?.[2] ?? clock?.[2] ?? '0')
  if (minutes > 59) return null
  const end = at + 1 + (!glued && meridiem ? 1 : 0)

  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    const base = hours % 12
    return { end, time: timeOf(meridiem === 'pm' ? base + 12 : base, minutes) }
  }

  const oclock = g.oclock.has(next)
  const colon = key.includes(':')
  if (hours > 23) return null
  // `16.30` and `16` are times only after `um` or `at`, or with `Uhr`; `16:30` always is.
  if (key.includes('.') && !oclock && !asked) return null
  if (!colon && !oclock && !asked) return null

  // `at 4` is four in the afternoon: a task at four in the morning is the rarer one,
  // and whoever means it writes `4am` or `04:00`.
  // Minutes written out, `7.05`, are a timetable's: the hour as written.
  const afternoon =
    !colon &&
    !oclock &&
    !key.includes('.') &&
    hours >= 1 &&
    hours <= 7 &&
    !hoursText.startsWith('0')
  const time = timeOf(afternoon ? hours + 12 : hours, minutes)
  return afternoon ? { end, time, guessed: true } : { end: oclock ? end + 1 : end, time }
}

/** A span from now: `in 2 hours`, `in 30 min`. Answers the day it lands on too. */
function fromNow(words: readonly Word[], at: number, g: Grammar, clock: Clock): When | null {
  if (!g.within.has(bare(words[at]))) return null
  const count = countOf(words[at + 1], g)
  const unit = g.units[bare(words[at + 2])]
  if (count === null || (unit !== 'minute' && unit !== 'hour')) return null
  const total = clock.minutes + count * (unit === 'hour' ? 60 : 1)
  const days = Math.floor(total / 1440)
  const rest = total % 1440
  return {
    end: at + 3,
    day: addDays(clock.today, days),
    time: timeOf(Math.floor(rest / 60), rest % 60),
  }
}

/** A day and a time named together: `tonight`, `heute Abend`, `morgen früh`. */
function dayTimeAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): When | null {
  let best: When | null = null
  for (const one of g.dayTimes) {
    if (best && best.end - at >= one.words.length) continue
    if (!one.words.every((word, index) => bare(words[at + index]) === word)) continue
    best = {
      end: at + one.words.length,
      day: one.day === 'today' ? clock.today : addDays(clock.today, 1),
      time: one.time,
    }
  }
  return best
}

/** A time said after a part of the day, in that half of the day: `tonight at 8` is
 *  eight in the evening, `tomorrow morning at 7` seven in the morning. */
export function timeInPart(
  words: readonly Word[],
  at: number,
  g: Grammar,
  part: string,
): When | null {
  const said = askedTime(words, at, g)
  if (!said?.time) return null
  const hours = Number(said.time.slice(0, 2))
  const minutes = Number(said.time.slice(3))
  const evening = Number(part.slice(0, 2)) >= 12
  if (evening && hours < 12) return { end: said.end, time: timeOf(hours + 12, minutes) }
  if (!evening && said.guessed) return { end: said.end, time: timeOf(hours - 12, minutes) }
  return { end: said.end, time: said.time }
}

/** A time, `at` or `um` in front of it included. */
function askedTime(words: readonly Word[], at: number, g: Grammar): When | null {
  if (g.timeWords.has(bare(words[at]))) return timeAt(words, at + 1, g, true)
  const part = g.dayWords.has(bare(words[at])) ? g.partsOfDay[bare(words[at + 1])] : undefined
  if (part) return { end: at + 2, time: part }
  return timeAt(words, at, g, false)
}

/** A day, `on` or `am` in front of it included. */
function askedDay(
  words: readonly Word[],
  at: number,
  g: Grammar,
  clock: Clock,
  free: boolean,
): When | null {
  if (g.dayWords.has(bare(words[at]))) {
    // `am Abend` is the evening, which askedTime reads, and never tomorrow's.
    if (g.partsOfDay[bare(words[at + 1])]) return null
    const day = dayAt(words, at + 1, g, clock, true) ?? monthDayAt(words, at + 1, g, clock.today)
    if (day) return day
  }
  return dayAt(words, at, g, clock, free)
}

/** A day of the month alone, after a day word: `on the 15th`, `am 15.`. This month's,
 *  or the next month that has it once this month's has gone by. */
function monthDayAt(words: readonly Word[], at: number, g: Grammar, today: string): When | null {
  const from = g.articles.has(bare(words[at])) ? at + 1 : at
  const written = g.ordinal.exec(words[from]?.key ?? '')?.[1]
  const day = Number(written)
  if (written === undefined || day < 1 || day > 31) return null
  for (let ahead = 0; ahead < 12; ahead++) {
    const month = addMonths(`${today.slice(0, 8)}01`, ahead)
    const iso = isoOf(Number(month.slice(0, 4)), Number(month.slice(5, 7)), day)
    if (civil(iso) && iso >= today) return { end: from + 1, day: iso }
  }
  return null
}

/** The longest phrase of a day and a time standing at `at`, in either order, the
 *  words that join them taken with them. `free` reads a short day name as a day
 *  wherever it stands: the phrase is already known to be a date. */
export function whenAt(
  words: readonly Word[],
  at: number,
  g: Grammar,
  clock: Clock,
  free = false,
): When | null {
  const soon = fromNow(words, at, g, clock)
  if (soon) return soon

  const both = dayTimeAt(words, at, g, clock)
  if (both) {
    // `tonight at 8`: the time said is the time meant, in the part of the day named.
    const later = timeInPart(words, both.end, g, both.time ?? '')
    return later ? { ...both, end: later.end, time: later.time ?? '' } : both
  }

  const day = askedDay(words, at, g, clock, free)
  if (day) {
    const time = askedTime(words, day.end, g)
    return time ? { end: time.end, day: day.day ?? '', time: time.time ?? '' } : day
  }

  const time = askedTime(words, at, g)
  if (!time) return null
  const later = askedDay(words, time.end, g, clock, free)
  return later ? { end: later.end, day: later.day ?? '', time: time.time ?? '' } : time
}
