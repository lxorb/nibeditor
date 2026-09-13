/** One open canvas: what is on the plane, what is picked, where it is being
 *  looked at from, and what can be taken back.
 *
 *  The file is the document. A canvas tab holds a NoteDoc like a note does, and
 *  its words are the JSON in the file, so keeping itself, Ctrl+S, the snapshot
 *  before a write and the closing question all work here without knowing a canvas
 *  exists. What this adds is a surface on top of those words instead of an editor.
 *
 *  The document is written at the end of a gesture and never during one. Dragging
 *  nine cards across the plane is one edit, one undo step and one save, not one
 *  per frame: the surface carries the offset while the pointer is down and hands
 *  the result over when it comes up. That is also what keeps a canvas of five
 *  hundred nodes at sixty frames a second, since nothing is serialised in
 *  between. The eraser is the one gesture that cannot wait - it has to answer
 *  under the nib - so it names its drag and gets the same three things anyway:
 *  one undo step, and one write once the drag has gone quiet. See `edit`.
 *
 *  Every edit stamps the things it touched with the time. Nothing else in the
 *  app has to know that, and it is what lets two devices drawing on one file keep
 *  both drawings; see canvas-merge.ts.
 *
 *  A plane in a room is the same surface with one thing added: every edit also goes
 *  into the room, and what arrives from the room is taken on the way an edit made
 *  here is. Which of the two histories undo asks is the only real difference: in a
 *  room it is the room's, so undo takes back what you drew and never what somebody
 *  else did. See shared.ts for the contract and rooms/plane.ts for the room. */

import { type Camera, clampScale, framingBox } from '../camera'
import { owes } from '../parting'
import {
  type Canvas,
  emptyCanvas,
  merged,
  readCanvas,
  stamped,
  takeParsed,
  writeCanvas,
} from './format'
import { pickedBox } from './edits'
import { viewKept, viewOf } from './place'
import { bounds } from './geometry'
import { strokeBox } from './ink'
import { afterQuiet } from '../timing'
import { CanvasHistory } from './history'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from './shared'
import type { NoteDoc, Tab } from '../workspace/documents.svelte'

/** Room left around the canvas when it is framed, in pixels. */
const PADDING = 48

/** How long after the changes stop the file is written.
 *
 *  A stroke crossing from another device has to appear at once, and so does the
 *  hole an eraser is making under the nib; serialising the whole plane is the size
 *  of the plane rather than the size of what changed, and doing that per event is
 *  the one thing a plane of five thousand strokes cannot afford. The same pause the
 *  room's own settle waits, so a device being drawn on and a device being watched
 *  write their file at the same moment. */
const WRITE_DELAY = 1_200

export class CanvasStore implements PlaneSurface {
  /** The plane as it stands. Replaced whole by every edit; see edits.ts.
   *
   *  Raw, and that is not an optimisation to be tidied away later. A canvas is
   *  thousands of objects that are never changed in place, and a deep proxy over
   *  them would wrap every stroke, every point and every card, then charge for
   *  every read of any of them. Measured on a plane of five thousand strokes, the
   *  proxy was a fifth of a second on every stroke a pen finished. */
  canvas = $state.raw<Canvas>(emptyCanvas())

  /** What is picked, by id: nodes, edges and strokes of ink together, since
   *  Delete and the colour dots mean whatever is picked. Replaced whole, like
   *  the canvas, and raw for the same reason. */
  picked = $state.raw<string[]>([])

  /** The text node being written in, while one is. One at a time: an editor is
   *  mounted only for this node, which is what keeps five hundred cards cheap. */
  editing = $state<string | null>(null)

  /** The room this plane is in, while it is in one. Raw: it is set once, when the
   *  room has said what it holds, and read for what it can do rather than for
   *  anything inside it. */
  shared = $state.raw<SharedPlane | null>(null)

  /** Whose hands are on the plane besides this one, and what each is drawing. Empty
   *  for a plane nobody else is looking at, which is the ordinary case. */
  hands = $state.raw<readonly Hand[]>([])

  /** What the room says there is to take back and to put forward. Held here rather
   *  than asked of the room, because the bar's two arrows are drawn from it and a
   *  Yjs undo stack is not something a surface can watch. */
  private reachable = $state.raw<Reachable>({ undo: false, redo: false })

  /** Whether this plane is one to look at rather than one to draw on: a space
   *  somebody shared to read.
   *
   *  A reader is on the plane and sees every stroke as it is drawn; the one thing
   *  they may not do is add one. Every gesture on a canvas ends in exactly one
   *  `edit`, so refusing there is the whole of it, and the room refuses the same
   *  thing again on its own side. */
  readOnly = $state(false)

