import { describe, expect, test } from 'vitest'
import { pieces } from './pieces'

const drawn = (name: string, term: string) =>
  pieces(name, term)
    .map((one) => (one.hit ? `[${one.text}]` : one.text))
    .join('')

describe('the letters a row was found by', () => {
  test('are marked where they landed, at the start of the word that holds them', () => {
    expect(drawn('Project plan', 'plan')).toBe('Project [plan]')
    expect(drawn('Reopen closed tab', 'rct')).toBe('[R]eopen [c]losed [t]ab')
  })

  test('are marked for every word typed, in any order', () => {
    expect(drawn('Check spelling', 'spell check')).toBe('[Check] [spell]ing')
  })

  test('are nothing where the name does not hold them all', () => {
    expect(drawn('Lecture 3', 'uni/lec')).toBe('Lecture 3')
    expect(drawn('Plan', '')).toBe('Plan')
  })
})
