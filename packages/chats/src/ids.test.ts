import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isUlid, ulid, ulidTime } from './ids'

describe('ulid', () => {
  it('writes the time first and the randomness after it', () => {
    expect(ulid(0, () => 0)).toBe('00000000000000000000000000')
    expect(ulid(2 ** 48 - 1, () => 0.999_999)).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(ulid(1_759_833_600_000, () => 0)).toMatch(/^01K[0-9A-Z]{7}0{16}$/)
  })

  it('reads its time back, and is a ULID', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 48 - 1 }),
        fc.double({ min: 0, max: 0.999 }),
        (now, r) => {
          const id = ulid(now, () => r)
          expect(isUlid(id)).toBe(true)
          expect(ulidTime(id)).toBe(now)
        },
      ),
    )
  })

  it('sorts as the times it was made at', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 47 }),
        fc.integer({ min: 1, max: 2 ** 40 }),
        (a, gap) => {
          expect(ulid(a, Math.random) < ulid(a + gap, Math.random)).toBe(true)
        },
      ),
    )
  })

  it('refuses a time no ULID holds', () => {
    expect(() => ulid(-1, Math.random)).toThrow(RangeError)
    expect(() => ulid(2 ** 48, Math.random)).toThrow(RangeError)
    expect(() => ulid(1.5, Math.random)).toThrow(RangeError)
  })

  it('keeps an id inside the alphabet whatever the randomness answers', () => {
    expect(isUlid(ulid(5, () => 1))).toBe(true)
    expect(isUlid(ulid(5, () => -3))).toBe(true)
  })

  it.each([
    '',
    '0000000000000000000000000',
    '80000000000000000000000000',
    '0000000000000000000000000I',
    7,
  ])('is not a ULID: %s', (value) => {
    expect(isUlid(value)).toBe(false)
  })

  it('has no time for what is not a ULID', () => {
    expect(ulidTime('nope')).toBeNull()
  })
})
