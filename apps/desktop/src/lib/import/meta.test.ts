import { describe, expect, test } from 'vitest'

import { dayOf, frontMatterFor, noteText, tagName } from './meta'

describe('front matter for an imported note', () => {
  test('writes the day it was made under the key nib already reads', () => {
    expect(frontMatterFor({ date: '2026-01-02' })).toBe('---\ndate: 2026-01-02\n---\n\n')
  })

  test('writes the last-edited day only when it is a different day', () => {
    expect(frontMatterFor({ date: '2026-01-02', updated: '2026-01-02' })).not.toContain('updated')
    expect(frontMatterFor({ date: '2026-01-02', updated: '2026-03-04' })).toContain(
      'updated: 2026-03-04',
    )
  })

  test('writes tags as a list, tidied, with nothing said twice', () => {
    expect(frontMatterFor({ tags: ['#work', 'two words', 'work', 'a/b'] })).toBe(
      '---\ntags: [work, two-words, a/b]\n---\n\n',
    )
  })

  test('writes a column the export carried under a name YAML can hold', () => {
    const block = frontMatterFor({ extra: [['Last edited time', '2026-01-02']] })

    expect(block).toContain('last-edited-time: 2026-01-02')
  })

  test('a note with nothing to say carries no fence at all', () => {
    expect(frontMatterFor({})).toBe('')
    expect(frontMatterFor({ tags: [], extra: [['Empty', '  ']] })).toBe('')
  })
})

describe('a whole note', () => {
  test('is its properties, its title as a heading, and its words', () => {
    expect(noteText('Plan', 'Some words.', { date: '2026-01-02' })).toBe(
      '---\ndate: 2026-01-02\n---\n\n# Plan\n\nSome words.\n',
    )
  })

  test('keeps the heading a body already opens with rather than writing a second', () => {
    expect(noteText('Plan', '# Plan\n\nWords.')).toBe('# Plan\n\nWords.\n')
  })

  test('keeps the indent of a first line, which is what makes it code', () => {
    expect(noteText(null, '\n\n    let x = 1\n    let y = 2\n\nAfter.\n')).toBe(
      '    let x = 1\n    let y = 2\n\nAfter.\n',
    )
  })

  test('a note with no words at all is its heading, the way a new note is', () => {
    expect(noteText('Empty', '   \n\n')).toBe('# Empty\n\n')
  })
})

describe('a tag out of a label', () => {
  test('loses its spaces, its hash and its punctuation, and keeps its slashes', () => {
    expect(tagName('#Work')).toBe('Work')
    expect(tagName('two words')).toBe('two-words')
    expect(tagName('a/b/c')).toBe('a/b/c')
    expect(tagName('half-done!')).toBe('half-done')
    expect(tagName('  ')).toBe('')
  })

  test('keeps letters that are not English ones', () => {
    expect(tagName('Zürich')).toBe('Zürich')
    expect(tagName('日本語')).toBe('日本語')
  })
})

describe('the day a date lands on', () => {
  test('reads every shape these exports write', () => {
    expect(dayOf('20260102T120000Z')).toBe('2026-01-02')
    expect(dayOf('2026-01-02T12:00:00.000Z')).toBe('2026-01-02')
    expect(dayOf('2026_01_02')).toBe('2026-01-02')
    expect(dayOf('January 2, 2026')).toBe('2026-01-02')
    // Keep counts microseconds and Roam counts milliseconds.
    expect(dayOf(1767355200000000)).toBe('2026-01-02')
    expect(dayOf(1767355200000)).toBe('2026-01-02')
    expect(dayOf('1767355200')).toBe('2026-01-02')
  })

  test('answers nothing rather than inventing a date', () => {
    expect(dayOf('')).toBeNull()
    expect(dayOf(null)).toBeNull()
    expect(dayOf('soon')).toBeNull()
    expect(dayOf(0)).toBeNull()
    expect(dayOf('0001-01-01')).toBeNull()
  })
})
