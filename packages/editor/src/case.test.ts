import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { lowerCase, titleCase, upperCase } from './case'

/** What a command makes of the words from `from` to `to`, and what it leaves
 *  selected. */
function run(command: StateCommand, doc: string, from: number, to = from) {
  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  const took = command({ state, dispatch: (transaction) => (state = transaction.state) })
  const { from: start, to: end } = state.selection.main
  return { took, doc: state.doc.toString(), selected: state.sliceDoc(start, end), start, end }
}

describe('changing case', () => {
  test('upper and lower case the selection and keep it selected', () => {
    expect(run(upperCase, 'say hello there', 4, 9)).toMatchObject({
      doc: 'say HELLO there',
      selected: 'HELLO',
    })
    expect(run(lowerCase, 'SAY HELLO', 0, 9).doc).toBe('say hello')
  })

  test('title case starts every word and lowers the rest', () => {
    expect(run(titleCase, 'the QUICK brown-fox', 0, 19).doc).toBe('The Quick Brown-Fox')
  })

  test('title case keeps an apostrophe inside its word', () => {
    expect(run(titleCase, "don't stop", 0, 10).doc).toBe("Don't Stop")
  })

  test('title cases letters beyond English', () => {
    expect(run(titleCase, 'élan über', 0, 9).doc).toBe('Élan Über')
  })

  test('an empty selection means the word the caret is in, and the caret stays', () => {
    expect(run(upperCase, 'one two three', 5)).toMatchObject({ doc: 'one TWO three', start: 5 })
  })

  test('the selection follows a letter that changes length', () => {
    expect(run(upperCase, 'straße', 0, 6)).toMatchObject({ doc: 'STRASSE', selected: 'STRASSE' })
  })

  test('words already in that case are left out of the history', () => {
    let dispatched = false
    const state = EditorState.create({ doc: 'LOUD', selection: EditorSelection.range(0, 4) })
    upperCase({ state, dispatch: () => (dispatched = true) })
    expect(dispatched).toBe(false)
  })
})
