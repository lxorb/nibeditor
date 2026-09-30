import { describe, expect, test } from 'vitest'
import { runsOf } from './runs'

const plain = (text: string) => ({ text, marked: false })
const marked = (text: string) => ({ text, marked: true })

describe('a contested passage as runs', () => {
  test('is the words in order, the marked ones marked', () => {
    expect(
      runsOf({
        text: 'We meet at one on Saturday.',
        marks: [
          [11, 14],
          [18, 26],
        ],
      }),
    ).toEqual([plain('We meet at '), marked('one'), plain(' on '), marked('Saturday'), plain('.')])
  })

  test('is one plain run with nothing marked, and nothing at all for no words', () => {
    expect(runsOf({ text: 'Same', marks: [] })).toEqual([plain('Same')])
    expect(runsOf({ text: '', marks: [[0, 4]] })).toEqual([])
  })

  test('puts right marks out of order, overlapping, touching, empty or past the end', () => {
    expect(
      runsOf({
        text: 'abcdefghij',
        marks: [
          [6, 20],
          [1, 3],
          [2, 4],
          [4, 5],
          [5, 5],
          [-3, 0],
        ],
      }),
    ).toEqual([plain('a'), marked('bcde'), plain('f'), marked('ghij')])
  })
})
