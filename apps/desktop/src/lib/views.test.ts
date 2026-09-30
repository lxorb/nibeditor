import type { EditorView } from '@nib/editor'
import { beforeEach, describe, expect, test } from 'vitest'
import { countText } from './counts'
import { views } from './views.svelte'

/** A view as far as `moved` reads one: a document and the ranges selected in it.
 *  Built by hand rather than with a real editor, because what is under test is
 *  arithmetic over the ranges and a slice of the text. */
function viewOf(doc: string, ranges: readonly { from: number; to: number }[]): EditorView {
  return {
    state: {
      selection: {
        ranges: (ranges.length ? ranges : [{ from: 0, to: 0 }]).map((one) => ({
          ...one,
          empty: one.from === one.to,
        })),
      },
      doc: { sliceString: (from: number, to: number) => doc.slice(from, to) },
    },
  } as unknown as EditorView
}

beforeEach(() => {
  views.moved(viewOf('', []))
})

describe('what a pane has selected', () => {
  test('is nothing while the caret is a caret', () => {
    views.moved(viewOf('one two three', []))

    expect(views.chosen).toBe(0)
    expect(views.selectedText()).toBe('')
  })

  test('is how many characters, without reading them', () => {
    views.moved(viewOf('one two three', [{ from: 0, to: 7 }]))

    expect(views.chosen).toBe(7)
    expect(views.selectedText()).toBe('one two')
  })

  test('and every range of it, because a note may have several cursors', () => {
    views.moved(
      viewOf('one two three', [
        { from: 0, to: 3 },
        { from: 8, to: 13 },
      ]),
    )

    expect(views.chosen).toBe(8)
    expect(views.selectedText()).toBe('one\nthree')
  })

  test('so the words it holds are the words of every range', () => {
    // What the status bar shows. The joining newline keeps two ranges from
    // reading as one word where they meet.
    views.moved(
      viewOf('one two three', [
        { from: 0, to: 3 },
        { from: 8, to: 13 },
      ]),
    )

    expect(countText(views.selectedText()).words).toBe(2)
  })

  test('and a selection of nothing at all is not a selection', () => {
    views.moved(viewOf('one two', [{ from: 3, to: 3 }]))
    expect(views.chosen).toBe(0)
  })
})

describe('a pane whose editor has gone', () => {
  // Close the last tab in a pane with a line selected and its editor is taken apart
  // without a word: nothing moves in a view that no longer exists. The count at the
  // foot and the passage the Ask panel quotes read from here, and went on quoting
  // the note that had closed.
  test('has nothing selected any more', () => {
    const view = viewOf('one two three', [{ from: 0, to: 7 }])
    views.put('pane', view)
    views.moved(view)

    views.forget('pane')

    expect(views.chosen).toBe(0)
    expect(views.selectedText()).toBe('')
  })

  test('and another pane that reported last keeps its own', () => {
    const gone = viewOf('one two three', [{ from: 0, to: 3 }])
    const kept = viewOf('four five', [{ from: 0, to: 4 }])
    views.put('gone', gone)
    views.put('kept', kept)
    views.moved(gone)
    views.moved(kept)

    views.forget('gone')

    expect(views.chosen).toBe(4)
    expect(views.selectedText()).toBe('four')
  })
})
