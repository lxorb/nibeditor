import { describe, expect, test } from 'vitest'
import { difference, joined } from './words'

describe('a thought put on the end', () => {
  test('is one blank line under what was there, however it ended', () => {
    expect(joined('a number to call', 'the answer')).toBe('a number to call\n\nthe answer\n')
    expect(joined('a number to call\n', 'the answer')).toBe('a number to call\n\nthe answer\n')
    expect(joined('a number to call\n\n\n\n', 'the answer\n')).toBe(
      'a number to call\n\nthe answer\n',
    )
  })

  test('is the whole of an empty scratchpad, and nothing is nothing', () => {
    expect(joined('', '  the answer  ')).toBe('the answer\n')
    expect(joined('\n\n', 'the answer')).toBe('the answer\n')
    expect(joined('kept', '   ')).toBe('kept')
  })
})

describe('the edit a tab showing it takes', () => {
  /** The edit, applied. */
  const applied = (before: string, after: string) => {
    const { from, to, insert } = difference(before, after)
    return before.slice(0, from) + insert + before.slice(to)
  }

  test('is only what changed, so a caret before it stays put', () => {
    expect(difference('one\n', 'one\n\ntwo\n')).toEqual({ from: 4, to: 4, insert: '\ntwo\n' })
    expect(difference('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
  })

  test('turns the words into the new ones whatever they were', () => {
    for (const [before, after] of [
      ['one\n', ''],
      ['', 'one'],
      ['aaa', 'aa'],
      ['abcabc', 'abc'],
      ['the cat sat', 'the dog sat'],
    ] as const) {
      expect(applied(before, after)).toBe(after)
    }
  })
})
