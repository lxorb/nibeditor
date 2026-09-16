import { history } from '@codemirror/commands'
import { EditorSelection, EditorState, StateEffect, type TransactionSpec } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { HeldState, type StateView } from './held'
import { documentOf, SharedDoc, sharedOf, sharing } from './shared'

/** Stands in for a scroll snapshot: what a real view answers is CodeMirror's own
 *  effect, and what matters here is that whatever it is travels with the note and
 *  is mapped through every change made to the words. */
const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

/** A view without a DOM: the state it holds, the transactions it is handed, and
 *  where it is scrolled. Everything `HeldState` asks of a view. */
class Surface implements StateView {
  state: EditorState
  /** What was done to it, in order. The order is the point of the swap: a state
   *  and then one transaction, with nothing in between for a frame to paint. */
  readonly done: string[] = []
  /** Where the reader has got to, in document positions. */
  at = 0
  /** The element that scrolls, as far as a swap looks at it. */
  readonly scrollDOM = { scrollTop: 0 }

  constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [history(), sharing()] })
  }

  setState(next: EditorState) {
    this.state = next
    this.done.push('state')
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    this.done.push('dispatch')

    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
}

/** A state that can join a document, the way a real one built by `editorState`
 *  can. Caret included, since a note reopening has to land on it. */
function stateFor(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
    extensions: [history(), sharing()],
  })
}

describe('a note waiting its turn', () => {
  test('takes every change made to the words while it waits', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))

    note.replace('Hello there')

    expect(held.state.doc.toString()).toBe('Hello there')
  })

  test('keeps its caret where the words moved it to', () => {
    const note = new SharedDoc('one\ntwo')
    const held = HeldState.waiting(note, stateFor('one\ntwo', 4))

    note.edit([{ from: 0, to: 0, insert: 'zero\n' }])

    expect(held.state.selection.main.head).toBe(9)
    expect(held.state.doc.lineAt(9).text).toBe('two')
  })

  test('carries its place along with the words above it', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'), scrolledTo.of(8))

    note.edit([{ from: 0, to: 0, insert: 'zero\n' }])

    const shown = new Surface('')
    held.give(shown)

    // The line that was at the top is still the line at the top, five characters
    // further into the note than it was.
    expect(shown.at).toBe(13)
  })

  test('lets the document go when its tab closes', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    expect(note.panes).toBe(1)

    held.release()

    expect(note.panes).toBe(0)
  })
})

describe('showing a note in a view', () => {
  test('puts the state in and the place on, and nothing in between', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree', 4), scrolledTo.of(4))
    const view = new Surface('something else')

    held.give(view)

    // One state and one transaction: no frame can be painted between them, so
    // the note is never shown at a place it was not left at.
    expect(view.done).toEqual(['state', 'dispatch'])
    expect(view.state.doc.toString()).toBe('one\ntwo\nthree')
    expect(view.state.selection.main.head).toBe(4)
    expect(view.at).toBe(4)
  })

  test('hands the document over to the view', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)
    note.replace('Hello there')

    expect(view.state.doc.toString()).toBe('Hello there')
    // One holder, not two: a state and a view both joined would each be sent the
    // other's changes.
    expect(note.panes).toBe(1)
  })

  test('says whose document the view is now holding', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)

    expect(sharedOf(view.state)).toBe(note)
  })

  test('takes it back with wherever the reader had got to', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'))
    const view = new Surface('')

    held.give(view)
    view.at = 8
    held.take(view)

    const other = new Surface('')
    held.give(other)

    expect(other.at).toBe(8)
  })

  test('goes back on a view without a word of the note being written again', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)
    held.take(view)
    view.done.length = 0
    held.give(view)

    // A state that is already this document's is not told so again: the swap and
    // the one transaction are all a switch costs.
    expect(view.done).toEqual(['state', 'dispatch'])
  })

  test('a note nobody has read shows at its top, with no transaction at all', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')
    // The scroller is the same element whichever note is in it, and the last one
    // was being read half way down.
    view.scrollDOM.scrollTop = 1200

    held.give(view)

    expect(view.done).toEqual(['state'])
    expect(view.scrollDOM.scrollTop).toBe(0)
  })

  test('a note that was being read is not dragged to its top', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'), scrolledTo.of(8))
    const view = new Surface('')
    view.scrollDOM.scrollTop = 1200

    held.give(view)

    expect(view.scrollDOM.scrollTop).toBe(1200)
    expect(view.at).toBe(8)
  })
})

/** The swap, asked of the two notes rather than of the pane doing it.
 *
 *  A pane's view shows one note at a time, and what used to make that true was the
 *  pane remembering to take the last note back before handing the view to the next
 *  one. Emil, on the desktop app: *"switched from a web note tab to a normal note
 *  tab and then it had some strange web note tab content in it."* That is the
 *  taking-back not having happened - the old note still holding the view, and every
 *  change made to it since arriving in the note that is now up. The two notes settle
 *  it between them now, so there is nothing for a pane to forget. */
describe('a view moving from one note to another', () => {
  test('is on the note it moved to and on nothing else', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('[InternetShortcut]\nURL=https://a.example\n')
    const view = new Surface('')

    HeldState.waiting(here, stateFor('the note')).give(view)
    // No `take`: the pane hands the view straight to the other note.
    HeldState.waiting(there, stateFor('[InternetShortcut]\nURL=https://a.example\n')).give(view)

    expect(documentOf(view)).toBe(there)
    expect(here.panes).toBe(0)
  })

  test('never hears from the note it came from again', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('[InternetShortcut]\nURL=https://a.example\n')
    const view = new Surface('')

    HeldState.waiting(here, stateFor('the note')).give(view)
    HeldState.waiting(there, stateFor('[InternetShortcut]\nURL=https://a.example\n')).give(view)

    // The website's file is rewritten as the reading moves on, and the note is
    // written to by whatever else has it open.
    there.replace('[InternetShortcut]\nURL=https://b.example\n')
    here.replace('the note, changed')

    expect(view.state.doc.toString()).toBe('[InternetShortcut]\nURL=https://b.example\n')
  })

  test('costs the swap and one transaction, however many notes it has been on', () => {
    const here = new SharedDoc('one\ntwo\nthree')
    const there = new SharedDoc('four\nfive')
    const view = new Surface('')

    const first = HeldState.waiting(here, stateFor('one\ntwo\nthree'), scrolledTo.of(4))
    const second = HeldState.waiting(there, stateFor('four\nfive'), scrolledTo.of(5))

    first.give(view)
    first.take(view)
    view.done.length = 0
    second.give(view)

    // The state, and the one transaction that carries the place: a note that is
    // already this document's is never written out again on a switch.
    expect(view.done).toEqual(['state', 'dispatch'])
    expect(view.state.doc.toString()).toBe('four\nfive')
  })

  test('hands the note back to the state waiting, and the view to the next note', () => {
    const here = new SharedDoc('one\ntwo\nthree')
    const there = new SharedDoc('four')
    const view = new Surface('')

    const first = HeldState.waiting(here, stateFor('one\ntwo\nthree'))
    first.give(view)
    view.at = 8
    first.take(view)

    expect(documentOf(first)).toBe(here)
    expect(documentOf(view)).toBeNull()

    HeldState.waiting(there, stateFor('four')).give(view)
    // The note it left goes on being written to, and reaches the state waiting
    // rather than the view that has moved on.
    here.replace('one\ntwo\nthree\nfour')

    expect(view.state.doc.toString()).toBe('four')
    expect(first.state.doc.toString()).toBe('one\ntwo\nthree\nfour')
  })
})
