/** The panel's two kinds of number, in the reader's language. */

import { describe, expect, test } from 'vitest'
import { seconds, tokens } from './numbers'

describe('a count of tokens', () => {
  test('is as short as it can be said', () => {
    expect(tokens(980, 'en')).toBe('980')
    expect(tokens(41_000, 'en')).toBe('41K')
    expect(tokens(1_000_000, 'en')).toBe('1M')
  })

  test('keeps one decimal under ten of a unit, where it changes what is read', () => {
    expect(tokens(2_400, 'en')).toBe('2.4K')
    expect(tokens(24_400, 'en')).toBe('24K')
    expect(tokens(1_500_000, 'en')).toBe('1.5M')
  })

  test('is said in the language asked for, and in English for a tag Intl does not know', () => {
    expect(tokens(412_000, 'de')).toMatch(/412/)
    expect(tokens(5, 'not a language at all')).toBe('5')
  })
})

describe('a length of time', () => {
  test('is whole seconds and never less than one', () => {
    expect(seconds(300, 'en')).toBe('1s')
    expect(seconds(6_400, 'en')).toBe('6s')
  })
})
