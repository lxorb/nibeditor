/** A rule as somebody types it: `every day`, `every other week`, `every 2nd monday`,
 *  `every!`, `daily`, `jeden Tag`, `werktags`, `alle 3 Monate`, `jeden 2. Montag`,
 *  `montags`, with `starting` and `until` after it.
 *
 *  Whatever language it was typed in, the answer is a `Rule` (recurrence.ts), which
 *  is written back in the Tasks plugin's English, the words both apps read. English
 *  is handed to that reader whole, after Todoist's own ways of saying a rule the
 *  plugin's grammar does not have are said its way; German is read here. */

import { type Rule, parseRule } from '../recurrence'
import type { Grammar } from './grammar'
import { type Clock, dayAt, timeInPart } from './when'
import { bare, type Word } from './words'

export interface Repeat {
  end: number
  rule: Rule
  /** The day `starting` named: the rule's first. */
  first?: string
  /** The time a part of the day gave it: `every morning`. */
  time?: string
}

/** The longest rule the plugin's reader takes, of at most this many words. */
const MOST_WORDS = 9

const ORDINAL_EN = /^(\d{1,2})(?:st|nd|rd|th)$/
const DAY_EN = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?s?$/
const UNIT_EN = /^(day|week|month|year)$/

/** An ordinal in figures, the way the plugin writes one: `1st`, `3rd`. */
const figures = (count: number): string =>
  `${count}${count % 10 === 1 && count !== 11 ? 'st' : count % 10 === 2 && count !== 12 ? 'nd' : count % 10 === 3 && count !== 13 ? 'rd' : 'th'}`

/** Todoist's words for a rule, in the plugin's: `every 2nd monday` is `every month on
 *  the 2nd monday`, `every last day` is `every month on the last`, `every other monday`
 *  is `every 2 weeks on monday`. */
function pluginWords(words: readonly string[]): string {
  const [every = '', second = '', third = ''] = words
  const rest = words.slice(2).join(' ')
  // `every 2nd week` is every two weeks, not the second of every month.
  if (ORDINAL_EN.test(second) && UNIT_EN.test(third) && words.length === 3) {
    return `${every} ${Number.parseInt(second, 10)} ${third}s`
  }
  if (ORDINAL_EN.test(second) && DAY_EN.test(third) && words.length === 3) {
    return `${every} month on the ${second} ${third}`
  }
  if (ORDINAL_EN.test(second) && words.length === 2) return `${every} month on the ${second}`
  if (second === 'last' && third === 'day' && words.length === 3) {
    return `${every} month on the last`
  }
  if (second === 'last' && DAY_EN.test(third) && words.length === 3) {
    return `${every} month on the last ${third}`
  }
  if (second === 'other' && DAY_EN.test(third)) return `${every} 2 weeks on ${rest}`
  return words.join(' ')
}

/** An English rule standing at `at`, handed to the plugin's reader. */
function englishRule(words: readonly Word[], at: number, g: Grammar): Repeat | null {
  const key = bare(words[at])
  const whole = g.rules[key]
  if (whole) {
    const rule = parseRule(whole)
    return rule ? { end: at + 1, rule } : null
  }
  if (!g.every.has(key) && !g.everyDone.has(key)) return null

  const most = Math.min(words.length - at, MOST_WORDS)
  for (let count = most; count >= 2 || (count === 1 && g.everyDone.has(key)); count--) {
    const said = words.slice(at, at + count).map((word) => bare(word))
    // `each` is `every`, `second` is `other`, which are the words the plugin reads, and
    // `first` is `1st`.
    if (said[0] === 'each') said[0] = 'every'
    if (g.other.has(said[1] ?? '')) said[1] = 'other'
    const nth = g.ordinals[said[1] ?? '']
    if (nth !== undefined) said[1] = figures(nth)
    const rule = parseRule(pluginWords(said))
    if (rule) return { end: at + count, rule }
  }
  return null
}

const emptyRule = (): Rule => ({
  every: 1,
  unit: 'day',
  weekdays: [],
  monthDays: [],
  months: [],
  whenDone: false,
})

/** The weekdays named from `at`, `Montag und Freitag`, `Mo, Fr`: how many words they
 *  took, and the days. */
