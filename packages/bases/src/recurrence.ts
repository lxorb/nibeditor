/** The rule a task repeats by, in the Tasks plugin's words, and the dates it gives.
 *
 *  The Tasks plugin hands its rules to the rrule library's English reader, so the
 *  grammar is that one: `every 3 days`, `every weekday`, `every week on Tuesday,
 *  Friday`, `every 2 weeks`, `every month on the last Friday`, `every month on the
 *  2nd last Friday`, `every January on the 15th`, `every April and December on the
 *  1st and 24th`, `every year`, `until`, `for 3 times`, and the plugin's own
 *  `when done`. Todoist's words that mean the same are read too (`every other
 *  week`, `every workday`, `every weekend`, `every mon, fri`, `every year on 3
 *  March`), and a rule is always written back in the plugin's.
 *
 *  Dates follow rrule as the plugin uses it: the rule's period is counted from the
 *  task's own date (its reference: due, else scheduled, else start), and `every
 *  month` or `every year` with no day named keeps the reference's day, the last
 *  of a shorter month standing in for a day it does not have (the plugin's own
 *  correction; `every month on the 31st` still skips the short months, as the
 *  plugin's documentation warns). */

import {
  addDays,
  civil,
  dayNumber,
  daysInMonth,
  fromDayNumber,
  isoOf,
  monthName,
  weekday,
  weekdayName,
} from './dates'

export interface Rule {
  every: number
  unit: 'day' | 'week' | 'month' | 'year'
  /** 0 for Sunday to 6 for Saturday; `nth` counts within the month, -1 the last. */
  weekdays: { day: number; nth?: number }[]
  /** Days of the month, -1 the last, -2 the one before it. */
  monthDays: number[]
  /** 1 to 12. */
  months: number[]
  /** From the day it was done rather than from its date: Todoist's `every!`. */
  whenDone: boolean
  until?: string
  count?: number
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const MONTH_NAMES: Record<string, number> = {}
for (let month = 1; month <= 12; month++) {
  const name = monthName(month).toLowerCase()
  MONTH_NAMES[name] = month
  MONTH_NAMES[name.slice(0, 3)] = month
}
MONTH_NAMES.sept = 9

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  other: 2,
}

/** `1st`, `2nd`, `3`, `twenty`... as a number, or null. */
function ordinal(word: string): number | null {
  const found = /^(\d+)(?:st|nd|rd|th)?$/.exec(word)
  if (found) return Number(found[1])
  const named = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(word)
  return named === -1 ? null : named + 1
}

/** A date after `until`: `2026-12-24`, `December 24, 2026`, `24 December 2026`. */
function readUntil(words: string): string | null {
  const text = words.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (civil(text)) return text
  const parts = text.split(' ')
  let year: number | null = null
  let month: number | null = null
  let day: number | null = null
  for (const part of parts) {
    const asMonth = MONTH_NAMES[part]
    if (asMonth !== undefined) month = asMonth
    else if (/^\d{4}$/.test(part)) year = Number(part)
    else if (ordinal(part) !== null) day = ordinal(part)
  }
  if (year === null || month === null || day === null || day > daysInMonth(year, month)) return null
  return isoOf(year, month, day)
}

