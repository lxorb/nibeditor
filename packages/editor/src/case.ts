/** Upper case, lower case and title case, over what is selected.
 *
 *  VS Code's three, and the same reading of an empty selection: the word the caret
 *  is in. The selection stays over the words afterwards, so the next of the three
 *  is one press away - and it is re-measured rather than kept, because a letter can
 *  change length on the way: `ß` in capitals is `SS`. */

import { EditorSelection, type StateCommand } from '@codemirror/state'

/** A letter that starts a word: one with no letter, digit or apostrophe in front of
 *  it, so `don't` stays one word and `Don'T` never happens. */
const WORD_START = /(^|[^\p{L}\p{N}'’])(\p{L})/gu

function titled(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(WORD_START, (_, before: string, letter: string) => before + letter.toLocaleUpperCase())
}

function recased(change: (text: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const word = range.empty ? state.wordAt(range.head) : range
      const text = word ? state.sliceDoc(word.from, word.to) : ''
      const insert = change(text)
      // Nothing to write where there is no word, or the words are already so: a
      // press that changes nothing leaves nothing in the history to undo.
      if (!word || insert === text) return { range }

      return {
        changes: { from: word.from, to: word.to, insert },
        range: range.empty
          ? EditorSelection.cursor(Math.min(range.head, word.from + insert.length))
          : EditorSelection.range(word.from, word.from + insert.length),
      }
    })
    if (update.changes.empty) return true

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const upperCase = recased((text) => text.toLocaleUpperCase())
export const lowerCase = recased((text) => text.toLocaleLowerCase())
export const titleCase = recased(titled)
