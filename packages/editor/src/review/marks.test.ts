import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { type DocView, SharedDoc, sharing } from '../shared'
import {
  type ReviewMark,
  reviewMarks,
  reviewMarksOf,
  setReviewMarks,
  setReviewSource,
} from './marks'

/** A pane without a DOM, joined to a note the way an editor is. */
class Pane implements DocView {
  state: EditorState

  constructor(note: SharedDoc) {
    this.state = EditorState.create({ doc: note.text, extensions: [sharing(), reviewMarks()] })
    note.join(this)
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
  }

  type(at: number, insert: string) {
    const made = this.state.update({ changes: { from: at, insert } })
    this.state = made.state
  }
}

const change: ReviewMark = { id: 'a:1', from: 4, to: 7, removed: 'two' }

describe('the review’s marks', () => {
  test('arrive whole, and follow the words through typing', () => {
    const note = new SharedDoc('one TWO three')
    const pane = new Pane(note)
    note.announce([setReviewMarks.of([change])])
    expect(reviewMarksOf(pane.state)).toEqual([change])

    pane.type(0, '> ')
    expect(reviewMarksOf(pane.state)).toEqual([{ ...change, from: 6, to: 9 }])

    // Typing right after the agent's words is not the agent's.
    pane.type(9, '!')
    expect(reviewMarksOf(pane.state)).toEqual([{ ...change, from: 6, to: 9 }])

    note.announce([setReviewMarks.of([])])
    expect(reviewMarksOf(pane.state)).toEqual([])
  })

  test('are asked for by a view that joins a note later, as a reopened one does', () => {
    const note = new SharedDoc('one TWO three')
    setReviewSource((doc) => (doc === note ? [change] : []))
    const pane = new Pane(note)
    expect(reviewMarksOf(pane.state)).toEqual([change])
    expect(reviewMarksOf(new Pane(new SharedDoc('else')).state)).toEqual([])
  })

  test('leave out a change with nothing left of it', () => {
    const note = new SharedDoc('one three')
    const pane = new Pane(note)
    note.announce([setReviewMarks.of([{ id: 'b', from: 3, to: 3, removed: '' }])])
    expect(reviewMarksOf(pane.state)).toEqual([])
  })
})