  private readonly tab: Tab
  private readonly note: NoteDoc
  private readonly history = new CanvasHistory()
  /** Which revision of the document this surface has read. Anything past it came
   *  from somewhere else and has to be taken on; see `follow`. */
  private at = -1
  /** The file written once the changes have stopped coming; see `soon`. */
  private readonly writing = afterQuiet(() => this.commit(), WRITE_DELAY)
  /** The gesture the last edit belonged to, while one is under way; see `edit`. */
  private during: string | null = null

  constructor(tab: Tab) {
    this.tab = tab
    this.note = tab.note
    this.read()

    // Where this device left the plane, so opening the canvas again - tomorrow, or
    // after the app is started again - lands where the reading was rather than fitting
    // the whole plane. Only for a tab with no view of its own yet: a tab still open has
    // kept its camera across the switch away and back (the camera lives on the tab, not
    // here), and that one is newer than anything written down. The `!store.framed` guard
    // in Canvas.svelte keeps the opening fit off a view restored this way. See place.ts.
    if (this.tab.camera === undefined) {
      const kept = viewOf(this.tab.path)
      if (kept) this.tab.camera = kept
    }

    drawn.add(new WeakRef(this))
  }

  /** The file's words as a plane, and a plane as the file's words.
   *
   *  Overridable, and the only pair of methods that is. A page note is the same
   *  plane in the same format with pages among the objects on it, so it wants this
   *  whole class - the one edit per gesture, the one undo step, the one write once
   *  the changes stop, the room - and differs in nothing but what it does to the
   *  canvas on the way in and out: the pages are laid out in a column, and a long
   *  page grows. Which is two lines, and this is where they go. See
   *  pages/store.svelte.ts.
   *
   *  Both are the canvas format either way round, so a page note and a canvas write
   *  the same bytes and a file renamed across the two loses nothing. */
  protected parse(text: string): Canvas {
    // Whatever `openCanvas` read a task ago, where it read this one. The parse and
    // the mount used to be one task; see `parseAhead` in format.ts.
    return takeParsed(text) ?? readCanvas(text)
  }

  protected serialise(canvas: Canvas): string {
    return writeCanvas(canvas)
  }

  /** Where the file is, or null for a plane that has none.
   *
   *  Read by anything holding the store rather than the tab, which is what the
   *  outline panel's thumbnails are: a page's `file` is relative to the note, so a
   *  thumbnail cannot find the paper behind a page without knowing which note it is
   *  a page of. See pages/paper.ts. */
  get path(): string | null {
    return this.note.path
  }

  get camera(): Camera {
    return this.tab.camera ?? { x: 0, y: 0, scale: 1 }
  }

  set camera(next: Camera) {
    this.tab.camera = { ...next, scale: clampScale(next.scale) }
  }

  /** Whether the view has been settled on anything yet, so a canvas frames itself
   *  once and never again.
   *
   *  An empty plane never counts as framed: there is nothing to frame, and the
   *  cards of one a sync is bringing over arrive a moment after the tab does.
   *  Panning an empty plane does count, because that is somebody choosing where
   *  they want to be. */
  get framed(): boolean {
    return this.tab.camera !== undefined
  }

  get canUndo(): boolean {
    return this.shared ? this.reachable.undo : this.history.canUndo
  }

  get canRedo(): boolean {
    return this.shared ? this.reachable.redo : this.history.canRedo
  }

  /** The box round everything picked, or null. What the handles are drawn on. */
  get box() {
    return pickedBox(this.canvas, this.picked)
  }

  /** An edit: remembered so it can be taken back, stamped with the time so two
   *  devices can be put back together, and written into the document so it can be
   *  saved. Almost every gesture ends in exactly one of these.
   *
   *  A canvas that comes back identical is not an edit at all, which is what lets
   *  the operations in edits.ts hand back what they were given when there was
   *  nothing to do.
   *
   *  `run` names the gesture an edit belongs to, for the one kind that cannot
   *  wait for the pointer to come up: an eraser has to answer under the nib, so
   *  it edits on every point of the drag. Edits that name the same run are one
   *  thing somebody did - one step to take back.
   *
   *  Writing the plane down waits either way, and for the same reason: serialising
   *  it is the size of the plane, and the size of the plane is a hundred and fifty
   *  milliseconds on one with ten thousand strokes on it. That used to be spent on
   *  the tick the pen came up - the whole document written out, the previous one
   *  read back as a string and both of them walked character by character to work
   *  out what changed - while the hand was still moving on to the next stroke. What
   *  is on screen does not wait for any of it: the plane on screen is `canvas`, and
   *  this is the file catching up. `part` writes what is owing when the tab or the
   *  window goes. */
  edit(next: Canvas, run?: string) {
    if (next === this.canvas || this.readOnly) return

    const before = this.canvas
    const after = stamped(before, next, Date.now())
    this.canvas = after

    const carrying = run !== undefined && run === this.during
    this.during = run ?? null

    // In a room the room is the history, and what changed goes to the other devices
    // as the objects it touched. Out of one, the snapshot stack is the history.
    if (this.shared) this.shared.push(before, after)
    else if (!carrying) this.history.record(before)

    this.soon()
  }

