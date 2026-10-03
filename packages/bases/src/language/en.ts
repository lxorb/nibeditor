/** English, as quick add reads it: Todoist's words, and the Tasks plugin's for a
 *  rule. See grammar.ts for what each row is. */

import type { Grammar } from './grammar'

const days: [number, string[]][] = [
  [1, ['monday', 'mon']],
  [2, ['tuesday', 'tue', 'tues']],
  [3, ['wednesday', 'wed']],
  [4, ['thursday', 'thu', 'thur', 'thurs']],
  [5, ['friday', 'fri']],
  [6, ['saturday', 'sat']],
  [0, ['sunday', 'sun']],
]

const months: [number, string[]][] = [
  [1, ['january', 'jan']],
  [2, ['february', 'feb']],
  [3, ['march', 'mar']],
  [4, ['april', 'apr']],
  [5, ['may']],
  [6, ['june', 'jun']],
  [7, ['july', 'jul']],
  [8, ['august', 'aug']],
  [9, ['september', 'sep', 'sept']],
  [10, ['october', 'oct']],
  [11, ['november', 'nov']],
  [12, ['december', 'dec']],
]

const byName = (rows: [number, string[]][]) =>
  Object.fromEntries(rows.flatMap(([number, names]) => names.map((name) => [name, number])))

export const EN: Grammar = {
  lang: 'en',
  today: ['today', 'tod'],
  // Not `tom`: that is somebody's name far more often than it is tomorrow.
  tomorrow: ['tomorrow', 'tmr', 'tmrw'],
  dayAfter: [['day', 'after', 'tomorrow']],
  yesterday: ['yesterday'],

  weekdays: byName(days),
  // Words of their own: "sit in the sun", "wed in May", "sat down".
  shortDays: new Set(['sun', 'sat', 'wed']),
  context: new Set(['on', 'next', 'this', 'by', 'due', 'until', 'starting', 'from', 'every']),

  months: byName(months),

  next: new Set(['next']),
  coming: new Set(['this']),
  week: new Set(['week']),
  month: new Set(['month']),
  year: new Set(['year']),
  endOfMonth: [['end', 'of', 'month'], ['end', 'of', 'the', 'month'], ['eom']],
  weekend: [['this', 'weekend'], ['weekend']],

  within: new Set(['in']),
  units: {
    min: 'minute',
    mins: 'minute',
    minute: 'minute',
    minutes: 'minute',
    m: 'minute',
    h: 'hour',
    hr: 'hour',
    hrs: 'hour',
    hour: 'hour',
    hours: 'hour',
    d: 'day',
    day: 'day',
    days: 'day',
    w: 'week',
    week: 'week',
    weeks: 'week',
    month: 'month',
    months: 'month',
    year: 'year',
    years: 'year',
  },
  numbers: {
    a: 1,
    an: 1,
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
  },

  dayWords: new Set(['on', 'by', 'due']),
  timeWords: new Set(['at', '@']),
  meridiem: { am: 'am', pm: 'pm', 'a.m': 'am', 'p.m': 'pm' },
  oclock: new Set(["o'clock", 'oclock']),
  times: { noon: '12:00', midday: '12:00', midnight: '00:00' },
  dayTimes: [
    { words: ['tonight'], day: 'today', time: '19:00' },
    { words: ['this', 'evening'], day: 'today', time: '19:00' },
    { words: ['this', 'afternoon'], day: 'today', time: '15:00' },
    { words: ['tomorrow', 'morning'], day: 'tomorrow', time: '09:00' },
    { words: ['tomorrow', 'evening'], day: 'tomorrow', time: '19:00' },
    { words: ['tomorrow', 'night'], day: 'tomorrow', time: '19:00' },
  ],

  every: new Set(['every', 'each']),
  everyDone: new Set(['every!']),
  other: new Set(['other']),
  last: new Set(['last']),
  rules: {
    daily: 'every day',
    weekly: 'every week',
    monthly: 'every month',
    yearly: 'every year',
    annually: 'every year',
  },
  starting: new Set(['starting', 'from']),
  until: new Set(['until']),
  workdays: new Set(['weekday', 'weekdays', 'workday', 'workdays']),
  weekends: new Set(['weekend', 'weekends']),

  lasting: new Set(['for']),
  bareDuration: false,

  ordinal: /^(\d{1,2})(?:st|nd|rd|th)$/,
  monthFirst: false,
}

/** American English: `6/10` is the tenth of June. */
export const EN_US: Grammar = { ...EN, lang: 'en-US', monthFirst: true }
