/** A row carried from one place in a view to another: a card to another column, a task
 *  to another day, a row of the list onto another group.
 *
 *  Pointer events rather than the browser's drag and drop, for two reasons the canvas
 *  and the tab strip already found: a phone has no drag and drop at all, and the
 *  picture a browser drags is a grey copy nobody can style. So a press that moves
 *  (or, under a thumb, a press held and then moved, as on the canvas) lifts the row,
 *  a card of its words follows the pointer with the canvas's shadow, and whatever the
 *  pointer is over that takes rows (`droppable`) lights up and is told where it landed.
 *
 *  Escape, or a release over nothing that takes it, puts the row back where it was:
 *  nothing is written until a drop lands. */

import type { Row } from '@nib/bases'

/** Where a drop landed, in the window's pixels. */
export interface Point {
  x: number
  y: number
}

type Take = (row: Row, at: Point, place: HTMLElement) => void

/** How far a mouse moves before a press is a drag rather than a click. */
const SLOP = 4
/** How long a thumb holds before a press is a drag rather than a scroll. */
const HOLD = 350

class Dragging {
  /** The row being carried, or null. */
  row = $state.raw<Row | null>(null)
  /** What the card following the pointer says. */
  label = $state('')
  x = $state(0)
  y = $state(0)
  /** The place the row would land if let go now. */
  over = $state.raw<HTMLElement | null>(null)
}

export const dragging = new Dragging()

/** Which view draws the card that follows the pointer: the first one on screen, so two
 *  views side by side do not draw two. */
const ghosts: symbol[] = []
let drawing = $state<symbol | null>(null)

/** A view asking to draw the card; answers whether it does, now, and the way to stop. */
export function ghostOwner(): { mine: () => boolean; release: () => void } {
  const me = Symbol('ghost')
  ghosts.push(me)
  drawing = ghosts[0] ?? null
  return {
    mine: () => drawing === me,
    release: () => {
      ghosts.splice(ghosts.indexOf(me), 1)
      drawing = ghosts[0] ?? null
    },
  }
}

const takers = new WeakMap<HTMLElement, Take>()

/** A place rows can be dropped on. */
export function droppable(node: HTMLElement, take: Take) {
  takers.set(node, take)
  node.dataset.drop = ''
  return {
    update(next: Take) {
      takers.set(node, next)
    },
    destroy() {
      takers.delete(node)
    },
  }
}

/** The place under a point that takes rows, if any. */
function targetAt(at: Point): HTMLElement | null {
  const found = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-drop]')
  return found ?? null
}

/** The nearest box that scrolls, for carrying a row past the edge of what is shown. */
function scrollerAt(at: Point): HTMLElement | null {
  for (let box = document.elementFromPoint(at.x, at.y); box; box = box.parentElement) {
    if (!(box instanceof HTMLElement)) continue
    const style = getComputedStyle(box)
    if (
      /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
      box.scrollHeight + box.scrollWidth > box.clientHeight + box.clientWidth
    ) {
      return box
    }
  }
  return null
}

/** Brings rows in under a pointer held near the edge of what scrolls. */
function nudge(at: Point) {
  const box = scrollerAt(at)
  if (!box) return
  const rect = box.getBoundingClientRect()
  const edge = 36
  const step = (distance: number) => Math.round(((edge - distance) / edge) * 14)
  if (at.y < rect.top + edge) box.scrollTop -= step(at.y - rect.top)
  else if (at.y > rect.bottom - edge) box.scrollTop += step(rect.bottom - at.y)
  if (at.x < rect.left + edge) box.scrollLeft -= step(at.x - rect.left)
  else if (at.x > rect.right - edge) box.scrollLeft += step(rect.right - at.x)
}

export interface Carry {
  row: Row
  label: string
  disabled?: boolean
}

/** A row that can be carried. The press that does not become a drag is left alone,
 *  so a click still opens and a box still ticks. */
export function draggable(node: HTMLElement, start: Carry) {
  let carry = start
  let from: Point | null = null
  let held: ReturnType<typeof setTimeout> | undefined
  let lifted = false
  let frame = 0

  const lift = () => {
    lifted = true
    dragging.row = carry.row
    dragging.label = carry.label
    node.classList.add('is-carried')
  }

  const move = (event: PointerEvent) => {
    const at = { x: event.clientX, y: event.clientY }
    if (!lifted) {
      if (!from) return
      const far = Math.hypot(at.x - from.x, at.y - from.y)
      if (event.pointerType === 'touch') {
        // A thumb that moves before the hold is a scroll, not a drag.
        if (far > SLOP * 2) cancel()
        return
      }
      if (far < SLOP) return
      lift()
    }
    event.preventDefault()
    dragging.x = at.x
    dragging.y = at.y
    const target = targetAt(at)
    if (target !== dragging.over) {
      dragging.over?.classList.remove('is-taking')
      target?.classList.add('is-taking')
      dragging.over = target
    }
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => nudge(at))
  }

  const finish = (event: PointerEvent | null) => {
    clearTimeout(held)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('keydown', key, true)
    cancelAnimationFrame(frame)
    const was = lifted
    const target = dragging.over
    const row = dragging.row
    lifted = false
    from = null
    node.classList.remove('is-carried')
    target?.classList.remove('is-taking')
    dragging.row = null
    dragging.over = null
    if (!was) return
    // The click a drag ends in is not a press of whatever it was over.
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    if (event && target && row)
      takers.get(target)?.(row, { x: event.clientX, y: event.clientY }, target)
  }

  const up = (event: PointerEvent) => finish(event)
  const cancel = () => finish(null)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  const down = (event: PointerEvent) => {
    if (carry.disabled || event.button !== 0) return
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable]')
    )
      return
    from = { x: event.clientX, y: event.clientY }
    dragging.x = from.x
    dragging.y = from.y
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key, true)
    if (event.pointerType === 'touch') held = setTimeout(lift, HOLD)
  }

  node.addEventListener('pointerdown', down)
  return {
    update(next: Carry) {
      carry = next
    },
    destroy() {
      node.removeEventListener('pointerdown', down)
      if (from) cancel()
    },
  }
}

function swallow(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/** Where among a list of items a point falls: the index before which a row dropped
 *  there goes, from the items' own boxes. */
export function placeAmong(items: readonly Element[], at: Point, across = false): number {
  for (let index = 0; index < items.length; index++) {
    const box = items[index]?.getBoundingClientRect()
    if (!box) continue
    const middle = across ? box.left + box.width / 2 : box.top + box.height / 2
    if ((across ? at.x : at.y) < middle) return index
  }
  return items.length
}
