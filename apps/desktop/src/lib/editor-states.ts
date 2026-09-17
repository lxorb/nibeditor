/** The editor state of every note one pane has open.
 *
 *  A pane has one editor and a strip of tabs. Switching used to build a whole
 *  new editor for the note being switched to, which cost the extensions, the
 *  parse and the first layout, and painted the note at its top before the place
 *  it was left at could be put back. Here each tab keeps its state instead, and
 *  a switch is a swap: see held.ts in the editor package.
 *
 *  One of these per pane, because a tab lives in exactly one pane.
 *
 *  Everything here is held by the thing itself - the tab, and the state the view
 *  is showing - rather than by a name for it. A name has to be spelled the same
 *  way by everyone who uses it, and the one on show was named by a string two
 *  files apart had to agree on: when they disagreed, the note the view was
 *  actually holding was nobody's to take back, and it stayed at its document
 *  while the pane moved on. The document refuses that now (see `join` in
 *  shared.ts) and this no longer asks it to. */

import { untrack } from 'svelte'
import { HeldState, letGo, type SharedDoc, type StateEffect, type StateView } from '@nib/editor'

/** As much of a tab as a pane's states need: the document it is a view of, and
 *  how many notes that document has held.
 *
 *  Almost always the tab alone would say which note this is. There are two
 *  exceptions and a tab has both. The one tab that previews a note moves on to
 *  another note without becoming another tab, which is what the count is for; a
 *  rename does not move it on, which is why it counts notes rather than naming a
 *  path. And any tab can be pointed at another document - walking back along a
 *  trail to a note another pane already has open makes the tab a second view of
 *  that document, because one file is one document and there is nothing else for
 *  it to be. That one the count cannot see: the new document has held as many
 *  notes as the old. */
export interface NoteTab {
  readonly note: { readonly live: SharedDoc; readonly arrivals: number }
}

/** What a pane is keeping for one tab: the state, and which of that tab's notes
 *  it is a state of.
 *
 *  Which note that is, is the document and the count together. Either of them
 *  having moved means this caret, these folds and this place are the note the tab
 *  came from's, and none of it belongs to the note that is there now. */
interface Kept {
  /** The document this is a state of, held as the thing rather than as a name
   *  for it - the same argument as `shown` below. */
  readonly note: NoteTab['note']
  /** And how many notes that document had held when this was built. */
  readonly arrivals: number
  readonly state: HeldState
  /** What the state is already configured for: the modes, and the keyboard. See
   *  `fitted`. */
  stamp: string | undefined
}

/** Which note a tab is on - the document, and how many notes it has held - read
 *  without the reader following it.
 *
 *  Every method here is called from an effect, and both of those are runes: read
 *  plainly, this makes whoever called it follow a tab moving on to another note.
 *  The effect that builds the pane's editor did exactly that, through the key it
 *  named states by - so every click in the file list tore the pane's editor down
 *  and built another, with every other tab's state in that pane thrown away.
 *
 *  A pane does have to hear about it, and `shows` below is where it does: the one
 *  method that follows the note, called from the one effect that wants to. Nothing
 *  else here adds a dependency behind its caller's back.
 *
 *  Both in one read, so the two cannot be taken a moment apart and disagree. */
function noteOf(tab: NoteTab): { note: NoteTab['note']; arrivals: number } {
  return untrack(() => ({ note: tab.note, arrivals: tab.note.arrivals }))
}

export class EditorStates {
  private readonly held = new Map<NoteTab, Kept>()
  /** What the view is showing, held as the thing rather than as a name for it:
   *  a name can go missing from the map, and the note the view is holding would
   *  then be nobody's to take back. */
  private shown: Kept | null = null
  /** Whether the note on show has had its place put back. Only the first note a
   *  pane shows can be waiting for that, and putting a place back twice would
   *  scroll a reader who had moved on back to where they came in. */
  private settled = false

  /** How many notes are being kept. What the tests count. */
  get count(): number {
    return this.held.size
  }

