/** One document, however many views are looking at it.
 *
 *  A note shown in two panes is one note, and this is what makes that true.
 *  The text and the undo history live here, in a state of their own with no
 *  view attached; every view is a window onto it. A view that is typed in
 *  applies the keystroke itself, which is what keeps typing feeling immediate,
 *  and hands the change over: it is applied to the document and dispatched into
 *  every other view as the same change, mapped into that view's own state.
 *
 *  Mapped, never replaced. Replacing the text of the other view would cost a
 *  pass over the whole note on every keystroke and would take that view's
 *  caret and scroll with it; a change set is the size of what was typed, and
 *  every position the other view holds - its caret, its selection, its scroll -
 *  is mapped through it by CodeMirror for nothing.
 *
 *  The history is the document's rather than the view's, so undo means the same
 *  thing in either pane. While a view is joined here nothing it does is
 *  recorded in its own history (see `sharing` below); undo and redo are asked
 *  of the document and come back as a change like any other. */

import { history, redo, undo } from '@codemirror/commands'
import {
  type ChangeSet,
  type EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  StateEffect,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { fold } from '@nib/rooms/fold'
import { external } from './external'

/** As much of a view as a document needs: the state it is holding, and a way to
 *  hand it a change. A CodeMirror `EditorView` is one; so is a state with a
 *  dispatch, which is what a test without a DOM hands over. */
export interface DocView {
  readonly state: EditorState
  dispatch(spec: TransactionSpec): void
}

/** Which document each view is on. One entry per view, whatever else is holding
 *  a reference to it, because a view can only be looking at one note at a time.
 *
 *  Here, and owned by the document, because this is the fact that used to be
 *  spread across four files - a pane's swap, a held state being given and taken
 *  back, and the join itself - and could be forgotten in any of them. Forgetting
 *  it left a view on the note it came from as well as the note it had moved to,
 *  so that note's changes went on arriving in it: one note's words appearing in
 *  another, under the other's name, on their way to the disk. A document that
 *  takes a view off whatever it was on cannot be forgotten by anybody.
 *
 *  Weak because it is not a reason to keep a view alive: a pane that has gone is
 *  gone whether or not anything here still names its view. */
const onDocument = new WeakMap<DocView, SharedDoc>()

/** The document a view is on, which is the document whose changes reach it.
 *
 *  Not the same question as `sharedOf` below, and the one to ask. That reads a
 *  claim the view's own state is carrying, which is a copy of a fact and can
 *  outlive it - a state put away and handed to a view again still says what it
 *  said. This is the fact. */
export function documentOf(view: DocView): SharedDoc | null {
  return onDocument.get(view) ?? null
}

/** Takes a view off whatever document it is on, for a view that is going: a
 *  document carrying its changes into a view that no longer exists is carrying
 *  them nowhere. */
export function letGo(view: DocView) {
  onDocument.get(view)?.leave(view)
}

/** Which document a view is looking at. Set through the effect below rather
 *  than given at creation, because a view outlives the note in it: the one tab
 *  that previews a note moves on to another without being rebuilt. */
const setShared = StateEffect.define<SharedDoc | null>()

const sharedField = StateField.define<SharedDoc | null>({
  create: () => null,
  update: (current, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setShared)) return effect.value
    }

    return current
  },
})

/** The document a state was last told it belongs to, or null for one that owns
 *  its text alone. Absent rather than null in a state built without `sharing()`.
 *
 *  A claim rather than a fact: what this state was told, which stays true only
 *  while the view holding it is still on that document. Read it to ask what a
 *  state is *about* - whose history answers Ctrl+Z, which note a place belongs to
 *  - and never to decide whether changes may flow. `documentOf` is that one. */
export function sharedOf(state: EditorState): SharedDoc | null {
  return state.field(sharedField, false) ?? null
}

/** Where a change should leave the caret, in the one view that asked for it. */
interface Landing {
  view: DocView
  selection: EditorSelection
}

export class SharedDoc {
  /** The document itself: the text, and the history of what was done to it.
   *  No language, no decorations, nothing that draws, so applying a change to
   *  it costs the edit and not the note. */
  private state: EditorState

  private readonly views = new Set<DocView>()

  /** Called whenever the document changes, once per change however many views
   *  are open on it. The app writes the words down from here, so it hears about
   *  a keystroke in either pane exactly once. */
  onChange: ((doc: Text) => void) | null = null

