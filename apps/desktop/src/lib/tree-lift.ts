/** A row lifted out of the file list and put back somewhere else: the gesture, the
 *  arithmetic under it, and the slide that gets the other rows out of the way.
 *
 *  Fetched rather than imported. The file list is the first paint - a window draws its
 *  rows before it does anything else - and none of this runs until somebody chooses
 *  the Manual order, starts a drag, or moves a row with a key. So Tree.svelte holds a
 *  seam and this is what arrives through it, the way lib/ai/ask.ts holds one in front
 *  of answering.ts. A reader who never rearranges a folder never pays for the code
 *  that would have done it.
 *
 *  Two ways in and one design. A pointer gets the drag the platform starts, which is
 *  what keeps a note draggable into a pane, onto a canvas and into a tab strip; a
 *  finger gets a press, a short hold and a move, which is the only gesture a touch
 *  screen has, since it fires no drag events at all. Both then read the same three
 *  bands, open the same gap, wait the same dwell over a folder and slide the same way.
 *
 *  The state below is this module's rather than the component's, and deliberately:
 *  there is one pointer, so there is one lift, however many file lists a window has
 *  open. What stays in the component is the one thing the component draws - which
 *  rows are being carried - because that is reactive and this is not. */

import { tick } from 'svelte'
import { dropTarget, targetFor } from './drop-target.svelte'
import { dur } from './motion'
import { folderOf, nameOf } from './space-paths'
import { placedBeside, groupNames, keptOrder, stepped } from './tree-arranging'
import { shownNames } from './tree-order'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'

/** Which part of a row the pointer is in.
 *
 *  Three bands rather than two, because a row in a file list means two things a drop
 *  could land on. The middle of it is the row itself: dropping there puts what was
 *  carried inside it, which is what a drag in the list has always done and what makes
 *  a note out of a folder. The thin bands at the top and the bottom are the spaces
 *  between rows, which is where a new order is. */
export type Band = 'before' | 'on' | 'after'

/** How much of a row each of the outer bands takes.
 *
 *  A quarter, so half the row is still "into this folder": the move into a folder is
 *  the older gesture and the one a reader is more likely to want, and a band that
 *  took a third from each end would leave a third of the row for it. A quarter of a
 *  28 pixel row is 7 pixels, which a mouse hits comfortably; under a thumb the row is
 *  56 and the band is 14. */
const EDGE = 0.25

/** How long a row takes to get out of the way of one being dragged past it.
 *
 *  A little shorter than a fold, because a fold happens once and this happens every
 *  time the gap moves: the rows have to have arrived before the pointer asks them to
 *  move again, or a slow drag leaves them permanently behind the finger. */
const SLIDING = 180

/** How long a finger has to be still on a row before it lifts, in milliseconds.
 *
 *  Shorter than the 500 the row's own menu waits, and deliberately: a press that then
 *  moves is a drag and a press that stays put is a menu, so the lift arms first and
 *  the menu only happens if nothing moved. Long enough not to fire on a tap, short
 *  enough that it does not feel like waiting; see longpress.ts. */
const HOLD_TO_LIFT = 250

/** How far a finger may stray in that time before it counts as a scroll rather than a
 *  press. Tighter than the menu's ten, since this is the gesture that has to give way
 *  to the list scrolling. */
const LIFT_SLOP = 8

/** How long the pointer has to rest on a closed folder before it opens under what is
 *  being dragged. The dwell every file manager has: long enough that passing over a
 *  folder on the way somewhere else does not open it, short enough that waiting on
 *  purpose is not waiting. */
const DWELL = 400

/** What the gesture needs from the list it is in.
 *
 *  A handful of questions rather than the component, so nothing here knows how the
 *  rows are drawn, how many of them are mounted, or which of two panels it is in. */
export interface Held {
  /** The rows the window has mounted, which is every row a pointer can be over. */
  rows: () => Iterable<HTMLElement>
  /** The row at a path, as the list knows it. */
  entryFor: (path: string) => Entry | null
  /** The rows being carried, and saying so: the list draws the one it lifted hollow. */
  carrying: () => readonly string[]
  carry: (paths: readonly string[]) => void
  /** How far into the scroller the pointer is, so the list rolls under it near an
   *  edge. Null stops it. */
  edge: (at: number | null) => void
  /** The box the rows scroll in, for that arithmetic. */
  box: () => HTMLElement | null
  /** Whether a drop on this row would do anything at all; see `takes` in
   *  Tree.svelte, which is the same question the row's own highlight asks. */
  takes: (entry: Entry) => boolean
}