  undo() {
    // In a room, taking something back is the room's own history: what this device
    // drew and never what somebody else did. See rooms/plane-bind.ts.
    if (this.shared) {
      this.shared.undo()
      return
    }

    const before = this.history.undo(this.canvas)
    if (!before) return

    // Stamped forwards, not restored: taking an edit back is itself an edit, and
    // a card put back with its old time would be deleted again by the next
    // device to see it.
    this.canvas = stamped(this.canvas, before, Date.now())
    this.keepPicked()
    this.commit()
  }

  redo() {
    if (this.shared) {
      this.shared.redo()
      return
    }

    const after = this.history.redo(this.canvas)
    if (!after) return

    this.canvas = stamped(this.canvas, after, Date.now())
    this.keepPicked()
    this.commit()
  }

  /** The plane as the room now says it is.
   *
   *  Taken on at once, so a stroke somebody else drew appears as they draw it, and
   *  written into the file a moment later rather than on every arrival. The room is
   *  already writing the file into the account; this is only this device's own copy
   *  of it catching up. */
  arrived(canvas: Canvas) {
    // A room carries the plane and not the file, so what arrives says nothing
    // about the icon - and this is written back to the file a moment later, which
    // would take the icon out of it.
    this.canvas = { ...canvas, icon: this.canvas.icon ?? null }
    this.keepPicked()
    this.soon()
  }

  /** The plane written down once the changes have stopped coming: a gesture that
   *  edits as it goes, or a stroke after stroke arriving from a room. Serialising
   *  the plane is the size of the plane, and doing it per event is the one thing a
   *  canvas of five thousand strokes cannot afford. */
  private soon() {
    this.writing()
  }

  /** Who else is on the plane. Held here rather than in the room because this is
   *  what the surface reads, and what a surface reads is state. */
  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs(reachable: Reachable) {
    this.reachable = reachable
  }

  /** Anything owing, written now: the room is being left, or the last tab on this
   *  plane is closing. */
  part() {
    this.writing.flush()

    // Where the reading was left, for this device: coming back to the plane, or opening
    // it again, lands here. Only once it has been framed, so an empty plane nobody moved
    // is not written down as the origin over a view it might have had. See place.ts.
    if (this.framed) viewKept(this.tab.path, this.camera)
  }

  /** Brings the surface up to words that changed under it: a version restored, a
   *  copy a sync brought over, the file undo putting one back.
   *
   *  A plane somebody has been drawing on is merged with what arrived rather
   *  than replaced by it: both drawings are kept, which is the whole point of
   *  giving everything an id. A plane nobody has touched simply takes the new
   *  words, since there is nothing of ours to keep.
   *
   *  What can be taken back is forgotten either way. Undoing past a canvas
   *  somebody else wrote would put ours over theirs, which is the one thing this
   *  must not do.
   *
   *  Answers whether it took anything on, so the caller can tell a canvas that
   *  arrived from elsewhere from one the reader is drawing. */
  follow(): boolean {
    if (this.note.revision === this.at) return false

    const arrived = this.parse(this.note.text)
    const ours = this.canvas
    // A plane in a room always has something of its own: the room's other devices
    // are holding it, so words arriving under it are one more copy to merge with
    // rather than the newest word on the subject.
    const mine = this.shared !== null || this.history.canUndo || this.note.dirty

    this.at = this.note.revision
    this.history.clear()

    if (!mine) {
      this.canvas = arrived
      this.keepPicked()
      return true
    }

    // The icon is the file's own metadata rather than anything on the plane, so
    // the words that just arrived are the newest word on it: a merge that kept
    // ours would make taking an icon away impossible while the canvas is open.
    const together = { ...merged(ours, arrived), icon: arrived.icon ?? null }
    this.canvas = together
    this.keepPicked()
    // Whatever the merge kept goes to the other devices as the edit it is.
    this.shared?.push(ours, together)

    // Written back only when the merge actually kept something of ours, so a
    // canvas that arrived unchanged does not start a round of writes.
    if (this.serialise(together) !== this.note.text) this.commit()
    return true
  }