  /** Called with the changes made to this note here, whatever made them: a
   *  keystroke in any pane, an undo, a version put back, a replacement run
   *  across the space. A note that has joined a room puts them into the text
   *  the room shares, which is how they reach the other devices.
   *
   *  Never called for a change the room brought over. That one is already in
   *  the shared text; handing it back would be an echo. See `arrived`. */
  onLocal: ((changes: ChangeSet) => void) | null = null

  /** How many of this note's own edits are waiting for undo, and how many for
   *  redo.
   *
   *  Counted here rather than read out of the history, because they are the guard
   *  on the history rather than a report of it. A document outlives the note in it -
   *  the one tab that previews a note takes another note on - and undo reaching one
   *  step past that is the note the tab came from appearing under the name of the
   *  note the tab is on. `takeOn` puts both back to nought, so an undo that would
   *  cross a switch has nothing to stand on even if a history somewhere still holds
   *  the step.
   *
   *  A burst of keystrokes counts as several where the history groups it into one,
   *  so these can read high. That is the safe direction: the history refuses first
   *  and this refuses nothing it should allow, while nought here means nought
   *  whatever the history thinks. */
  private ownUndo = 0
  private ownRedo = 0

  /** How many steps of this note's own are there to take back, and to put back.
   *  Zero for a document that has just taken another note on, whatever was done in
   *  the note it came from. */
  get undoable(): number {
    return this.ownUndo
  }

  get redoable(): number {
    return this.ownRedo
  }

  constructor(doc: string | Text = '') {
    this.state = EditorState.create({ doc, extensions: [history()] })
  }

  /** This document is taking on another note's words: the one tab that previews a
   *  note, moving on to the next one.
   *
   *  Two things happen, and the second is the point. The words go into every pane
   *  as the edit they are, so a view keeps its caret and its place rather than
   *  being rebuilt. And the document starts a history of its own, empty.
   *
   *  Emil, pressing Ctrl+Z after a click: *"it just inserted contents of a past
   *  note into the currently open one."* That was this. The switch went in as an
   *  ordinary edit, an edit is what undo takes back, and taking it back put the
   *  words of the note the tab came from into the document that now carries the
   *  next note's name - dirty, and on its way to the disk and the account under
   *  that name. Nothing downstream can tell: by then the text is the document's
   *  own, under its own path.
   *
   *  So the switch is not an edit anybody made, and there is nothing behind it to
   *  go back to. Every note's undo begins where the note did. */
  takeOn(text: string) {
    const held = this.state.doc.toString()

    if (held !== text) {
      const change = fold(held, text) ?? { from: 0, to: held.length, insert: text }
      // Out of the history on the way past: the views' own histories are kept
      // empty while they are joined, and this is the same fact said for the
      // document's.
      const made = this.state.update({
        changes: change,
        annotations: Transaction.addToHistory.of(false),
      })

      this.carry(made.changes, null)
    }

    // A history of its own rather than the old one emptied: a fresh state cannot
    // be holding a step from the note this document has just left.
    this.state = EditorState.create({ doc: text, extensions: [history()] })
    this.ownUndo = 0
    this.ownRedo = 0
    this.onChange?.(this.state.doc)
  }

  /** The rope, for a view being built on it and for anyone who wants the words.
   *  Turning it into a string is the caller's decision, and costs a pass. */
  get text(): Text {
    return this.state.doc
  }

  /** How many views are on it. Two is the same note in two panes. */
  get panes(): number {
    return this.views.size
  }

  /** Takes a view on, off whatever it was on before.
   *
   *  Both halves, always, because a view looking at two notes is the one thing
   *  that must not happen: the note it came from would go on carrying its changes
   *  into it, and those words would be written down under the name of the note it
   *  moved to. Joining is the only way in, so there is no way in that skips it.
   *
   *  Its text is brought to the document's, which is what a view built for another
   *  note and pointed at this one needs; a view built from `text` above holds the
   *  very rope this document holds, so the comparison is an identity check and
   *  there is nothing to put in. */
  join(view: DocView) {
    // Already ours. It has had every change since it joined - membership is what
    // decides that, and this document is what keeps it - so there is nothing to
    // tell it and nothing to compare.
    if (onDocument.get(view) === this) {
      this.views.add(view)
      return
    }

    onDocument.get(view)?.leave(view)
    this.views.add(view)
    onDocument.set(view, this)

    const same = view.state.doc.eq(this.state.doc)
    view.dispatch({
      ...(same ? {} : { changes: { from: 0, to: view.state.doc.length, insert: this.state.doc } }),
      effects: setShared.of(this),
      annotations: external.of(true),
    })
  }

