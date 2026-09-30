/** One tab being dragged, from the press to the release.
 *
 *  What a strip needs to draw a drag and nothing about a window: the numbers mean
 *  what layout.ts says, and Tabs.svelte turns pointer events into the calls here and
 *  the answers into transforms. Numbers rather than events, so a whole drag can be
 *  played out in a test the way a hand plays it out: press, move, let go.
 *
 *  Chrome's gesture (docs/chrome-tabs.md): the press activates the tab, ten pixels
 *  of travel lift it, and from then on it is fixed to the pointer at the place it
 *  was grabbed, clamped to the strip. The slot it is over follows the nearest-start
 *  rule with sixteen pixels of slack between reorders. Out of the strip by more
 *  than the magnetism, it is out: the strip closes up behind it and the drop is the
 *  panes' business. Escape puts everything back.
 *
 *  One of these per strip. A drag is one tab in one strip, and where it goes once
 *  it has left is `workspace.panes.landing`, which every strip and pane can read.
 *  The strips on screen are listed at the end of this file, which is how a tab
 *  carried out of one finds its place in another. */

import { without } from '../records'
import { clampedStart, nearestSlot, reorderSlack } from './layout'

/** How far a pointer travels before a press on a tab becomes a drag: Chrome's
 *  ten pixels in any direction. Under it the press is a click. */
export const THRESHOLD = 10

/** A press on a tab, before it has become anything. */
export interface Press {
  tabId: string
  /** Its place in the strip, and whether it is pinned: which slots it may take. */
  from: number
  pinned: boolean
  /** Where along the strip the pointer went down, and where on the glass. */
  along: number
  x: number
  y: number
  /** How far into the tab the pointer went down, which it keeps for the whole drag. */
  grab: number
  finger: boolean
}

/** What the strip looks like to the drag at one moment. */
export interface Frame {
  /** Every tab's width in the strip's own order. */
  widths: readonly number[]
  /** How much room there is for tabs, the empty stretch after the last included. */
  room: number
  pinnedRun: number
}

/** How a drag ended. */
export type Ending =
  | { kind: 'click' }
  | { kind: 'moved'; tabId: string; from: number; to: number }
  | { kind: 'out'; tabId: string }

export class TabDrag {
  /** The tab that is up, from the lift to the release. */
  tabId = $state<string | null>(null)
  /** Where it was, and the slot it is over now. Equal: nothing has moved. */
  from = $state(0)
  slot = $state(0)
  /** Where along the strip it is drawn. */
  x = $state(0)
  /** Out of the strip: carried over the panes. */
  out = $state(false)
  /** The pointer on the glass, which is where a tab that is out is drawn. */
  pointer = $state({ x: 0, y: 0 })

  private press: Press | null = null
  /** Where along the strip the pointer was when the order last changed. */
  private turned = 0

  /** Whether a tab is up. */
  get on(): boolean {
    return this.tabId !== null
  }

  /** The press being held, lifted or not. */
  get pressing(): Press | null {
    return this.press
  }

  down(press: Press) {
    this.press = press
    this.turned = press.along
  }

  /** The pointer moved. Answers whether the tab is up, so the caller knows to stop
   *  the browser doing anything else with the movement.
   *
   *  `inside` is whether the pointer is still the strip's, magnetism included: a
   *  tab back inside after being out rejoins at the slot nearest it at once, the
   *  way Chrome attaches a dragged tab to a strip. */
  move(along: number, x: number, y: number, inside: boolean, frame: Frame): boolean {
    const press = this.press
    if (!press) return false
    this.pointer = { x, y }

    if (!this.on) {
      if (Math.hypot(x - press.x, y - press.y) <= THRESHOLD) return false

      this.tabId = press.tabId
      this.from = press.from
      this.slot = press.from
    }

    const width = frame.widths[press.from] ?? 0
    this.x = clampedStart(along - press.grab, width, frame.room)

    if (!inside) {
      this.out = true
      return true
    }

    const nearest = nearestSlot(
      frame.widths,
      press.from,
      this.x,
      frame.pinnedRun,
      press.pinned,
      this.slot,
    )

    if (this.out) {
      this.out = false
      this.slot = nearest
      this.turned = along
    } else if (nearest !== this.slot && Math.abs(along - this.turned) > reorderSlack(width)) {
      this.slot = nearest
      this.turned = along
    }

    return true
  }

  /** The pointer let go. What happens next is the caller's: a click, a new order,
   *  or a tab put down somewhere else. */
  release(): Ending {
    const tabId = this.tabId
    const ending: Ending =
      tabId === null
        ? { kind: 'click' }
        : this.out
          ? { kind: 'out', tabId }
          : { kind: 'moved', tabId, from: this.from, to: this.slot }

    this.clear()
    return ending
  }

  /** Escape, or a pointer the window took away: nothing is written down, and every
   *  tab goes back to where it was. */
  cancel() {
    this.clear()
  }

  private clear() {
    this.press = null
    this.tabId = null
    this.out = false
  }
}

/* ── Between strips ───────────────────────────────────────────────
   A tab carried out of its strip is a pointer, not a transfer: the strip it came
   from follows it and has to ask the strip under it where it would go. That strip
   answers from its own layout - where its tabs are meant to be, not where they are
   drawn halfway through making room - so the answer does not move as the room
   opens under the pointer. */

export interface Strip {
  /** The place a tab dropped at this point on the glass would take. */
  slotAt(clientX: number): number
  /** Where the tabs start on the glass, top edge: a carried tab lines up with it. */
  top(): number
}

/** Not state: nothing draws from it, it is only asked. */
let strips: Partial<Record<string, Strip>> = {}

/** Puts a strip on the list for as long as it is on screen. */
export function register(paneId: string, strip: Strip): () => void {
  strips[paneId] = strip
  return () => {
    if (strips[paneId] === strip) strips = without(strips, paneId)
  }
}

export function stripOf(paneId: string): Strip | undefined {
  return strips[paneId]
}

/** A tab let go over another strip, and where on the glass it was let go: the
 *  strip it lands in slides it from there into its slot rather than growing a new
 *  tab out of nothing. Read once, by the tab it names. */
let arriving: { tabId: string; left: number; top: number } | null = null

export function handOver(tabId: string, left: number, top: number) {
  arriving = { tabId, left, top }
}

export function arrival(tabId: string): { left: number; top: number } | null {
  if (arriving?.tabId !== tabId) return null

  const where = arriving
  arriving = null
  return where
}

/** Several tabs at once (picking.svelte.ts), once a click with Ctrl or Shift fetched it. */
export const picks: { loaded: typeof import('./picking.svelte') | null } = $state({
  loaded: null,
})
