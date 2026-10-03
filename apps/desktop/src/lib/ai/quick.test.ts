import { describe, expect, test } from 'vitest'
import { contextMessage, insertion, quickMessages } from './quick'

describe('what a quick question goes with', () => {
  test('the rules, the context, the thread so far and the question, in that order', () => {
    const messages = quickMessages(
      { kind: 'selection', name: 'Plan', text: 'ship on Friday' },
      [
        { role: 'you', text: 'When?' },
        { role: 'model', text: 'Friday.' },
      ],
      'Why?',
    )

    expect(messages.map((one) => one.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
      'user',
    ])
    expect(messages[1]?.content).toContain('<selection>\nship on Friday\n</selection>')
    expect(messages.at(-1)?.content).toBe('Why?')
  })

  test('nothing in place of a context taken off or empty', () => {
    expect(quickMessages(null, [], 'Hi')).toHaveLength(2)
    expect(quickMessages({ kind: 'note', name: 'Empty', text: '  \n' }, [], 'Hi')).toHaveLength(2)
  })

  test('says what kind of thing it is and what it is called', () => {
    expect(contextMessage({ kind: 'note', name: 'Plan', text: 'x' }).content).toMatch(
      /^The note the reader has in front of them, "Plan":\n\n<note>\nx\n<\/note>$/,
    )
    expect(contextMessage({ kind: 'page', name: 'A "quoted" title', text: 'x' }).content).toContain(
      `"A 'quoted' title"`,
    )
  })

  test('a long page is cut down rather than sent whole', () => {
    const long = 'word '.repeat(50_000)
    const sent = contextMessage({ kind: 'page', name: 'Long', text: long }).content
    expect(sent.length).toBeLessThan(long.length / 4)
  })
})

describe('where an answer goes into the note', () => {
  /** The note with the answer in it. */
  const put = (doc: string, at: number, answer: string) => {
    const { from, insert } = insertion(doc, at, answer)
    return doc.slice(0, from) + insert + doc.slice(from)
  }

  test('on lines of its own under the line it was asked from', () => {
    expect(put('one\ntwo\nthree', 1, 'answer')).toBe('one\n\nanswer\n\ntwo\nthree')
    expect(put('one\n\ntwo', 2, 'answer')).toBe('one\n\nanswer\n\ntwo')
  })

  test('at the end of a note with one blank line before it', () => {
    expect(put('one', 3, ' answer \n')).toBe('one\n\nanswer')
    expect(put('one\n', 4, 'answer')).toBe('one\n\nanswer')
    expect(put('one\n\n', 5, 'answer')).toBe('one\n\nanswer')
  })

  test('as the whole of an empty note', () => {
    expect(put('', 0, 'answer')).toBe('answer')
  })

  test('with the caret after it', () => {
    const doc = 'one\ntwo'
    const { from, insert, caret } = insertion(doc, 0, 'answer')
    expect((doc.slice(0, from) + insert).slice(0, caret).endsWith('answer')).toBe(true)
  })
})