/** Which band the pointer is in, for a row whose top is at `top` and which is
 *  `height` tall. A row of no height is all middle, since there is nothing to
 *  divide. */
export function bandOf(y: number, top: number, height: number): Band {
  if (height <= 0) return 'on'

  const along = (y - top) / height
  if (along < EDGE) return 'before'
  if (along > 1 - EDGE) return 'after'

  return 'on'
}

/** How far each row has moved, by the path written on it: where it was, less where it
 *  is now, which is the offset it has to start from to slide into place.
 *
 *  Rows that did not move are left out, so nothing is animated for nothing. So are
 *  the rows being carried: one of those is under the pointer and is drawn there, and
 *  a row that slid to where the pointer already is would be the same row moving
 *  twice. And so is any row only one of the two measurements has, which is a row that
 *  scrolled into or out of the window while the order changed - it has no distance to
 *  travel, only a place to be. */
export function slides(
  was: ReadonlyMap<string, number>,
  now: ReadonlyMap<string, number>,
  carried: readonly string[] = [],
): Map<string, number> {
  const out = new Map<string, number>()

  for (const [path, here] of now) {
    if (carried.includes(path)) continue

    const before = was.get(path)
    if (before === undefined || before === here) continue

    out.set(path, before - here)
  }

  return out
}

/* -- Where the rows are, and how they get there -- */

/** Where every row on screen is, by the path written on it. Measured before the order
 *  changes and again after, which is what the slide is the difference of. */
export function placesOf(held: Held): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of held.rows()) {
    const path = row.dataset.path
    if (path !== undefined) out.set(path, row.getBoundingClientRect().top)
  }

  return out
}

/** The rows slide from where they were to where the new order puts them.
 *
 *  Measured, changed, measured again, and each row started from its own old place and
 *  animated back to none: the rows are laid out by the flow and by the window's
 *  arithmetic, so there is nothing to animate except the distance between the two
 *  answers. Nothing at all for a reader who has asked for as little movement as
 *  possible - `dur` answers zero - and then the new order simply is the order. */
export async function slideInto(held: Held, was: Map<string, number>): Promise<void> {
  if (dur(SLIDING) === 0) return

  await tick()
  const moving = slides(was, placesOf(held), held.carrying())

  for (const row of held.rows()) {
    const from = moving.get(row.dataset.path ?? '')
    if (from === undefined) continue

    row.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
      // Spelled out rather than held in a variable above, because the rule that every
      // duration JavaScript hands out goes through `dur` is read off the call site;
      // see test/motion.test.ts and motion.ts.
      duration: dur(SLIDING),
      // Ease out, which is cubicOut as a browser spells it: the row leaves at once and
      // settles, rather than creeping away from the pointer.
      easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
    })
  }
}

/* -- The order a drop would leave behind -- */

/** The children the list draws for one folder, the space's own top included. Off
 *  `shownTree`, so a note an account's pass has named counts as a row. */
function childrenIn(folder: string): readonly Entry[] {
  const tree = workspace.shownTree
  if (!tree) return []
  if (tree.path === folder) return tree.children

  return entryAt(tree, folder)?.children ?? []
}

/** Whether these rows could be arranged beside that one: the same folder, the same
 *  group, and the order actually being the reader's to arrange. */
function canArrange(moving: readonly string[], target: string): boolean {
  if (workspace.sortMode !== 'manual') return false
  if (!moving.length || moving.includes(target)) return false

  const folder = folderOf(target)
  return moving.every((path) => folderOf(path) === folder)
}

/** The order a drag would leave behind, shown while it is held between two rows.
 *
 *  Written into the store rather than into the component, which is what makes the gap
 *  under the pointer the same gap the whole list is drawn from; see
 *  workspace/arranged.svelte.ts. Answers whether a gap is showing, so the row
 *  underneath knows not to light up as a folder to drop into as well.
 *
 *  Computed from what the folder keeps rather than from what is showing, so the answer
 *  depends on where the pointer is and not on how it got there. */
export function showArrange(moving: readonly string[], target: string, after: boolean): boolean {
  if (!canArrange(moving, target)) return false

  const folder = folderOf(target)
  const children = childrenIn(folder)
  const names = placedBeside(
    children,
    workspace.arranged.savedList(folder),
    moving.map((path) => nameOf(path)),
    nameOf(target),
    after,
  )

  workspace.arranged.show(folder, names)
  return true
}

/** The pointer is over the row it started on, or over one of the rows moving with it:
 *  whatever is showing stays showing. Which is what stops a drag oscillating, since
 *  the row under the pointer is the row the last gap put there. */