/** A rule's words as a rule, or null for words that are not one. */
export function parseRule(written: string): Rule | null {
  let text = written.trim().toLowerCase().replace(/\s+/g, ' ')
  const rule: Rule = {
    every: 1,
    unit: 'day',
    weekdays: [],
    monthDays: [],
    months: [],
    whenDone: false,
  }

  if (text.endsWith(' when done')) {
    rule.whenDone = true
    text = text.slice(0, -' when done'.length)
  }
  if (text.startsWith('every!')) {
    rule.whenDone = true
    text = `every ${text.slice('every!'.length)}`
  }

  const count = / for (\d+) times?$/.exec(text)
  if (count) {
    rule.count = Number(count[1])
    text = text.slice(0, count.index)
  }
  const until = / until (.+)$/.exec(text)
  if (until) {
    const date = readUntil(until[1] ?? '')
    if (!date) return null
    rule.until = date
    text = text.slice(0, until.index)
  }

  const words = text.replace(/,/g, ' , ').split(' ').filter(Boolean)
  if (words.shift() !== 'every') return null

  let at = 0
  const peek = () => words[at] ?? ''
  const take = () => words[at++] ?? ''

  const amount = WORDS[peek()] ?? (/^\d+$/.test(peek()) ? Number(peek()) : null)
  if (amount !== null) {
    rule.every = amount
    at++
  }
  if (rule.every < 1) return null

  const unit = take()
  switch (unit.replace(/s$/, '')) {
    case 'day':
      rule.unit = 'day'
      break
    case 'week':
      rule.unit = 'week'
      break
    case 'month':
      rule.unit = 'month'
      break
    case 'year':
      rule.unit = 'year'
      break
    case 'weekday':
    case 'workday':
      rule.unit = 'week'
      rule.weekdays = [1, 2, 3, 4, 5].map((day) => ({ day }))
      break
    case 'weekend':
      rule.unit = 'week'
      rule.weekdays = [6, 0].map((day) => ({ day }))
      break
    default: {
      at--
      if (DAY_NAMES[peek()] !== undefined) {
        rule.unit = 'week'
        rule.weekdays = readWeekdays()
      } else if (MONTH_NAMES[peek()] !== undefined) {
        rule.unit = 'year'
        rule.months = readMonths()
      } else {
        return null
      }
    }
  }

  function readWeekdays(): { day: number; nth?: number }[] {
    const out: { day: number; nth?: number }[] = []
    while (at < words.length) {
      const day = DAY_NAMES[peek().replace(/s$/, '')] ?? DAY_NAMES[peek()]
      if (day === undefined) break
      out.push({ day })
      at++
      if (peek() === ',' || peek() === 'and') at++
    }
    return out
  }

  function readMonths(): number[] {
    const out: number[] = []
    while (MONTH_NAMES[peek()] !== undefined) {
      out.push(MONTH_NAMES[take()] ?? 1)
      if (peek() === ',' || peek() === 'and') at++
    }
    return out
  }

  if (peek() === 'on') {
    at++
    if (peek() === 'the') {
      at++
      if (!readOnThe()) return null
    } else if (DAY_NAMES[peek()] !== undefined) {
      rule.weekdays = readWeekdays()
    } else if (ordinal(peek()) !== null && MONTH_NAMES[words[at + 1] ?? ''] !== undefined) {
      // Todoist's `every year on 3 March`.
      rule.monthDays = [ordinal(take()) ?? 1]
      rule.months = [MONTH_NAMES[take()] ?? 1]
    } else if (MONTH_NAMES[peek()] !== undefined && ordinal(words[at + 1] ?? '') !== null) {
      rule.months = [MONTH_NAMES[take()] ?? 1]
      rule.monthDays = [ordinal(take()) ?? 1]
    } else {
      return null
    }
  }

  /** `the 1st and 24th`, `the last`, `the 2nd last`, `the last Friday`, `the 2nd
   *  Wednesday`, `the 2nd last Friday`. */
  function readOnThe(): boolean {
    if (at >= words.length) return false
    while (at < words.length) {
      let nth = ordinal(peek())
      if (nth !== null) at++
      if (peek() === 'last') {
        at++
        nth = -(nth ?? 1)
      }
      if (nth === null) return false
      const day = DAY_NAMES[peek()]
      if (day !== undefined) {
        at++
        rule.weekdays.push({ day, nth })
      } else {
        rule.monthDays.push(nth)
      }
      if (peek() === ',' || peek() === 'and') {
        at++
        if (peek() === 'the') at++
        continue
      }
      break
    }
    return true
  }

  if (at < words.length) return null
  return rule
}

/** `1st`, `22nd`, `the last`, `2nd last`. */
function nthText(nth: number): string {
  if (nth === -1) return 'last'
  if (nth < 0) return `${nthText(-nth)} last`
  const tens = nth % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][nth % 10] ?? 'th')
  return `${nth}${suffix}`
}

const sameDays = (a: readonly { day: number; nth?: number }[], days: readonly number[]) =>
  a.length === days.length && a.every((one) => one.nth === undefined && days.includes(one.day))

/** Weekdays in the order a week runs, Monday first. */
const mondayFirst = (day: number) => (day + 6) % 7

function joined(parts: readonly string[], last = ' and '): string {
  return parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')}${last}${parts.at(-1) ?? ''}`
}

/** A date for an `until`, the way the plugin reads one: `December 24, 2026`. Its
 *  own grammar has no `-`, so an ISO date would end its reading of the line. */
function untilText(iso: string): string {
  const parts = civil(iso)
  return parts ? `${monthName(parts.month)} ${parts.day}, ${parts.year}` : iso
}