  /** This document changes hands: `leaving` stops following it, `taking` starts,
   *  and `move` in between is what puts this document's words into `taking`.
   *
   *  One call rather than a leave and a join around a swap, because which of the
   *  two is following is one fact, and a fact told in two halves is a fact that
   *  can be half told. It is also what makes the swap free: `leaving` was
   *  following, so the words `move` has just put into `taking` are this document's
   *  own, and there is nothing to compare. Where `leaving` turns out not to have
   *  been following, `taking` comes in the ordinary way above and is brought up to
   *  the words like any other newcomer.
   *
   *  See held.ts: a pane's one view and the state waiting its turn hand this
   *  document back and forth on every switch. */
  handOver(leaving: DocView, taking: DocView, move: () => void) {
    const followed = onDocument.get(leaving) === this
    this.leave(leaving)
    move()

    if (!followed) {
      this.join(taking)
      return
    }

    onDocument.get(taking)?.leave(taking)
    this.views.add(taking)
    onDocument.set(taking, this)

    // Only where it is not already carrying the claim, which it is whenever it has
    // just been handed a state of this document's.
    if (sharedOf(taking.state) !== this) {
      taking.dispatch({ effects: setShared.of(this), annotations: external.of(true) })
    }
  }

  /** Lets a view go. The view keeps the text it has: whether it is about to be
   *  destroyed or pointed at another note is the caller's business. */
  leave(view: DocView) {
    this.views.delete(view)
    if (onDocument.get(view) === this) onDocument.delete(view)
  }

  /** A change a view made. Applied to the document and to the other views.
   *
   *  The selection is the one the view that typed ended up with, and it goes on
   *  the document too, so undoing this edit later comes back to where it was
   *  made rather than to wherever another pane happens to be. */
  local(changes: ChangeSet, selection: EditorSelection, from: DocView) {
    this.state = this.state.update({ changes, selection }).state

    this.did()
    this.carry(changes, from)
    this.made(changes)
  }

  /** Text put into the document from outside: a version restored, a note a sync
   *  brought over, a rename that rewrote the title. Undoable, the way it is in
   *  a single view.
   *
   *  Put in as the difference rather than as the whole text, for the reason
   *  `edit` below gives: a change covering the note takes every caret in every
   *  pane with it, while the piece that actually differs leaves them all where
   *  they were. It is also what makes this safe in a room - a change that named
   *  the whole note would take out every character and put it back, and whatever
   *  another device was writing would go with them. */
  /** `recorded` is whether this is a step for undo to stop at, which is whether
   *  anybody asked for it. A version put back from the history sheet is one and has
   *  to be undoable, the way it is in a single view. A note re-read from disk after
   *  another program wrote it is not: nobody typed it, the note is as saved
   *  afterwards as it was before, and a Ctrl+Z that put the file's old words back
   *  under the same name would be the app inventing an edit. */
  replace(text: string, recorded = true) {
    const held = this.state.doc.toString()
    if (held === text) return

    const change = fold(held, text) ?? { from: 0, to: held.length, insert: text }
    const made = this.state.update({
      changes: change,
      ...(recorded ? {} : { annotations: Transaction.addToHistory.of(false) }),
    })

    this.state = made.state
    if (recorded) this.did()
    this.carry(made.changes, null)
    this.made(made.changes)
  }

  /** A step of this note's own went into the history. Whatever could have been put
   *  back is gone, exactly as it is in the history itself. */
  private did() {
    this.ownUndo++
    this.ownRedo = 0
  }

  /** Changes made to the document from outside, as the ranges that actually
   *  changed: a replacement run across the whole space, and putting one back.
   *
   *  Not `replace` above, which is the whole text at once. Every position each
   *  view holds is mapped through a change set, and a change set covering the
   *  document maps every caret in it to the same place; the words that changed
   *  leave every caret but the ones inside them where they were. */
  edit(changes: readonly { from: number; to: number; insert: string }[]) {
    const made = this.state.update({ changes })

    this.state = made.state
    this.did()
    this.carry(made.changes, null)
    this.made(made.changes)
  }

