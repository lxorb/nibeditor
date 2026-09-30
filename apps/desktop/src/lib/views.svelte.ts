/** The editor each pane is showing, while it is on the page.
 *
 *  A pane builds its own editor and leaves it here, so everything that acts on
 *  "the editor" - the keyboard, the palette, the settings, the formatting bar -
 *  can ask for the one in the pane that has the focus without every component
 *  passing it down through the tree. */

import type { EditorView } from '@nib/editor'
import { SvelteMap } from 'svelte/reactivity'

class Views {
  private readonly held = new SvelteMap<string, EditorView>()

  /** What follows the selection: the formatting bar, once it is on the page.
   *  One hook rather than a prop threaded through the pane tree, which is
   *  recursive and would carry it for no other reason. */
  onSelection: ((view: EditorView) => void) | null = null

  of(paneId: string): EditorView | undefined {
    return this.held.get(paneId)
  }

  put(paneId: string, view: EditorView) {
    this.held.set(paneId, view)
  }

  /** A pane's editor taken apart. Nothing moves in a view that no longer exists, so
   *  if it was the one that reported last its selection goes with it here: the
   *  count at the foot and the passage the Ask panel quotes would otherwise go on
   *  reading a note that has closed. */
  forget(paneId: string) {
    const gone = this.held.get(paneId)
    this.held.delete(paneId)
    if (!gone || gone !== this.reporting) return

    this.reporting = null
    this.chosen = 0
  }

  /** How much is selected in the pane that reported last, in characters, or zero
   *  while nothing is. Every range, because a note may have several cursors.
   *
   *  A number and not the words themselves: a length is arithmetic on the ranges
   *  and costs nothing to keep up to date, while the words are as long as the
   *  selection and are only read when somebody is looking at the count. Which is
   *  the same rule the status bar already counts a whole note by. */
  chosen = $state(0)

  /** The view that last reported, so the words in its selection can be asked for
   *  when they are wanted. Not `$state`: nothing renders from it, and it is read
   *  inside the very derivation `chosen` drives. */
  private reporting: EditorView | null = null

  /** The selected words, joined, or the empty string while nothing is selected.
   *  Read out of the view at the moment it is asked for. */
  selectedText(): string {
    const view = this.reporting
    if (!view) return ''

    return view.state.selection.ranges
      .filter((one) => !one.empty)
      .map((one) => view.state.doc.sliceString(one.from, one.to))
      .join('\n')
  }

  /** A pane reporting that its selection moved. */
  moved(view: EditorView) {
    this.reporting = view
    this.chosen = view.state.selection.ranges.reduce((sum, one) => sum + (one.to - one.from), 0)
    this.onSelection?.(view)
  }
}

export const views = new Views()