export function holdArrange(moving: readonly string[], target: string): boolean {
  return workspace.sortMode === 'manual' && workspace.arranged.dragging && moving.includes(target)
}

/** One row a step up or down the order somebody arranged, with a key rather than a
 *  drag. True when there was a step to take; false at the top and the bottom of a
 *  group, and in every order but Manual.
 *
 *  Within its own group, like the drag: a note cannot step above the last folder,
 *  because folders come first in every order the list has. */
export function moveInOrder(path: string, by: number): boolean {
  if (workspace.sortMode !== 'manual') return false

  const entry = workspace.entryAt(path)
  if (!entry) return false

  const folder = folderOf(path)
  const children = childrenIn(folder)
  const listed = workspace.arranged.savedList(folder)
  const displayed = shownNames(children, 'manual', listed)
  const group = groupNames(children, displayed, entry.is_dir)

  const moved = stepped(group, entry.name, by)
  if (!moved) return false

  const other = groupNames(children, displayed, !entry.is_dir)
  const whole = entry.is_dir ? [...moved, ...other] : [...other, ...moved]
  workspace.arranged.set(folder, keptOrder(children, whole))

  return true
}

/* -- The gesture -- */

/** The row drawn under the pointer while a finger is carrying it. The platform draws
 *  this itself for a drag it started; a lift has to. */
let ghost: HTMLElement | null = null
let ghostFrom = 0

/** The press that has not become a lift yet, and where it started. */
let holding: ReturnType<typeof setTimeout> | null = null
let heldAt = { x: 0, y: 0 }

/** The folder the pointer is resting on, and the timer that will open it. */
let dwelling: ReturnType<typeof setTimeout> | null = null
let dwellOn: string | null = null

/** What the pointer is pointing at, and the order that would leave behind.
 *
 *  Answers whether a gap is showing, which is what tells the row underneath not to
 *  light up as a folder to drop into as well: a row cannot be both the place something
 *  goes into and the place it goes beside.
 *
 *  The row under the pointer while a gap is showing is usually the row the last gap
 *  put there, which is the row being carried - and that is what holds the gap still
 *  instead of letting it flick back and forth under a resting pointer. */
export function aimAt(held: Held, row: HTMLElement, y: number, entry: Entry): boolean {
  const carrying = held.carrying()
  if (workspace.sortMode !== 'manual' || !carrying.length) return false
  if (holdArrange(carrying, entry.path)) return true

  const box = row.getBoundingClientRect()
  const band: Band = bandOf(y, box.top, box.height)
  if (band === 'on') return false

  const was = placesOf(held)
  if (!showArrange(carrying, entry.path, band === 'after')) return false

  void slideInto(held, was)
  return true
}

/** A closed folder the pointer is resting on opens, so a drop can go further in than
 *  the row it started over. Only while nothing is being dropped between two rows, and
 *  only for a folder that is shut. */
export function dwellOver(path: string | null, folder: boolean): void {
  if (path === dwellOn) return

  dwellOn = path
  if (dwelling !== null) clearTimeout(dwelling)
  dwelling = null
  if (path === null || !folder || workspace.isExpanded(path)) return

  dwelling = setTimeout(() => {
    dwelling = null
    if (dwellOn === path) workspace.device.expand(path)
  }, DWELL)
}

/** The gap goes, and the rows slide to where the order was before it opened.
 *
 *  Measured first, like every other change to the order: a gap that simply stopped
 *  being there would put three rows back in one frame, and the one thing a drag has to
 *  be is continuous. */
export function slideBack(held: Held): void {
  if (!workspace.arranged.dragging) return

  const was = placesOf(held)
  workspace.arranged.unshow()
  void slideInto(held, was)
}

/** The gap goes, whatever was holding it: a drag that ended over nothing, Escape, or a
 *  lift that was let go. */
export function letGo(held: Held): void {
  slideBack(held)
  dwellOver(null, false)
  held.carry([])
}

/** A row under a finger, lifted after a short hold.
 *
 *  A copy of the row rather than the row itself, for the reason the platform draws a
 *  copy for a drag of its own: the row in the list is a row of a window that is still
 *  scrolling, still being rebuilt as the order changes and still keyed by its path,
 *  and a row taken out of that to follow a finger is a row the list has lost track of.
 *  The copy keeps the row's own classes, so it is drawn by the same stylesheet, and it
 *  sits above everything at the place the finger took it from. */
