import { describe, expect, test } from 'vitest'
import {
  addDays,
  addMonths,
  civil,
  dateAt,
  formatDate,
  msOf,
  readDate,
  relative,
  weekday,
} from './dates'

describe('dates on the floating clock', () => {
  test('a real date and not', () => {
    expect(civil('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(civil('2023-02-29')).toBeNull()
    expect(civil('2026-13-01')).toBeNull()
    expect(civil('6.10.2026')).toBeNull()
  })

  test('days and months added the way Moment adds them', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
  })

  test('weekdays, Sunday 0', () => {
    expect(weekday('2026-10-04')).toBe(0)
    expect(weekday('2026-10-05')).toBe(1)
    expect(weekday('1970-01-01')).toBe(4)
    expect(weekday('1969-12-31')).toBe(3)
  })

  test('a moment and back', () => {
    const value = readDate('2026-10-04 16:05:09')
    expect(value).toEqual({ kind: 'date', iso: '2026-10-04', time: '16:05:09' })
    if (value) expect(dateAt(msOf(value))).toEqual(value)
    expect(readDate('2026-10-04T9:05')).toEqual({
      kind: 'date',
      iso: '2026-10-04',
      time: '09:05:00',
    })
    expect(readDate('tomorrow')).toBeNull()
  })

  test.each([
    ['YYYY-MM-DD', '2026-10-04'],
    ['YY/M/D', '26/10/4'],
    ['MMMM Do, YYYY', 'October 4th, 2026'],
    ['MMM D', 'Oct 4'],
    ['dddd ddd dd d E', 'Sunday Sun Su 0 7'],
    ['HH:mm:ss H h hh A a', '16:05:09 16 4 04 PM pm'],
    ['[Week] W, Q', 'Week 40, 4'],
    ['DDDD', '277'],
  ])('%s is %s', (format, expected) => {
    expect(formatDate({ kind: 'date', iso: '2026-10-04', time: '16:05:09' }, format)).toBe(expected)
  })

  test.each([
    [0, 'a few seconds ago'],
    [-30 * 60_000, '30 minutes ago'],
    [2 * 3_600_000, 'in 2 hours'],
    [-26 * 3_600_000, 'a day ago'],
    [-3 * 86_400_000, '3 days ago'],
    [40 * 86_400_000, 'in a month'],
    [-100 * 86_400_000, '3 months ago'],
    [-400 * 86_400_000, 'a year ago'],
    [-800 * 86_400_000, '2 years ago'],
  ])('%i ms from now is %s', (offset, expected) => {
    expect(relative(1_000_000_000_000 + offset, 1_000_000_000_000)).toBe(expected)
  })
})
