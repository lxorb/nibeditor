import { describe, expect, test } from 'vitest'
import { scanFootnotes } from './footnotes'

describe('the footnotes of a note', () => {
  test('what each one says, and the line its mark is on', () => {
    const note = ['A claim[^1] and another[^2].', '', '[^1]: first', '[^2]: second'].join('\n')

    expect(scanFootnotes(note)).toEqual([
      { id: '1', text: 'first', line: 0, defined: 2, used: true },
      { id: '2', text: 'second', line: 0, defined: 3, used: true },
    ])
  })

  test('in the order the words reach them, not the order they are defined', () => {
    const note = ['Second[^b] then first[^a].', '', '[^a]: A', '[^b]: B'].join('\n')
    expect(scanFootnotes(note).map((one) => one.id)).toEqual(['b', 'a'])
  })

  test('a label is whatever was written between the brackets', () => {
    expect(scanFootnotes('why[^because]\n\n[^because]: it is').map((one) => one.id)).toEqual([
      'because',
    ])
  })

  test('one nothing points at is still a footnote, and says so', () => {
    const note = 'Words.\n\n[^stray]: left behind'
    expect(scanFootnotes(note)).toEqual([
      { id: 'stray', text: 'left behind', line: 2, defined: 2, used: false },
    ])
  })

  test('and one referred to but never written is one too', () => {
    expect(scanFootnotes('A claim[^1].')).toEqual([
      { id: '1', text: '', line: 0, defined: null, used: true },
    ])
  })

  test('the line is the first mark, however many there are', () => {
    const note = ['one[^1]', 'two', 'three[^1]', '', '[^1]: said once'].join('\n')
    const found = scanFootnotes(note)

    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(0)
  })

  test('a definition is not a mention of itself', () => {
    // Without this the row would jump to the bottom of the note rather than to
    // the sentence the mark is in.
    expect(scanFootnotes('Words.\n\n[^1]: said')[0]?.used).toBe(false)
  })

  test('a label written twice is read once, the way the renderer reads it', () => {
    const note = 'A[^1]\n\n[^1]: first\n[^1]: second'
    expect(scanFootnotes(note)).toEqual([
      { id: '1', text: 'first', line: 0, defined: 2, used: true },
    ])
  })

  test('nothing inside a fence, where brackets are code', () => {
    const note = ['```', 'const a = b[^1]', '```', '', 'real[^1]', '', '[^1]: said'].join('\n')
    expect(scanFootnotes(note)[0]?.line).toBe(4)
  })

  test('and a note with none costs nothing', () => {
    expect(scanFootnotes('Just words.\n')).toEqual([])
    expect(scanFootnotes('')).toEqual([])
  })
})

/** A footnote is two things in two places, and the Footnotes panel is the one screen
 *  that offers both: the mark in the words, and the definition at the bottom. So a row
 *  carries both lines rather than one of them with the other as a fallback. */
describe('where the definition is', () => {
  test('is the line the definition is written on', () => {
    const note = 'Words[^1] and more.\n\nMore words.\n\n[^1]: what it says\n'
    const [found] = scanFootnotes(note)

    expect(found?.line).toBe(0)
    expect(found?.defined).toBe(4)
  })

  test('is nothing at all for a mark nothing defines', () => {
    const [found] = scanFootnotes('Words[^1] and no definition.\n')

    expect(found?.line).toBe(0)
    expect(found?.defined).toBeNull()
  })

  test('is the same line as the mark for one nothing points at', () => {
    const [found] = scanFootnotes('Words.\n\n[^lonely]: said and never pointed at\n')

    expect(found?.used).toBe(false)
    expect(found?.line).toBe(2)
    expect(found?.defined).toBe(2)
  })

  test('is the first definition where a label was written twice', () => {
    const note = 'Words[^1].\n\n[^1]: first\n\n[^1]: second\n'
    expect(scanFootnotes(note)[0]?.defined).toBe(2)
  })
})
