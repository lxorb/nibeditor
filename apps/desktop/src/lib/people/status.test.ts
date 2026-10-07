import { describe, expect, test } from 'vitest'
import { clearsAt, stands } from './status'

/** Wednesday 7 October 2026, 14:20, in whatever zone the tests run in. */
const NOW = new Date(2026, 9, 7, 14, 20)

describe('when a status clears', () => {
  test('after a stretch of time, counted from now', () => {
    expect(clearsAt('30m', NOW)).toBe(NOW.getTime() + 30 * 60_000)
    expect(clearsAt('1h', NOW)).toBe(NOW.getTime() + 60 * 60_000)
    expect(clearsAt('4h', NOW)).toBe(NOW.getTime() + 4 * 60 * 60_000)
  })

  test('today, at the midnight that ends it', () => {
    expect(clearsAt('today', NOW)).toBe(new Date(2026, 9, 8).getTime())
  })

  test('this week, at the midnight that ends Sunday', () => {
    expect(clearsAt('week', NOW)).toBe(new Date(2026, 9, 12).getTime())
    // On a Sunday, the end of that same day.
    expect(clearsAt('week', new Date(2026, 9, 11, 9))).toBe(new Date(2026, 9, 12).getTime())
  })

  test('never, when asked not to', () => {
    expect(clearsAt('never', NOW)).toBeNull()
  })
})

describe('a status', () => {
  test('stands until its moment and not at it', () => {
    expect(stands({ until: 1000 }, 999)).toBe(true)
    expect(stands({ until: 1000 }, 1000)).toBe(false)
    expect(stands({ until: null }, Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(stands(null, 0)).toBe(false)
  })
})