function daysFrom(words: readonly Word[], at: number, g: Grammar): { end: number; days: number[] } {
  const days: number[] = []
  let index = at
  while (index < words.length) {
    const day = g.weekdays[bare(words[index])]
    if (day === undefined) break
    days.push(day)
    index++
    if (bare(words[index]) === 'und' && g.weekdays[bare(words[index + 1])] !== undefined) index++
  }
  return { end: index, days }
}

/** A German rule standing at `at`. */
function germanRule(words: readonly Word[], at: number, g: Grammar): Repeat | null {
  const key = bare(words[at])
  const whole = g.rules[key]
  if (whole) {
    const rule = parseRule(whole)
    return rule ? { end: at + 1, rule } : null
  }
  const done = g.everyDone.has(words[at]?.key ?? '')
  if (!g.every.has(key) && !done) return null

  const rule = { ...emptyRule(), whenDone: done }
  let index = at + 1
  const word = () => bare(words[index])

  // `alle 3 Monate`, `alle drei Tage`, `jede zweite Woche`, `jede 2. Woche`.
  // Figures with no dot after them: `2.` is the second, not every two.
  const written = g.ordinal.exec(words[index]?.key ?? '')?.[1]
  const nth = written === undefined ? g.ordinals[word()] : Number(written)
  const counted = g.numbers[word()]
  const unitNext = g.units[bare(words[index + 1])]
  if (/^\d{1,3}$/.test(words[index]?.key ?? '')) {
    rule.every = Number(word())
    index++
  } else if (g.other.has(word())) {
    rule.every = 2
    index++
  } else if (
    (counted ?? nth) !== undefined &&
    unitNext &&
    unitNext !== 'minute' &&
    unitNext !== 'hour'
  ) {
    rule.every = counted ?? nth ?? 1
    index++
  }

  // `jeden 2. Montag`, `jeden ersten Montag`, `jeden letzten Freitag`, `jeden 15.`.
  const last = g.last.has(word())
  if ((nth !== undefined || last) && rule.every === 1) {
    index++
    const day = g.weekdays[word()]
    const count = last ? -1 : (nth ?? 1)
    rule.unit = 'month'
    if (day !== undefined) {
      rule.weekdays = [{ day, nth: count }]
      index++
    } else if (last && g.units[word()] === 'day') {
      rule.monthDays = [-1]
      index++
    } else if (!last) {
      rule.monthDays = [count]
    } else {
      return null
    }
    return { end: index, rule }
  }

  const unit = g.units[word()]
  if (g.workdays.has(word())) {
    rule.unit = 'week'
    rule.weekdays = [1, 2, 3, 4, 5].map((day) => ({ day }))
    index++
  } else if (g.weekends.has(word())) {
    rule.unit = 'week'
    rule.weekdays = [6, 0].map((day) => ({ day }))
    index++
  } else if (unit && unit !== 'minute' && unit !== 'hour') {
    rule.unit = unit
    index++
  } else {
    const named = daysFrom(words, index, g)
    if (!named.days.length) return null
    rule.unit = 'week'
    rule.weekdays = named.days.map((day) => ({ day }))
    index = named.end
  }
  return { end: index, rule }
}

/** A rule standing at `at`, with what follows it: `starting` a day and `until` one. */
export function repeatAt(
  words: readonly Word[],
  at: number,
  g: Grammar,
  clock: Clock,
): Repeat | null {
  // `every morning`, `jeden Abend`: every day, at that part of it.
  const part = g.every.has(bare(words[at])) ? g.partsOfDay[bare(words[at + 1])] : undefined
  if (part) {
    const later = timeInPart(words, at + 2, g, part)
    return { end: later?.end ?? at + 2, rule: emptyRule(), time: later?.time ?? part }
  }

  const read = g.lang === 'de' ? germanRule(words, at, g) : englishRule(words, at, g)
  if (!read) return null

  let { end } = read
  const rule = { ...read.rule }
  let first: string | undefined
  for (let turn = 0; turn < 2; turn++) {
    const key = bare(words[end])
    const isStart = g.starting.has(key)
    if (!isStart && !g.until.has(key)) break
    const day = dayAt(words, end + 1, g, clock, true)
    if (!day?.day) break
    if (isStart) first = day.day
    else rule.until = day.day
    end = day.end
  }
  return first ? { end, rule, first } : { end, rule }
}
