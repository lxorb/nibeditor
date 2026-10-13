import { describe, expect, test } from 'vitest'

import { lz4Block, unmozLz4 } from './mozlz4'
import { mozLz4Of } from './zen.fixture'

const words = (text: string) => new TextEncoder().encode(text)
const read = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('a mozLz4 file', () => {
  test('is the bytes it was made of, short or long', () => {
    for (const text of [
      '',
      '{}',
      'x'.repeat(14),
      'y'.repeat(15),
      'z'.repeat(300),
      'é'.repeat(700),
    ]) {
      expect(read(unmozLz4(mozLz4Of(words(text))))).toBe(text)
    }
  })

  test('copies a match from behind it, overlapping what it writes', () => {
    // "abc", then a match two back, six long: "abcbcbcbc"; then "!" alone.
    const block = new Uint8Array([0x32, 0x61, 0x62, 0x63, 0x02, 0x00, 0x10, 0x21])
    expect(read(lz4Block(block, 10))).toBe('abcbcbcbc!')
  })

  test('reads a match length that runs past its half of the token', () => {
    // "a", then a match one back of 15 + 4 + 2 = 21, then "b".
    const block = new Uint8Array([0x1f, 0x61, 0x01, 0x00, 0x02, 0x10, 0x62])
    expect(read(lz4Block(block, 23))).toBe(`${'a'.repeat(22)}b`)
  })

  test('is refused when it is not one, or is cut short', () => {
    expect(() => unmozLz4(words('{"windows":[]}'))).toThrow()
    const whole = mozLz4Of(words('a session that was being written'))
    expect(() => unmozLz4(whole.subarray(0, whole.length - 5))).toThrow()
    // A match pointing before the start of the block.
    expect(() => lz4Block(new Uint8Array([0x10, 0x61, 0x05, 0x00]), 5)).toThrow()
  })
})