  protected read() {
    this.canvas = this.parse(this.note.text)
    this.at = this.note.revision
    this.keepPicked()
  }

  /** The canvas into the document, which marks it unsaved and starts the clock
   *  on the auto-save. The revision is noted so `follow` can tell our own write
   *  from somebody else's. */
  protected commit() {
    this.writing.cancel()

    const text = this.serialise(this.canvas)
    // A plane that comes back saying exactly what the file says is not an edit, and
    // marking the note unsaved for it would start a round of writes over nothing.
    if (text !== this.note.text) this.note.replace(text)
    this.at = this.note.revision
  }

  /** Only the ids that still name something. A card that has gone cannot be
   *  picked, and an undo that brought one back should not leave it selected by
   *  accident either. */
  private keepPicked() {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const held = new Set([
      ...this.canvas.nodes.map((node) => node.id),
      ...this.canvas.edges.map((edge) => edge.id),
      ...this.canvas.ink.map((stroke) => stroke.id),
    ])

    const kept = this.picked.filter((id) => held.has(id))
    if (kept.length !== this.picked.length) this.picked = kept
    if (this.editing !== null && !held.has(this.editing)) this.editing = null
  }

  isPicked(id: string): boolean {
    return this.picked.includes(id)
  }

  /** A plain click picks one thing; Shift or Ctrl adds to what is picked and
   *  takes an already-picked one out again, the way a file list does. */
  pick(id: string, adding = false) {
    if (!adding) {
      if (this.picked.length !== 1 || this.picked[0] !== id) this.picked = [id]
      return
    }

    this.picked = this.isPicked(id) ? this.picked.filter((one) => one !== id) : [...this.picked, id]
  }

  /** Several at once: what a rubber band caught, or Ctrl+A. Each id once, so a
   *  band that catches something already picked does not pick it twice. */
  pickAll(ids: readonly string[], adding = false) {
    const wanted = adding ? [...this.picked, ...ids] : ids
    // Each id once, in the order they arrived. Through a set rather than by
    // looking back along the list, because a rubber band answers on every
    // pointer event and may have caught five hundred cards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const seen = new Set<string>()
    const next = wanted.filter((id) => {
      if (seen.has(id)) return false

      seen.add(id)
      return true
    })
    if (next.length === this.picked.length && next.every((id, at) => this.picked[at] === id)) return

    this.picked = next
  }

  clearPicked() {
    if (this.picked.length) this.picked = []
  }

  /** Everything on the plane in view, with room to spare. What Ctrl+0 does, and
   *  what a canvas does the first time it has anything to show.
   *
   *  An empty plane is left exactly where it is. There is nothing to fit, and
   *  leaving the view unset is also what says the canvas has not been framed yet,
   *  so the first cards to arrive are framed when they do. */
  fit(width: number, height: number) {
    const box = bounds(this.canvas.nodes, this.canvas.ink.map(strokeBox))
    if (box) this.camera = framingBox(box, width, height, PADDING)
  }

  /** Just what is picked in view, which is the other half of the same gesture:
   *  one key frames everything, the same key with something picked frames that. */
  frame(width: number, height: number) {
    const box = this.box
    if (box) this.camera = framingBox(box, width, height, PADDING)
    else this.fit(width, height)
  }
}

/** Every plane that has been opened in this window, weakly.
 *
 *  A plane's file is written once the drawing stops rather than on the tick the pen
 *  came up, and a surface going away writes what is owing itself - but a window
 *  closing tears nothing down: no effect's cleanup runs, so nothing would call
 *  `part`. Until the file is written the document is not one the workspace knows is
 *  unsaved either, so the window would not even ask.
 *
 *  Weak references, so a canvas that has been closed is collected with everything
 *  else about it and this list never keeps one alive. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; see above
const drawn = new Set<WeakRef<CanvasStore>>()

/** Every plane's file written now. Said to `parting.ts` when this module is first
 *  loaded, which is when the first canvas opens: the launch must not have to load the
 *  ink engine in order to know that a plane might owe a write. */
function flushCanvases(): void {
  for (const held of drawn) {
    const store = held.deref()
    if (store) store.part()
    else drawn.delete(held)
  }
}

owes(flushCanvases)
