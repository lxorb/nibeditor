import { TEXT } from '@nib/rooms'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { changes, edited, note } from '../test/markdown'
import { textops } from './textops'

function docReading(text: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getText(TEXT).insert(0, text)
  return doc
}

/** Whether a text holds U+FFFD, which is what Yjs leaves where a pair was cut. */
function scarred(text: string): boolean {
  return text.includes(String.fromCharCode(0xfffd))
}

describe('textops', () => {
  test('turns a text into another with the operations it differs by', () => {
    const doc = docReading('The quick brown fox')
    const count = textops(doc.getText(TEXT), 'The quick brown fox', 'The slow brown fox!')

    expect(doc.getText(TEXT).toJSON()).toBe('The slow brown fox!')
    expect(count).toBeLessThanOrEqual(4)
  })

  test('does nothing for the same text', () => {
    const doc = docReading('same')
    expect(textops(doc.getText(TEXT), 'same', 'same')).toBe(0)
  })

  test('never cuts an emoji in half', () => {
    const doc = docReading('a😀b')
    textops(doc.getText(TEXT), 'a😀b', 'a😃b')

    expect(doc.getText(TEXT).toJSON()).toBe('a😃b')
    expect(scarred(doc.getText(TEXT).toJSON())).toBe(false)
  })

  test('refuses a stale copy of the text rather than edit the wrong characters', () => {
    const doc = docReading('longer than that')
    expect(() => textops(doc.getText(TEXT), 'short', 'shorter')).toThrow(/not 5/)
  })

  test('is one transaction, under the origin it is given', () => {
    const doc = docReading('one two three')
    const origins: unknown[] = []
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin))

    textops(doc.getText(TEXT), 'one two three', 'one 2 three four', 'mine')
    expect(origins).toEqual(['mine'])
  })

  test('a word changed in a hundred kilobytes costs a word, not the note', () => {
    const paragraph = 'The plan for tomorrow is to write, then to rest, then to write again. '
    const big = paragraph.repeat(Math.ceil(100_000 / paragraph.length))
    const middle = Math.floor(big.length / 2)
    const word = big.indexOf('rest', middle)
    const after = `${big.slice(0, word)}sleep${big.slice(word + 'rest'.length)}`

    const doc = docReading(big)
    const before = Y.encodeStateVector(doc)
    const count = textops(doc.getText(TEXT), big, after)
    const update = Y.encodeStateAsUpdateV2(doc, before)

    expect(doc.getText(TEXT).toJSON()).toBe(after)
    expect(count).toBeLessThanOrEqual(2)
    expect(update.length).toBeLessThan(100)
  })

  test('property: textops(A, B) on a document reading A reads B, whole characters only', () => {
    fc.assert(
      fc.property(note, changes, (before, edits) => {
        const after = edited(before, edits)
        const doc = docReading(before)
        textops(doc.getText(TEXT), before, after)
        const read = doc.getText(TEXT).toJSON()

        expect(read).toBe(after)
        expect(scarred(read)).toBe(false)
      }),
      { numRuns: 500 },
    )
  })

  test('property: the cost is the edit, whatever surrounds it', () => {
    const around = 'An unchanged paragraph somebody wrote long ago.\n\n'.repeat(400)

    fc.assert(
      fc.property(note, changes, (before, edits) => {
        const after = edited(before, edits)
        const alone = textops(docReading(before).getText(TEXT), before, after)

        const padded = `${around}\u0000${before}\u0000${around}`
        const paddedAfter = `${around}\u0000${after}\u0000${around}`
        const doc = docReading(padded)
        const vector = Y.encodeStateVector(doc)
        const inside = textops(doc.getText(TEXT), padded, paddedAfter)

        expect(inside).toBe(alone)
        expect(Y.encodeStateAsUpdateV2(doc, vector).length).toBeLessThan(
          200 + 4 * (before.length + after.length),
        )
      }),
      { numRuns: 200 },
    )
  })

  test('property: the operations merge with a concurrent edit without losing it', () => {
    fc.assert(
      fc.property(note, changes, changes, (before, mine, theirs) => {
        const local = docReading(before)
        const remote = new Y.Doc()
        Y.applyUpdateV2(remote, Y.encodeStateAsUpdateV2(local))

        const ours = edited(before, mine)
        const other = edited(before, theirs)
        textops(local.getText(TEXT), before, ours)
        textops(remote.getText(TEXT), before, other)

        Y.applyUpdateV2(local, Y.encodeStateAsUpdateV2(remote))
        Y.applyUpdateV2(remote, Y.encodeStateAsUpdateV2(local))

        expect(local.getText(TEXT).toJSON()).toBe(remote.getText(TEXT).toJSON())
        expect(scarred(local.getText(TEXT).toJSON())).toBe(false)
      }),
      { numRuns: 300 },
    )
  })
})
