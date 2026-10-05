import { describe, expect, test } from 'vitest'

import { agoShort, relativeStep } from './ago'

/** How long ago something happened, as a number and a unit for
 *  `Intl.RelativeTimeFormat`.
 *
 *  The pane it is written for says when a note was deleted, and a reader most
 *  often opens it in the moment after deleting one. It used to floor everything
 *  at a minute, so a note deleted two seconds ago was "deleted 1 minute ago" -
 *  a sentence that is not true, on the one row somebody is looking at. */
describe('how long ago, as a step', () => {
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  test('is seconds for the first minute, so this moment reads as this moment', () => {
    expect(relativeStep(0)).toEqual({ value: 0, unit: 'second' })
    expect(relativeStep(2 * SECOND)).toEqual({ value: -2, unit: 'second' })
    expect(relativeStep(59 * SECOND)).toEqual({ value: -59, unit: 'second' })
  })

  test('minutes for the first hour', () => {
    expect(relativeStep(MINUTE)).toEqual({ value: -1, unit: 'minute' })
    expect(relativeStep(90 * SECOND)).toEqual({ value: -2, unit: 'minute' })
    expect(relativeStep(59 * MINUTE)).toEqual({ value: -59, unit: 'minute' })
  })

  test('hours for the first day, and days after that', () => {
    expect(relativeStep(HOUR)).toEqual({ value: -1, unit: 'hour' })
    expect(relativeStep(5 * HOUR)).toEqual({ value: -5, unit: 'hour' })
    expect(relativeStep(DAY)).toEqual({ value: -1, unit: 'day' })
    expect(relativeStep(13 * DAY)).toEqual({ value: -13, unit: 'day' })
  })

  /** The trash holds rows from the account as well as from this device, and two
   *  machines do not agree about the time to the second. A stamp from a minute in
   *  the future is not a thing that will happen; it is now. */
  test('and a stamp from the future is now rather than a promise', () => {
    expect(relativeStep(-1)).toEqual({ value: 0, unit: 'second' })
    expect(relativeStep(-5 * MINUTE)).toEqual({ value: 0, unit: 'second' })
  })
})

describe('how long ago, said short', () => {
  test('is the language’s own narrow words, and English for a tag Intl does not know', () => {
    const now = Date.UTC(2026, 9, 5, 12)
    expect(agoShort(now - 3 * 60 * 60 * 1000, 'en', now)).toBe('3h ago')
    expect(agoShort(now, 'en', now)).toBe('now')
    expect(agoShort(now - 2 * 24 * 60 * 60 * 1000, 'not a language', now)).toBe('2d ago')
  })
})