  /** Whether the view is showing this tab, on the note it is on now. False for a
   *  tab that has moved on since, because that is a switch like any other.
   *
   *  The one method here that reads the tab plainly, so an effect asking this
   *  follows the note. That is what a pane wants of this question and of no other:
   *  the effect that shows a note has to run again when the one tab that previews
   *  a note moves on, and the effect that builds the editor must not. */
  shows(tab: NoteTab): boolean {
    // Read first and always, both of them. An `&&` that can stop before one is an
    // effect that registers the dependency on some runs and not others - and the
    // run it would skip is the pane sitting on another tab, which is exactly when
    // a tab is free to move on to another note.
    const note = tab.note
    const arrivals = note.arrivals
    const kept = this.held.get(tab)

    return (
      kept !== undefined && kept === this.shown && kept.note === note && kept.arrivals === arrivals
    )
  }

  /** The note the pane's view was built on; see `HeldState.shownIn`. `place` is
   *  where that note was last being read, which the first `show` settles. */
  started(tab: NoteTab, view: StateView, place: StateEffect<unknown> | null) {
    const on = noteOf(tab)
    const kept: Kept = {
      note: on.note,
      arrivals: on.arrivals,
      state: HeldState.shownIn(on.note.live, view, place),
      stamp: undefined,
    }

    this.held.set(tab, kept)
    this.shown = kept
  }

  /** What the state kept for a tab is already configured for: the modes, and the
   *  keyboard. Undefined for a note this pane has not shown yet.
   *
   *  Reconfiguring an editor is not free - a fresh markdown language throws the
   *  parse away, and fresh view plugins redraw everything on screen - so a switch
   *  only does it when the answer here is not what the app holds now. */
  fitted(tab: NoteTab): string | undefined {
    return this.held.get(tab)?.stamp
  }

  /** Says the state kept for a tab is now configured for `stamp`. */
  fit(tab: NoteTab, stamp: string) {
    const kept = this.held.get(tab)
    if (kept) kept.stamp = stamp
  }

  /** Shows a tab's note in the pane's view, building its state the first time the
   *  pane shows it.
   *
   *  `effects` is everything the app has to say about the note that is not in
   *  its state - the modes, the keys, the space's links - and it goes into the
   *  same transaction as the place the note was left at, so one frame shows all
   *  of it. Answers whether the state had to be built, which is the difference
   *  between a warm switch and a cold one. */
  show(
    view: StateView,
    tab: NoteTab,
    build: () => HeldState,
    effects: readonly StateEffect<unknown>[] = [],
  ): boolean {
    // A tab that has moved on to another note - taken one on, or been pointed at
    // the document another pane already had open: whatever is kept for it is the
    // note it came from's, and none of it - the caret, the folds, the place -
    // belongs to the note that is there now.
    const on = noteOf(tab)
    const had = this.held.get(tab)
    const moved = had && (had.note !== on.note || had.arrivals !== on.arrivals)
    const stale = moved ? had : undefined
    const known = stale ? undefined : had

    const next =
      known ??
      ({ note: on.note, arrivals: on.arrivals, state: build(), stamp: undefined } satisfies Kept)
    if (!known) this.held.set(tab, next)

    if (this.shown === next) {
      // Already up. The first time round the view was built on it and its place
      // has still to be put back, with everything else in the same transaction;
      // after that the place is where the reader left it, and only what the app
      // has to say is news.
      if (this.settled) {
        if (effects.length) view.dispatch({ effects: [...effects] })
      } else next.state.settle(view, effects)

      this.settled = true
      return !known
    }

    this.shown?.state.take(view)
    this.shown = next
    this.settled = true
    next.state.give(view, effects)

    // The state of the note the tab moved on from, once the view has finished
    // with it. Let go of here rather than left for the strip to notice: the tab
    // is not gone, the note in it is.
    stale?.state.release()

    return !known
  }

  /** Lets go of every note but these tabs': what is left after a tab has closed
   *  or been dragged to another pane. The one on show stays whatever the list
   *  says, since the view is holding it. */
  keepOnly(tabs: readonly NoteTab[]) {
    const kept = new Set(tabs)

    for (const [tab, one] of this.held) {
      if (one === this.shown || kept.has(tab)) continue

      one.state.release()
      this.held.delete(tab)
    }
  }

  /** Lets go of all of them: the pane has gone. The view lets go of whatever
   *  note it was on, because a document carrying its changes into a view that is
   *  about to be destroyed is carrying them nowhere. */
  releaseAll(view: StateView) {
    for (const one of this.held.values()) {
      if (one !== this.shown) one.state.release()
    }

    letGo(view)
    this.held.clear()
    this.shown = null
    this.settled = false
  }
}