/** A rule in the plugin's own words. */
export function ruleText(rule: Rule): string {
  const plural = (unit: string) =>
    rule.every === 1 ? `every ${unit}` : `every ${rule.every} ${unit}s`
  let text: string

  const onDays = () => {
    const parts = [
      ...rule.monthDays.map((day) => nthText(day)),
      ...rule.weekdays.map(
        (one) => `${one.nth === undefined ? '' : `${nthText(one.nth)} `}${weekdayName(one.day)}`,
      ),
    ]
    return parts.length ? ` on the ${joined(parts)}` : ''
  }

  if (rule.unit === 'week' && rule.every === 1 && sameDays(rule.weekdays, [1, 2, 3, 4, 5])) {
    text = 'every weekday'
  } else if (rule.unit === 'week') {
    const days = [...rule.weekdays].sort((a, b) => mondayFirst(a.day) - mondayFirst(b.day))
    text =
      plural('week') +
      (days.length ? ` on ${days.map((one) => weekdayName(one.day)).join(', ')}` : '')
  } else if (rule.unit === 'year' && rule.months.length) {
    const months = joined(rule.months.map(monthName))
    text =
      (rule.every === 1 ? `every ${months}` : `every ${rule.every} years in ${months}`) + onDays()
  } else {
    text = plural(rule.unit) + onDays()
  }

  if (rule.until) text += ` until ${untilText(rule.until)}`
  if (rule.count !== undefined) text += ` for ${rule.count} times`
  if (rule.whenDone) text += ' when done'
  return text
}

/** The days of one month the rule names, in order. `fallback` is the reference's
 *  day, kept where the rule names none. */
function daysIn(
  rule: Rule,
  year: number,
  month: number,
  fallback: number,
  clamp: boolean,
): number[] {
  const length = daysInMonth(year, month)
  const days = new Set<number>()

  for (const day of rule.monthDays) {
    const actual = day < 0 ? length + day + 1 : day
    if (actual >= 1 && actual <= length) days.add(actual)
  }
  for (const { day, nth } of rule.weekdays) {
    const first = weekday(isoOf(year, month, 1))
    const firstOf = 1 + ((day - first + 7) % 7)
    const all: number[] = []
    for (let one = firstOf; one <= length; one += 7) all.push(one)
    if (nth === undefined) all.forEach((one) => days.add(one))
    else {
      const picked = nth > 0 ? all[nth - 1] : all[all.length + nth]
      if (picked !== undefined) days.add(picked)
    }
  }
  if (!rule.monthDays.length && !rule.weekdays.length) {
    if (fallback <= length) days.add(fallback)
    else if (clamp) days.add(length)
  }
  return [...days].sort((a, b) => a - b)
}

/** The rule's periods, the n-th from the reference's: every candidate date in it. */
function candidates(rule: Rule, start: string, period: number): string[] {
  const parts = civil(start)
  if (!parts) return []
  const step = period * rule.every

  switch (rule.unit) {
    case 'day': {
      const date = addDays(start, step)
      return !rule.weekdays.length || rule.weekdays.some((one) => one.day === weekday(date))
        ? [date]
        : []
    }
    case 'week': {
      const monday = dayNumber(start) - mondayFirst(weekday(start)) + step * 7
      const days = rule.weekdays.length ? rule.weekdays.map((one) => one.day) : [weekday(start)]
      return [...new Set(days.map(mondayFirst))]
        .sort((a, b) => a - b)
        .map((offset) => fromDayNumber(monday + offset))
    }
    case 'month': {
      const index = parts.year * 12 + parts.month - 1 + step
      const year = Math.floor(index / 12)
      const month = index - year * 12 + 1
      return daysIn(rule, year, month, parts.day, true).map((day) => isoOf(year, month, day))
    }
    case 'year': {
      const year = parts.year + step
      const months = rule.months.length ? [...rule.months].sort((a, b) => a - b) : [parts.month]
      const clamp = !rule.months.length && !rule.monthDays.length && !rule.weekdays.length
      return months.flatMap((month) =>
        daysIn(rule, year, month, parts.day, clamp).map((day) => isoOf(year, month, day)),
      )
    }
  }
}

/** How many of the rule's periods lie between two dates, roughly, so the search
 *  for the next date starts near it rather than at the reference. */
function periodsBetween(rule: Rule, from: string, to: string): number {
  const days = dayNumber(to) - dayNumber(from)
  const size = { day: 1, week: 7, month: 28, year: 365 }[rule.unit] * rule.every
  return Math.max(0, Math.floor(days / size) - 1)
}

/** The longest search before a rule is taken to name no date at all (`every
 *  February on the 30th`). */
const MOST_PERIODS = 2000

/** The rule's first date after `after`, counting its periods from `start`; null
 *  when there is none, or none before its `until`. */
export function nextDate(rule: Rule, start: string, after: string): string | null {
  const first = after < start ? 0 : periodsBetween(rule, start, after)
  for (let period = first; period < first + MOST_PERIODS; period++) {
    for (const date of candidates(rule, start, period)) {
      if (date < start || date <= after) continue
      if (rule.until && date > rule.until) return null
      return date
    }
  }
  return null
}
