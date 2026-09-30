import { selectSelectionMatches } from '@codemirror/search'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { editorState } from './editor'
import { loadFind } from './find'
import { nibKeymap, selectWord, unclaimedKeymap } from './keymap'

// The library's "select the next one like it" is the search engine's, and the engine is
// fetched rather than carried: awaited once here, where the second press is read in the
// same breath as the first. See find.ts.
beforeAll(async () => {
  await loadFind()
})

/** A state with several ranges in it, which is only possible once the editor
 *  says it is. */
function ranged(doc: string, ...spans: [number, number][]): EditorState {
  return editorState({ doc }).update({
    selection: EditorSelection.create(spans.map(([from, to]) => EditorSelection.range(from, to))),
  }).state
}

function ran(command: StateCommand, from: EditorState): EditorState {
  let next = from
  command({
    state: from,
    dispatch: (transaction) => {
      next = transaction.state
    },
  })
  return next
}

/** Every range, as the text it covers. */
function spans(one: EditorState): string[] {
  return one.selection.ranges.map((range) => one.doc.sliceString(range.from, range.to))
}

describe('an editor that allows several cursors', () => {
  test('keeps every range it is given', () => {
    const several = ranged('one two three', [0, 3], [4, 7], [8, 13])
    expect(spans(several)).toEqual(['one', 'two', 'three'])
  })

  test('draws a caret for each of them', () => {
    // Empty ranges are carets; the smoothed block layer skips them and the
    // library's own cursor layer draws one for every range. What this checks is
    // that the state keeps all three rather than the first.
    const carets = ranged('one two three', [0, 0], [4, 4], [8, 8])
    expect(carets.selection.ranges.length).toBe(3)
  })
})

describe('the word under the caret', () => {
  test('is what the first press selects', () => {
    const grown = ran(selectWord, ranged('one two three', [5, 5]))
    expect(spans(grown)).toEqual(['two'])
  })

  test('grows every caret at once', () => {
    const grown = ran(selectWord, ranged('one two three', [1, 1], [5, 5]))
    expect(spans(grown)).toEqual(['one', 'two'])
  })

  test('and the press after that takes the next one like it', () => {
    const first = ran(selectWord, ranged('one two one two', [0, 0]))
    expect(spans(first)).toEqual(['one'])

    const second = ran(selectWord, first)
    expect(spans(second)).toEqual(['one', 'one'])
  })

  test('goes back to growing when the selection is not a word', () => {
    // Two words and the space between them is not a word, so the press means
    // the word under the head rather than the next span like this one.
    const grown = ran(selectWord, ranged('one two three', [0, 7]))
    expect(spans(grown)).toEqual(['two'])
  })

  test('is not a word when a letter stands beside it', () => {
    const grown = ran(selectWord, ranged('onetwo three', [0, 3]))
    expect(spans(grown)).toEqual(['onetwo'])
  })
})

describe('every one like it', () => {
  test('is selected in one press', () => {
    const all = ran(selectSelectionMatches, ranged('one two one two one', [0, 3]))
    expect(spans(all)).toEqual(['one', 'one', 'one'])
  })
})

describe('the keys these are on', () => {
  test('are the ones the settings list holds', () => {
    const keys = nibKeymap.map((binding) => binding.key)

    expect(keys).toContain('Mod-Alt-Shift-ArrowUp')
    expect(keys).toContain('Mod-Alt-Shift-ArrowDown')
    // Selecting the word ships with none: Ctrl+D is the app's Deselect tab, and the VS
    // Code keyboard gives it back.
    expect(keys).not.toContain('Mod-d')
  })

  test('leave the library nothing of its own to fire underneath them', () => {
    // The four the library binds for the same commands are claimed, so none of
    // them is left as a key that does something nobody can find in the list.
    const keys = unclaimedKeymap.map((binding) => binding.key)

    expect(keys).not.toContain('Mod-d')
    expect(keys).not.toContain('Mod-Shift-l')
    expect(keys).not.toContain('Mod-Alt-ArrowUp')
    expect(keys).not.toContain('Mod-Alt-ArrowDown')
  })
})
