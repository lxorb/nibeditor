/** A note's editor state while no view is showing it.
 *
 *  A pane has one view and as many notes as it has tabs. Rather than build a
 *  view for every tab and throw it away on the next switch - which costs the
 *  whole editor, loses the parse and paints the note at the top of itself before
 *  the place it was left at can be put back - each tab keeps a state, and
 *  switching swaps the state into the pane's one view.
 *
 *  Two things have to survive being off screen. The words: a state waiting its
 *  turn stays joined to the document (see shared.ts), so a keystroke in the
 *  other pane, an undo or a note a sync brought over reaches it as the change it
 *  was, and every position it holds is mapped through. And the place: where the
 *  note was being read, kept as CodeMirror's own scroll snapshot - a line and
 *  the offset into it, rather than a pixel count that means a different line
 *  once the window is another width. */

import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state'
import type { DocView, SharedDoc } from './shared'

/** As much of a view as a swap needs: the state it is holding, a way to hand it
 *  another one, and where it is scrolled to. A CodeMirror `EditorView` is one; so
 *  is what a test without a DOM hands over. */
export interface StateView extends DocView {
  setState(state: EditorState): void
  scrollSnapshot(): StateEffect<unknown>
  /** The element that scrolls. A view outlives the note in it, and so does its
   *  scroller: a note that opens at its top has to say so. */
  readonly scrollDOM: { scrollTop: number }
}

export class HeldState implements DocView {
  private held: EditorState
  /** Where the note was left, as an effect a view can be handed. Null for a note
   *  nobody has read yet, which opens at its top. */
  private place: StateEffect<unknown> | null

  private constructor(
    private readonly note: SharedDoc,
    state: EditorState,
    place: StateEffect<unknown> | null,
  ) {
    this.held = state
    this.place = place
  }

  /** A note no view is showing. It joins the document at once, so it hears about
   *  every change made to the words while it waits. `place` is where the note was
   *  last being read, and null for one nobody has opened.
   *
   *  Built with a state rather than a document because the state is the app's to
   *  configure: which callbacks, which modes, which caret. See editorState. */
  static waiting(
    note: SharedDoc,
    state: EditorState,
    place: StateEffect<unknown> | null = null,
  ): HeldState {
    const held = new HeldState(note, state, place)
    note.join(held)
    return held
  }

  /** The note a view was built on. The view is what is joined to the document,
   *  so this joins nothing; it only exists to be taken back when the pane moves
   *  on to another note, and to hold the place until the pane settles it. */
  static shownIn(
    note: SharedDoc,
    view: StateView,
    place: StateEffect<unknown> | null = null,
  ): HeldState {
    return new HeldState(note, view.state, place)
  }

  get state(): EditorState {
    return this.held
  }

  /** A change the document is carrying into this state. */
  dispatch(spec: TransactionSpec) {
    const made = this.held.update(spec)
    this.held = made.state

    // The place names a position in the note, so words inserted above it move
    // it along: without this, a note typed into in the other pane would come
    // back scrolled by however much was written above the fold.
    // A change that maps the place away - the line it named was deleted - leaves
    // the note with none, which reads as its top.
    if (this.place && !made.changes.empty) this.place = this.place.map(made.changes) ?? null
  }

  /** Puts this note into a view, with everything the app wants said about it in
   *  the same breath.
   *
   *  One state swap and one transaction, both while the click that asked for it
   *  is still being handled. CodeMirror measures and scrolls before the frame is
   *  painted, so the note appears already where it was left rather than at its
   *  top for a frame or two. */
  give(view: StateView, effects: readonly StateEffect<unknown>[] = []) {
    // The view takes this state's place at the document, in one move the document
    // makes for itself: two of them holding the same words would each be sent the
    // other's changes, and a view left on the note it came from would be sent that
    // note's. See `handOver` in shared.ts.
    this.note.handOver(this, view, () => {
      view.setState(this.held)
      // A note nobody has read opens at its top. The scroller is the same element
      // whichever note is in it, so without this the note would arrive at however
      // far down the last one was.
      if (!this.place) view.scrollDOM.scrollTop = 0
    })
    this.settle(view, effects)
  }

  /** The place and everything the app has to say, in one transaction, into a view
   *  already holding this state. What `give` finishes with, and what a view built
   *  on this note in the first place needs on its own. */
  settle(view: StateView, effects: readonly StateEffect<unknown>[] = []) {
    const all = this.place ? [this.place, ...effects] : effects
    if (all.length) view.dispatch({ effects: [...all] })
  }

  /** Takes the note back when the view moves on to another one, with wherever
   *  the reader had got to in it. The other half of `give`, and the same one
   *  move: the document goes from the view to this state, with this state's
   *  words being what the view was holding. */
  take(view: StateView) {
    this.note.handOver(view, this, () => {
      this.held = view.state
      this.place = view.scrollSnapshot()
    })
  }

  /** Lets the document go, for a tab that has closed. */
  release() {
    this.note.leave(this)
  }
}
