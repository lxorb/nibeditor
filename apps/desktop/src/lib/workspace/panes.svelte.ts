/** Which panes there are, which one has the focus, and what a drag over them
 *  would do. The shape of the tree and every operation on it is next door in
 *  pane-tree.ts; this is the state around it.
 *
 *  The focus is marked quietly, in the tab strip of the pane that has it rather
 *  than by a border around the words: a line around the text someone is writing
 *  is a line they have to read past. Everything a key or a palette command does
 *  happens in the focused pane. */

import { identifier } from '../identifier'
import {
  type Along,
  canSplit,
  clamped,
  EQUAL,
  type Frame,
  nextPane,
  pane,
  type Pane,
  paneIn,
  panesIn,
  splitIn,
  withoutPane,
  withSplit,
} from './pane-tree'
import type { Zone } from './zones'

/** Where a dragged tab or note would land: at a place in a pane's strip of tabs,
 *  in the middle of a pane, or against one of its sides, which makes a pane
 *  there. */
export type Landing =
  { kind: 'strip'; paneId: string; at: number } | { kind: 'pane'; paneId: string; zone: Zone }

/** What is being dragged over the panes, while something is. */
export interface Dragging {
  /** The tab being dragged, or null when what is moving came out of the file
   *  list rather than out of a strip. */
  tabId: string | null
}

export class Panes {
  frame = $state<Frame>(pane(identifier()))
  focusedId = $state('')

  /** The divider under a pointer, while one is, so that split follows the finger
   *  instead of easing after it. */
  sliding = $state<string | null>(null)

  /** What is being dragged over the panes, while it is. What lights the drop
   *  zones: they are there to be aimed at, and nothing else should show them.
   *
   *  Set and cleared through `dragged` and `dropped` below, never by hand. It used to be assigned
   *  at the two ends of a drag by whichever element started it, and that element
   *  is exactly what a cross-pane drop destroys: the tab moves to the other
   *  strip, Svelte tears the original row down, and the `dragend` that would have
   *  cleared this never fires on a node that is gone. The flag then stayed true
   *  for the rest of the sitting.
   *
   *  What that looks like to a reader is not a stuck drag - the zones are
   *  invisible - but a note that will not scroll. `.zone.whole` is `inset: 0` and
   *  `pointer-events: auto` over the whole pane, so it swallows every wheel; the
   *  caret still scrolls the note, because that is the app moving the scroller
   *  rather than the reader. Emil: *"note scrollbar, mouse scrolling does
   *  nothing, but when I move the cursor to the bottom it scrolls"*, in every
   *  note, until the app was restarted. See Pane.svelte. */
  dragging = $state<Dragging | null>(null)

  /** The drop zone the dragged tab is over, lit while it is. */
  landing = $state<Landing | null>(null)

  /** A drag over the panes has begun.
   *
   *  The end is listened for on the window rather than left to the element that
   *  began it, because that element may not survive the drop. `dragend` bubbles to
   *  the window when it fires at all, and `drop` covers the case where it does not
   *  fire because the node carrying it has gone. Both are once-only, so a drag
   *  cannot leave a listener behind, and starting a second drag drops the first
   *  one's listeners before adding its own.
   *
   *  One owner rather than a rule each caller follows: the zones this lights are
   *  invisible and take every wheel over the pane, so forgetting to clear it does
   *  not look like a bug in dragging. It looks like a note that will not scroll. */
  dragged(what: Dragging) {
    this.settled()
    this.dragging = what

    const done = () => {
      this.settled()
      this.dragging = null
      this.landing = null
    }

    window.addEventListener('dragend', done, { once: true })
    window.addEventListener('drop', done, { once: true })
    this.settling = () => {
      window.removeEventListener('dragend', done)
      window.removeEventListener('drop', done)
    }
  }

  /** The drag is over, however it ended. Safe to call when none is under way. */
  dropped() {
    this.settled()
    this.dragging = null
    this.landing = null
  }

  /** Takes off whatever the last drag was listening for. */
  private settled() {
    this.settling?.()
    this.settling = null
  }

  private settling: (() => void) | null = null

  /** Called whenever the arrangement changes, so the session is written down. */
  private readonly changed: () => void

  constructor(changed: () => void) {
    const first = pane(identifier())
    this.frame = first
    this.focusedId = first.id
    this.changed = changed
  }