function lift(held: Held, row: HTMLElement, entry: Entry) {
  holding = null
  held.carry(workspace.dragPayload(entry.path))

  const box = row.getBoundingClientRect()
  const copy = row.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return

  copy.classList.add('carried')
  copy.style.width = `${box.width}px`
  copy.style.left = `${box.left}px`
  copy.style.top = `${box.top}px`
  copy.setAttribute('aria-hidden', 'true')
  document.body.append(copy)

  ghost = copy
  ghostFrom = heldAt.y

  const moved = (event: TouchEvent) => onLiftMove(held, event)
  const ended = (event: TouchEvent) => onLiftEnd(held, event)
  const gone = () => dropLift(held)
  const pressed = (event: KeyboardEvent) => onLiftKey(held, event)
  stopping = () => {
    window.removeEventListener('touchmove', moved)
    window.removeEventListener('touchend', ended)
    window.removeEventListener('touchcancel', gone)
    window.removeEventListener('keydown', pressed)
  }

  window.addEventListener('touchmove', moved, { passive: false })
  window.addEventListener('touchend', ended)
  window.addEventListener('touchcancel', gone)
  window.addEventListener('keydown', pressed)
}

/** How the listeners this lift added come off again. Held as one function because the
 *  handlers close over the list they were added for. */
let stopping: (() => void) | null = null

/** A press on a row, which becomes a lift if the finger stays still long enough. The
 *  point is read by the caller, while the event still has a touch in it. */
export function touchHeld(
  held: Held,
  at: { x: number; y: number },
  row: HTMLElement,
  entry: Entry,
): void {
  if (ghost) return

  heldAt = at
  holding = setTimeout(() => lift(held, row, entry), HOLD_TO_LIFT)
}

/** Moving before the hold is up is the list being scrolled, which outranks both the
 *  lift and the menu - and the menu cancels itself on the same movement, for the same
 *  reason; see longpress.ts. */
export function touchMoved(event: TouchEvent): void {
  const touch = event.touches[0]
  if (!touch || holding === null) return

  const strayed =
    Math.abs(touch.clientX - heldAt.x) > LIFT_SLOP || Math.abs(touch.clientY - heldAt.y) > LIFT_SLOP
  if (strayed) cancelHold()
}

export function cancelHold(): void {
  if (holding !== null) clearTimeout(holding)
  holding = null
}

function onLiftMove(held: Held, event: TouchEvent) {
  const touch = event.touches[0]
  if (!ghost || !touch) return

  // The list must not scroll under the finger that is carrying a row; the page's own
  // gesture is what this is instead of.
  if (event.cancelable) event.preventDefault()

  ghost.style.transform = `translateY(${touch.clientY - ghostFrom}px) scale(1.03)`

  const under = document.elementFromPoint(touch.clientX, touch.clientY)
  const row = under instanceof Element ? under.closest('.row[data-path]') : null
  const path = row instanceof HTMLElement ? row.dataset.path : undefined
  const entry = path === undefined ? null : held.entryFor(path)

  if (row instanceof HTMLElement && entry) {
    if (aimAt(held, row, touch.clientY, entry)) {
      dropTarget.clear()
      dwellOver(null, false)
    } else if (held.takes(entry)) {
      slideBack(held)
      dropTarget.over(targetFor(entry.path, entry.is_dir))
      dwellOver(entry.path, entry.is_dir)
    }
  }

  const box = held.box()
  if (box) held.edge(touch.clientY - box.getBoundingClientRect().top)
}

function onLiftEnd(held: Held, event: TouchEvent) {
  // The finger lifting is the end of the gesture, not a tap: left alone the browser
  // follows it with a click, and the click would open whatever row the drop landed on.
  // See longpress.ts, which says the same about its own press.
  if (event.cancelable) event.preventDefault()

  // Written down before anything is cleaned up: the clean-up is what takes the gap
  // away, and a drop that ran after it would have nothing left to write.
  const landed = workspace.arranged.dragging
  const folder = dropTarget.folder
  const paths = [...held.carrying()]

  if (landed) workspace.arranged.drop()
  dropLift(held)

  if (!landed && folder && paths.length) void workspace.moveMany(paths, folder)
}

/** Escape while a row is in the air. Nothing to do but end the lift: ending one slides
 *  the rows back, because that is what ending one without a drop means. */
function onLiftKey(held: Held, event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  event.preventDefault()
  dropLift(held)
}

/** The lift is over, however it ended: the copy goes, the listeners go, and whatever
 *  the gap was showing is dropped unless somebody has just taken it. */
export function dropLift(held: Held): void {
  ghost?.remove()
  ghost = null
  cancelHold()
  dropTarget.clear()
  letGo(held)
  held.edge(null)

  stopping?.()
  stopping = null
}
