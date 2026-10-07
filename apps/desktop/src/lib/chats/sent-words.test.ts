import { describe, expect, test } from 'vitest'
import { headingAbove, sentWords } from './sent-words'

describe('what Send to chat writes', () => {
  test('a note is a link to it', () => {
    expect(sentWords('Chapter 3')).toBe('[[Chapter 3]] ')
  })

  test('a selection is a quote above a link to its heading', () => {
    expect(sentWords('Chapter 3', { text: 'one\n\ntwo\n', heading: 'Figures' })).toBe(
      '> one\n>\n> two\n\n[[Chapter 3#Figures]] ',
    )
    expect(sentWords('Plan', { text: 'go', heading: null })).toBe('> go\n\n[[Plan]] ')
  })

  test('the heading a place is under', () => {
    const text = '# Plan\nintro\n## Figures ##\nthe second\n'
    expect(headingAbove(text, text.indexOf('second'))).toBe('Figures')
    expect(headingAbove(text, text.indexOf('intro'))).toBe('Plan')
    expect(headingAbove('no heading', 3)).toBeNull()
  })
})
