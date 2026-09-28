import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { joinLines, loadLineCommands, sortLines } from './line-door'

/** A press in front of the fetch. The commands are fetched once per process and kept,
 *  so this file is its own: a test that needs them absent cannot share a file with
 *  one that needs them here. The commands themselves are lines.test.ts and the rest. */

function standIn(doc: string, caret: number) {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(caret) })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView

  return { view, text: () => state.doc.toString() }
}

test('a key pressed before the commands land spends the press, and runs as they do', async () => {
  const { view, text } = standIn('b\na', 0)

  expect(sortLines(view)).toBe(true)
  expect(text()).toBe('b\na')

  await loadLineCommands()
  expect(text()).toBe('a\nb')
})

test('once they are here, a press runs in the turn it is made', async () => {
  await loadLineCommands()
  const { view, text } = standIn('one\ntwo', 0)
  view.dispatch({ selection: { anchor: 1 } })

  joinLines(view)
  expect(text()).toBe('one two')
})
