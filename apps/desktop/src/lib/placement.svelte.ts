import { caretLine, documentOf, type EditorView, foldLines, topLine } from '@nib/editor'
import { untrack } from 'svelte'
import { onceAFrame } from './timing'
import { type Tab, workspace } from './workspace.svelte'

/** Where a note is being read, written down as it moves. A crash gives no chance
 *  to record it on the way out, so it is recorded as it happens instead.
 *
 *  Only the writing down. Putting a place back is not done here: it belongs to
 *  the state the pane swaps in, so a note appears already where it was left
 *  rather than arriving at its top and being moved a frame later. See
 *  editor-states.ts and held.ts.
 *
 *  One entry per view, because a note open in two panes is being read in two
 *  places: each pane keeps its own caret and its own place in the note, and the
 *  tab is what those belong to. */
class Placement {
  /** What each view on the page asks for when its selection moves. Deliberately
   *  not `$state`: nothing renders from it, and `follow` both writes it and
   *  reads it back, which as reactive state is a cycle - and Svelte answers a
   *  cycle by tearing down the whole render loop. */
  private readonly pending = new Map<EditorView, () => void>()

  /** What the editor calls when the selection moves. Nothing to do before a view
   *  has been placed. */
  remember(view: EditorView) {
    this.pending.get(view)?.()
  }

  /** Keeps a tab's place up to date until the pane moves on.
   *
   *  One run of this is about one note in one tab, and everything that says
   *  which note that is - the path it is at, and how many notes the tab's
   *  document has held - is read here and checked again before anything is
   *  written down. The one tab that previews a note takes another one on without
   *  becoming another tab, and a run that outlived that would write the new
   *  note's place under the old note's name.
   *
   *  Answers the teardown, so the effect that calls this can hand it straight
   *  back to Svelte. */
  follow(view: EditorView, showing: Tab): () => void {
    const id = showing.id
    const path = showing.path
    const live = showing.note.live
    const arrivals = showing.note.arrivals

    /** Nothing is recorded until the note has settled into the view. The offset a
     *  view reports before CodeMirror has measured it and scrolled it is the top
     *  of the note, which is not where the note is. */
    let placed = false

    const record = () => {
      if (!placed) return

      const tab = untrack(() => workspace.tabs.find((one) => one.id === id))
      // Still the same note, in the same tab, in this view. Any of the three
      // having moved on means this run has nothing true left to say: the pane
      // may have swapped the note out, the tab may have taken another note on,
      // and the note may have been renamed out from under both.
      if (tab?.path !== path || tab.note.arrivals !== arrivals) return
      // The note this view is on, not the one its state was last told it is about:
      // a state put away and handed back still carries the claim, and a place
      // written under the wrong note is a note reopening somewhere it never was.
      // See shared.ts in the editor package.
      if (documentOf(view) !== live) return

      workspace.noteView(
        id,
        view.state.selection.main.head,
        view.scrollDOM.scrollTop,
        topLine(view),
        caretLine(view),
        foldLines(view.state),
      )
    }

    // `topLine` measures the view, and a measurement taken straight after the
    // editor has written to the DOM makes the browser lay the document out
    // again there and then - on every keystroke, over a document that may be
    // thousands of lines. Once a frame instead: by then the layout is the one
    // on screen, and a burst of keystrokes asks for it once.
    const soon = onceAFrame(record)
    this.pending.set(view, soon)

    const settled = requestAnimationFrame(() => {
      placed = true
    })
    view.scrollDOM.addEventListener('scroll', soon, { passive: true })

    return () => {
      cancelAnimationFrame(settled)
      soon.cancel()
      view.scrollDOM.removeEventListener('scroll', soon)
      // Nothing is written down on the way out. By the time this runs the pane
      // may already hold the next note, and what the view says then is about
      // that one; the last movement in this one was written down as it happened,
      // at most a frame ago.
      placed = false
      this.pending.delete(view)
    }
  }
}

export const placement = new Placement()
