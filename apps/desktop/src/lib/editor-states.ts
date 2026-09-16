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
 *  Almost always the tab alone would say which note this is. The exception is the
 *  one tab that previews a note: it moves on to another note without becoming
 *  another tab, and the note it moves to has its own caret and its own place. A
 *  rename does not count, which is why this is how many notes the document has
 *  held rather than which path it is on. */
export interface NoteTab {
  readonly note: { readonly live: SharedDoc; readonly arrivals: number }
}

/** What a pane is keeping for one tab: the state, and which of that tab's notes
 *  it is a state of. */
interface Kept {
  /** How many notes the tab's document had held when this was built. A tab that
   *  has moved on since is showing another note, and this caret, these folds and
   *  this place are the note it came from's. */
  readonly arrivals: number
  readonly state: HeldState
  /** What the state is already configured for: the modes, and the keyboard. See
   *  `fitted`. */
  stamp: string | undefined
}

/** How many notes a tab's document has held, read without the reader following it.
 *
 *  Every method here is called from an effect, and a tab is a rune: read plainly,
 *  this makes whoever called it follow the one tab that previews a note. The effect
 *  that builds the pane's editor did exactly that, through the key it named states
 *  by - so every click in the file list tore the pane's editor down and built
 *  another, with every other tab's state in that pane thrown away.
 *
 *  A pane does have to hear about it, and `shows` below is where it does: the one
 *  method that follows the note, called from the one effect that wants to. Nothing
 *  else here adds a dependency behind its caller's back. */
function arrivalsOf(tab: NoteTab): number {
  return untrack(() => tab.note.arrivals)
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
    // Read first and always. An `&&` that can stop before it is an effect that
    // registers the dependency on some runs and not others - and the run it would
    // skip is the pane sitting on another tab, which is exactly when the preview
    // tab is free to move on to another note.
    const arrivals = tab.note.arrivals
    const kept = this.held.get(tab)

    return kept !== undefined && kept === this.shown && kept.arrivals === arrivals
  }

  /** The note the pane's view was built on; see `HeldState.shownIn`. `place` is
   *  where that note was last being read, which the first `show` settles. */
  started(tab: NoteTab, view: StateView, place: StateEffect<unknown> | null) {
    const kept: Kept = {
      arrivals: arrivalsOf(tab),
      state: HeldState.shownIn(tab.note.live, view, place),
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
    // A tab that has moved on to another note: whatever is kept for it is the
    // note it came from's, and none of it - the caret, the folds, the place -
    // belongs to the note that is there now.
    const had = this.held.get(tab)
    const stale = had && had.arrivals !== arrivalsOf(tab) ? had : undefined
    const known = stale ? undefined : had

    const next =
      known ?? ({ arrivals: arrivalsOf(tab), state: build(), stamp: undefined } satisfies Kept)
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
