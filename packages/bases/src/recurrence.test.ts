import { describe, expect, test } from 'vitest'
import { nextDate, parseRule, ruleText } from './recurrence'

/** The rules of the Tasks plugin's documentation, each read and written back in
 *  its own words. */
const PLUGIN_RULES = [
  'every 3 days',
  'every 10 days when done',
  'every weekday',
  'every week on Sunday',
  'every week on Tuesday, Friday',
  'every 2 weeks',
  'every 3 weeks on Friday',
  'every 2 months',
  'every month on the 1st',
  'every month on the last',
  'every month on the last Friday',
  'every month on the 2nd last Friday',
  'every 6 months on the 2nd Wednesday',
  'every January on the 15th',
  'every February on the last',
  'every April and December on the 1st and 24th',
  'every year',
  'every day',
  'every week',
  'every month',
  'every day when done',
]

describe('a rule', () => {
  test.each(PLUGIN_RULES)('%s reads and writes back as written', (text) => {
    const rule = parseRule(text)
    expect(rule).not.toBeNull()
    if (rule) expect(ruleText(rule)).toBe(text)
  })

  test.each<[string, string]>([
    ['every Sunday', 'every week on Sunday'],
    ['every mon, fri', 'every week on Monday, Friday'],
    ['every monday and friday', 'every week on Monday, Friday'],
    ['every other week', 'every 2 weeks'],
    ['every workday', 'every weekday'],
    ['every weekend', 'every week on Saturday, Sunday'],
    ['every! 3 months', 'every 3 months when done'],
    ['every two days', 'every 2 days'],
    ['Every Week On Monday', 'every week on Monday'],
    ['every year on 3 March', 'every March on the 3rd'],
    ['every year on March 3', 'every March on the 3rd'],
    ['every day until 2026-12-24', 'every day until December 24, 2026'],
    ['every day until December 24, 2026', 'every day until December 24, 2026'],
    ['every week for 3 times', 'every week for 3 times'],
    ['every month on the 1st and the 15th', 'every month on the 1st and 15th'],
  ])('%s is written %s', (written, canonical) => {
    const rule = parseRule(written)
    expect(rule).not.toBeNull()
    if (rule) expect(ruleText(rule)).toBe(canonical)
  })

  test.each([
    '',
    'daily',
    'every',
    'every blue moon',
    'every 0 days',
    'every day until someday',
    'every month on the',
  ])('%j is not a rule', (text) => {
    expect(parseRule(text)).toBeNull()
  })

  test('an until written for the plugin has no hyphen, which its reader would stop at', () => {
    const rule = parseRule('every week until 2027-01-01')
    expect(rule && ruleText(rule)).toMatch(/^[a-zA-Z0-9, !]+$/)
  })
})

/** [rule, reference date, after, next]. */
const DATES: [string, string, string, string | null][] = [
  // The plugin's documented examples.
  ['every Sunday', '2021-04-25', '2021-04-25', '2021-05-02'],
  ['every 2 weeks', '2021-10-30', '2021-10-30', '2021-11-13'],
  ['every week', '2021-02-06', '2021-02-06', '2021-02-13'],
  ['every month on the last', '2022-01-31', '2022-01-31', '2022-02-28'],
  ['every month on the last', '2022-02-28', '2022-02-28', '2022-03-31'],
  ['every month on the last', '2022-04-30', '2022-04-30', '2022-05-31'],
  // `every month` keeps the day, the month's last standing in where it has none.
  ['every month', '2021-10-31', '2021-10-31', '2021-11-30'],
  ['every month', '2021-11-30', '2021-11-30', '2021-12-30'],
  ['every month', '2021-12-30', '2021-12-30', '2022-01-30'],
  ['every month', '2022-01-30', '2022-01-30', '2022-02-28'],
  ['every month', '2022-02-28', '2022-02-28', '2022-03-28'],
  // `on the 31st` skips the months without one, as the plugin warns.
  ['every month on the 31st', '2022-01-31', '2022-01-31', '2022-03-31'],
  ['every month on the 31st', '2022-03-31', '2022-03-31', '2022-05-31'],
  ['every month on the 31st', '2022-05-31', '2022-05-31', '2022-07-31'],
  // Leap days.
  ['every year', '2024-02-29', '2024-02-29', '2025-02-28'],
  ['every February on the last', '2023-02-28', '2023-02-28', '2024-02-29'],
  ['every 4 years', '2024-02-29', '2024-02-29', '2028-02-29'],
  ['every day', '2024-02-28', '2024-02-28', '2024-02-29'],
  // Weeks.
  ['every weekday', '2026-10-02', '2026-10-02', '2026-10-05'],
  ['every weekday', '2026-10-05', '2026-10-05', '2026-10-06'],
  ['every week on Tuesday, Friday', '2026-10-06', '2026-10-06', '2026-10-09'],
  ['every week on Tuesday, Friday', '2026-10-09', '2026-10-09', '2026-10-13'],
  ['every 2 weeks on Monday', '2026-10-05', '2026-10-05', '2026-10-19'],
  ['every 3 weeks on Friday', '2026-10-09', '2026-10-09', '2026-10-30'],
  ['every weekend', '2026-10-03', '2026-10-03', '2026-10-04'],
  // Months by weekday.
  ['every month on the last Friday', '2026-10-30', '2026-10-30', '2026-11-27'],
  ['every month on the 2nd last Friday', '2026-10-23', '2026-10-23', '2026-11-20'],
  ['every 6 months on the 2nd Wednesday', '2026-10-14', '2026-10-14', '2027-04-14'],
  ['every month on the 1st', '2026-10-01', '2026-10-01', '2026-11-01'],
  // Years by month.
  ['every January on the 15th', '2026-01-15', '2026-01-15', '2027-01-15'],
  ['every April and December on the 1st and 24th', '2026-04-24', '2026-04-24', '2026-12-01'],
  ['every April and December on the 1st and 24th', '2026-12-24', '2026-12-24', '2027-04-01'],
  ['every year on 3 March', '2026-03-03', '2026-03-03', '2027-03-03'],
  // Days.
  ['every 3 days', '2026-10-01', '2026-10-01', '2026-10-04'],
  // Past occurrences skipped: the first after `after`, on the rule's own beat.
  ['every 3 days', '2026-09-01', '2026-10-04', '2026-10-07'],
  ['every week', '2026-09-01', '2026-10-04', '2026-10-06'],
  ['every month', '2025-01-31', '2026-10-04', '2026-10-31'],
  // Until.
  ['every day until 2026-10-05', '2026-10-04', '2026-10-04', '2026-10-05'],
  ['every day until 2026-10-05', '2026-10-05', '2026-10-05', null],
  // A rule that names no date at all.
  ['every February on the 30th', '2026-01-01', '2026-01-01', null],
]

describe('the next date', () => {
  test.each(DATES)('%s from %s after %s is %s', (text, start, after, next) => {
    const rule = parseRule(text)
    expect(rule).not.toBeNull()
    if (rule) expect(nextDate(rule, start, after)).toBe(next)
  })
})
