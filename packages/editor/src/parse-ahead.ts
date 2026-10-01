/** The note parsed as far as the reader can see, before it is drawn there.
 *
 *  The language parses a note in slices, in the moments the page has nothing better to
 *  do, from the top down; what it has not reached yet is drawn as the characters it is
 *  made of - `##` in front of a heading, the brackets around a link - and redrawn as the
 *  parse arrives. From the top of a note that is never seen: the first screenful is
 *  parsed with the state. A note opened where it was left is opened in its middle, and
 *  on a launch the idle moments are the launch's own, so on a slow machine the place a
 *  reader came back to stood there raw for a third of a second, and then every heading
 *  on it grew and pushed the rest down. So whenever the visible part runs past the
 *  parse, the parse is taken there at once - within a budget, since a note long enough
 *  to take longer than that is drawn raw for as long as it ever was, rather than the
 *  page waiting for it. */

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** How long one catch-up may hold the page, in milliseconds: under a frame's worth of
 *  the fifty a long task starts at, and enough for a note of a hundred kilobytes. */
const BUDGET = 25

/** And how long the parse may run on as the editor is built: part of that task, which
 *  is the one long task a launch has leave to be (see test/e2e/long-tasks.py), so a slow
 *  machine finishes a note of ordinary length in it rather than a frame later. */
const AS_BUILT = 60

/** Whether the tree the note is drawn from reaches the end of what is on screen. The
 *  state's own tree, not the parse behind it, which can be further along: what is
 *  drawn is drawn from the state. */
const drawnThrough = (view: EditorView) => syntaxTree(view.state).length >= view.viewport.to

class ParseAhead {
  private gone = false

  /** The note parsed as far as a budget goes as its editor is built, in the same task:
   *  a note is opened where it was left more often than at its top, and where it was
   *  left is only known once the first measure has scrolled there. */
  constructor(view: EditorView) {
    ensureSyntaxTree(view.state, view.state.doc.length, AS_BUILT)
    this.check(view)
  }

  update(update: ViewUpdate) {
    if (update.viewportChanged || update.docChanged) this.check(update.view)
  }

  destroy() {
    this.gone = true
  }

  /** In the measure that follows, which is where a note opened at its place has just
   *  been scrolled there, so the part to parse is the part on screen; and the tree
   *  handed to the state straight after that measure, before the frame is painted - a
   *  transaction cannot be dispatched from inside the measure itself. A part that takes
   *  longer than the budget is parsed a budget a frame, on from where the last one
   *  stopped, rather than left for a moment the launch never gives. */
  private check(view: EditorView) {
    if (this.gone || drawnThrough(view)) return

    view.requestMeasure({
      key: this,
      read: () => null,
      write: () => {
        if (drawnThrough(view)) return

        const tree = ensureSyntaxTree(view.state, view.viewport.to, BUDGET)
        if (!tree) {
          requestAnimationFrame(() => this.check(view))
          return
        }
        if (tree === syntaxTree(view.state)) return
        queueMicrotask(() => {
          if (!this.gone) view.dispatch({})
        })
      },
    })
  }
}

export const parseAhead = ViewPlugin.fromClass(ParseAhead)

/** Whether what the view shows is parsed, and so drawn as it reads rather than as the
 *  characters it is made of. */
export function parsedOnScreen(view: EditorView): boolean {
  return drawnThrough(view)
}
