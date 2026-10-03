/** German, as quick add reads it. See grammar.ts for what each row is. A rule is
 *  still written in the Tasks plugin's English (`🔁 every week on Monday`): only
 *  the reading is German. */

import type { Grammar } from './grammar'

const days: [number, string[]][] = [
  [1, ['montag', 'mo']],
  [2, ['dienstag', 'di']],
  [3, ['mittwoch', 'mi']],
  [4, ['donnerstag', 'do']],
  [5, ['freitag', 'fr']],
  [6, ['samstag', 'sonnabend', 'sa']],
  [0, ['sonntag', 'so']],
]

const months: [number, string[]][] = [
  [1, ['januar', 'jänner', 'jan', 'jän']],
  [2, ['februar', 'feb']],
  [3, ['märz', 'maerz', 'mär']],
  [4, ['april', 'apr']],
  [5, ['mai']],
  [6, ['juni', 'jun']],
  [7, ['juli', 'jul']],
  [8, ['august', 'aug']],
  [9, ['september', 'sep', 'sept']],
  [10, ['oktober', 'okt']],
  [11, ['november', 'nov']],
  [12, ['dezember', 'dez']],
]

const byName = (rows: [number, string[]][]) =>
  Object.fromEntries(rows.flatMap(([number, names]) => names.map((name) => [name, number])))

/** The English weekday names a rule is written with, by number. */
const ENGLISH_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The weekdays' plural, `montags`: a rule on its own. */
const everyDay = Object.fromEntries(
  days.map(([day, [name = '']]) => [`${name}s`, `every ${ENGLISH_DAYS[day] ?? ''}`]),
)

export const DE: Grammar = {
  lang: 'de',
  today: ['heute'],
  tomorrow: ['morgen'],
  dayAfter: [['übermorgen'], ['uebermorgen']],
  yesterday: ['gestern'],

  weekdays: byName(days),
  // Every two-letter one is a word as well: "Do it", "So what", "Mi casa".
  shortDays: new Set(['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so']),
  context: new Set([
    'am',
    'nächsten',
    'nächster',
    'nächste',
    'kommenden',
    'diesen',
    'bis',
    'ab',
    'jeden',
    'jede',
  ]),

  months: byName(months),

  next: new Set(['nächsten', 'nächster', 'nächste', 'nächstes', 'kommenden', 'kommende']),
  coming: new Set(['diesen', 'dieser', 'diese']),
  week: new Set(['woche']),
  month: new Set(['monat']),
  year: new Set(['jahr']),
  endOfMonth: [['monatsende'], ['ende', 'des', 'monats'], ['zum', 'monatsende']],
  weekend: [['am', 'wochenende'], ['wochenende'], ['dieses', 'wochenende']],

  within: new Set(['in']),
  units: {
    min: 'minute',
    minute: 'minute',
    minuten: 'minute',
    m: 'minute',
    std: 'hour',
    h: 'hour',
    stunde: 'hour',
    stunden: 'hour',
    tag: 'day',
    tage: 'day',
    tagen: 'day',
    woche: 'week',
    wochen: 'week',
    monat: 'month',
    monate: 'month',
    monaten: 'month',
    jahr: 'year',
    jahre: 'year',
    jahren: 'year',
  },
  numbers: {
    einer: 1,
    einem: 1,
    eine: 1,
    ein: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
  },

  dayWords: new Set(['am', 'bis']),
  timeWords: new Set(['um', '@']),
  meridiem: {},
  oclock: new Set(['uhr']),
  times: { mittags: '12:00', mittag: '12:00', abends: '19:00', morgens: '09:00' },
  dayTimes: [
    { words: ['heute', 'abend'], day: 'today', time: '19:00' },
    { words: ['heute', 'nachmittag'], day: 'today', time: '15:00' },
    { words: ['heute', 'mittag'], day: 'today', time: '12:00' },
    { words: ['heute', 'nacht'], day: 'today', time: '22:00' },
    { words: ['morgen', 'früh'], day: 'tomorrow', time: '09:00' },
    { words: ['morgen', 'vormittag'], day: 'tomorrow', time: '10:00' },
    { words: ['morgen', 'mittag'], day: 'tomorrow', time: '12:00' },
    { words: ['morgen', 'nachmittag'], day: 'tomorrow', time: '15:00' },
    { words: ['morgen', 'abend'], day: 'tomorrow', time: '19:00' },
  ],

  every: new Set(['jeden', 'jede', 'jedes', 'alle']),
  everyDone: new Set(['jeden!', 'jede!', 'jedes!', 'alle!']),
  other: new Set(['zweite', 'zweiten', 'zweites', 'andere', 'anderen']),
  last: new Set(['letzten', 'letzte', 'letzter']),
  rules: {
    täglich: 'every day',
    wöchentlich: 'every week',
    monatlich: 'every month',
    jährlich: 'every year',
    werktags: 'every weekday',
    ...everyDay,
  },
  starting: new Set(['ab']),
  until: new Set(['bis']),
  workdays: new Set(['werktag', 'werktage', 'arbeitstag', 'arbeitstage']),
  weekends: new Set(['wochenende', 'wochenenden']),

  lasting: new Set(['für']),
  bareDuration: true,

  ordinal: /^(\d{1,2})\.$/,
  monthFirst: false,
}