  /** Words another device wrote, brought over by the room this note has joined.
   *
   *  Like `edit` in what it does to the text and to every pane's caret, and
   *  unlike it in two ways. It is not handed back to the room, which already has
   *  it. And it is kept out of the history: pressing undo takes back what you
   *  wrote, never what somebody else did, which is what undo has to mean when
   *  two people are writing at once. */
  arrived(changes: readonly { from: number; to: number; insert: string }[]) {
    const made = this.state.update({
      changes,
      annotations: Transaction.addToHistory.of(false),
    })

    this.state = made.state
    this.carry(made.changes, null)
    this.onChange?.(this.state.doc)
  }

  /** Something to say to every view of this note that is not a change to the
   *  words: who else is in it, and where their carets are. Held states hear it
   *  too, so a tab switched back to already has them. */
  announce(effects: readonly StateEffect<unknown>[]) {
    if (!effects.length) return

    for (const view of this.views) {
      view.dispatch({ effects: [...effects], annotations: external.of(true), filter: false })
    }
  }

  undo(asked: DocView): boolean {
    // Nothing of this note's own to take back. Refused here rather than left to
    // the history, which is the guard: a step from the note this document used to
    // hold is not a step this note has, whatever is still lying in a field
    // somewhere. See `undoable`.
    if (!this.ownUndo) return false
    if (!this.step(undo, asked)) return false

    this.ownUndo--
    this.ownRedo++
    return true
  }

  redo(asked: DocView): boolean {
    if (!this.ownRedo) return false
    if (!this.step(redo, asked)) return false

    this.ownRedo--
    this.ownUndo++
    return true
  }

  /** Undo or redo, on the document's own history. The pane that asked follows
   *  the caret to what changed, because that is what undo means to whoever
   *  pressed it; the other panes take the change and keep their place. */
  private step(command: StateCommand, asked: DocView): boolean {
    // Held in an object rather than a variable: the compiler cannot see that
    // the dispatch below runs before the next line, and would read a plain
    // `let` as still null.
    const made: { transaction: Transaction | null } = { transaction: null }

    const ran = command({
      state: this.state,
      dispatch: (transaction) => {
        made.transaction = transaction
      },
    })

    const done = made.transaction
    if (!ran || !done) return false

    this.state = done.state
    this.carry(done.changes, null, { view: asked, selection: done.state.selection })
    this.made(done.changes)
    return true
  }

  /** A change made here, reported once: to the app, which writes the words down,
   *  and to the room, which carries them to the other devices. */
  private made(changes: ChangeSet) {
    this.onLocal?.(changes)
    this.onChange?.(this.state.doc)
  }

  /** One change into every view except the one it came from.
   *
   *  Nothing here may be refused. A view that turned a change down - reading
   *  mode refuses anything nobody typed, a filter of any other kind - would
   *  hold a document that is no longer this one, so the filters are skipped
   *  rather than trusted to agree. */
  private carry(changes: ChangeSet, from: DocView | null, landing?: Landing) {
    for (const view of this.views) {
      if (view === from) continue

      view.dispatch({
        changes,
        ...(landing?.view === view ? { selection: landing.selection, scrollIntoView: true } : {}),
        annotations: external.of(true),
        filter: false,
      })
    }
  }
}

/** What a view needs to be able to join a document.
 *
 *  The history is the second half of it. While a view is joined, every
 *  transaction it makes is kept out of its own history: the document's is the
 *  one that answers Ctrl+Z, and two histories over one text would undo the same
 *  keystroke twice. CodeMirror still maps what a history holds through every
 *  change that arrives, so a view that leaves and goes back to owning its text
 *  starts from an empty history rather than a stale one. */
export function sharing(): Extension {
  return [
    sharedField,
    EditorState.transactionExtender.of((transaction) =>
      sharedOf(transaction.startState) ? { annotations: Transaction.addToHistory.of(false) } : null,
    ),
  ]
}

/** Undo and redo, asked of the document the view is on when there is one and of
 *  the view otherwise. What the keymap binds, so a rebound key reaches both.
 *
 *  Asked of the document the view is *on*, not of the one its state names: a
 *  Ctrl+Z is about the note in front of whoever pressed it. */
export const undoEdit: Command = (view) => {
  const shared = documentOf(view)
  return shared ? shared.undo(view) : undo(view)
}

export const redoEdit: Command = (view) => {
  const shared = documentOf(view)
  return shared ? shared.redo(view) : redo(view)
}