  readonly all: Pane[] = $derived(panesIn(this.frame))
  readonly count: number = $derived(this.all.length)

  readonly focused: Pane = $derived.by(() => {
    const [first] = this.all
    // A frame always holds at least one pane, so `first` is only ever missing
    // to the compiler. A fresh one keeps the type honest without a cast.
    return paneIn(this.frame, this.focusedId) ?? first ?? pane(this.focusedId)
  })

  at(id: string): Pane | null {
    return paneIn(this.frame, id)
  }

  focus(id: string) {
    if (id === this.focusedId || !paneIn(this.frame, id)) return

    this.focusedId = id
    this.changed()
  }

  /** The next pane round. One key for all of them: with four at most, cycling
   *  is quicker to press than four directions are to remember. */
  focusNext() {
    const next = nextPane(this.frame, this.focusedId)
    if (next) this.focus(next.id)
  }

  splittable(along: Along, id: string = this.focusedId): boolean {
    return canSplit(this.frame, id, along)
  }

  /** Puts a pane beside or below one, and gives it the focus. `near` puts it on
   *  the other side: left of that pane, or above it. Answers the new pane, or
   *  null when the one being split has split as far as it may. */
  split(along: Along, id: string = this.focusedId, near = false): Pane | null {
    if (!canSplit(this.frame, id, along)) return null

    const made = pane(identifier())
    this.frame = withSplit(this.frame, id, along, made, identifier(), near)
    this.focusedId = made.id
    this.changed()

    // The pane in the tree, not the one just built: the tree is reactive state,
    // and what it holds is a proxy of what went in.
    return paneIn(this.frame, made.id)
  }

  /** Takes a pane away; its sibling takes the room. The last pane stays, since
   *  a window with no pane has nowhere to put a note. */
  close(id: string): boolean {
    if (this.count < 2) return false

    this.frame = withoutPane(this.frame, id)
    if (!paneIn(this.frame, this.focusedId)) this.focusedId = this.all[0]?.id ?? this.focusedId

    this.changed()
    return true
  }

  /** Follows the divider under the pointer. Not written down on every move: the
   *  drag ends with `settle`.
   *
   *  The share is written into the split rather than the tree being rebuilt
   *  around it, so a move is one number changing and not the whole arrangement;
   *  see `splitIn`. */
  resize(id: string, fraction: number, room: number) {
    const split = splitIn(this.frame, id)
    if (split) split.fraction = clamped(fraction, room)
  }

  settle() {
    this.sliding = null
    this.changed()
  }

  /** A double click on a divider: both sides the same again. */
  equalise(id: string) {
    const split = splitIn(this.frame, id)
    if (!split || split.fraction === EQUAL) return

    split.fraction = EQUAL
    this.changed()
  }

  /** Whether a pane scrolls with the other one on the same note. Set for both
   *  ends at once by the workspace, which is what knows they are a pair. */
  setLinked(id: string, on: boolean) {
    const one = paneIn(this.frame, id)
    if (!one || one.linked === on) return

    one.linked = on
    this.changed()
  }

  /** Whether a pane lays its notes out as columns side by side. Per pane, because two
   *  panes are two arrangements: a long note read down the left and three short ones
   *  stacked on the right is the whole point of it being a pane's own answer. */
  setStacked(id: string, on: boolean) {
    const one = paneIn(this.frame, id)
    if (!one || one.stacked === on) return

    one.stacked = on
    this.changed()
  }

  activate(id: string, tabId: string | null) {
    const one = paneIn(this.frame, id)
    if (!one || one.activeTabId === tabId) return

    one.activeTabId = tabId
    this.changed()
  }

  /** One pane again, keeping the focused one. What a phone gets, where there is
   *  no room to put two notes beside each other; the tabs are moved into it by
   *  the workspace, which is what owns them. */
  collapse() {
    if (this.count < 2) return

    const kept = this.focused
    this.frame = pane(kept.id, kept.activeTabId)
    this.focusedId = kept.id
    this.changed()
  }

  /** An arrangement read back from the session or from a saved layout. */
  restore(frame: Frame, focusedId: string) {
    this.frame = frame
    this.focusedId = paneIn(frame, focusedId) ? focusedId : (panesIn(frame)[0]?.id ?? focusedId)
  }
}
