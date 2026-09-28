import { describe, expect, test } from 'vitest'
import { when } from './when'

/** A moment as the history sheet and the sync pane both say one. Local times on
 *  both sides, because "today" is the reader's today. */
describe('a moment, said shortly', () => {
  const now = new Date(2026, 8, 28, 18, 30)
  const time = (at: Date) => new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(at)

  test('is only a time for one from today, whichever date style was asked for', () => {
    const earlier = new Date(2026, 8, 28, 9, 5)

    expect(when(earlier.getTime(), 'medium', now)).toBe(time(earlier))
    expect(when(earlier.getTime(), 'short', now)).toBe(time(earlier))
  })

  test('says its day as well for one from before, in the style asked for', () => {
    const before = new Date(2026, 8, 27, 23, 59)
    const said = (dateStyle: 'short' | 'medium') =>
      new Intl.DateTimeFormat('en', { dateStyle, timeStyle: 'short' }).format(before)

    expect(when(before.getTime(), 'medium', now)).toBe(said('medium'))
    expect(when(before.getTime(), 'short', now)).toBe(said('short'))
    expect(said('medium')).not.toBe(said('short'))
  })

  test('and for the same day of another month or year', () => {
    const lastYear = new Date(2025, 8, 28, 9, 5)
    const lastMonth = new Date(2026, 7, 28, 9, 5)

    expect(when(lastYear.getTime(), 'short', now)).not.toBe(time(lastYear))
    expect(when(lastMonth.getTime(), 'short', now)).not.toBe(time(lastMonth))
  })
})
