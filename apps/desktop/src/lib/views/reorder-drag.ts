/** One of a list's own things carried to another place in it, Todoist's drag to
 *  reorder: a project up or down the Tasks panel (`placeProject`), a board's column
 *  along the board (`placedSection`). Past a few pixels with a mouse or a pen it is
 *  lifted, the one under the pointer shows a line on the side it would land on, and
 *  letting go places it there. Escape puts it back, and the press that ends a drag opens
 *  nothing.
 *
 *  A Svelte action on each, which says what it carries and among what:
 *
 *      <div use:reorderDrag={{ id: node.note, among: 'project', place }}>
 *
 *  It lands on the ones wearing `data-<among>`, whose value is the id `place` is handed;
 *  `across` reads the pointer left and right rather than up and down. Under a finger a
 *  held one is its menu, as everywhere else, so a drag is a pointer's. */

/** How far a pointer travels before it is a drag. */
const SLOP = 6

export interface Carry {
  /** What it is, as `data-<among>` names it; empty for one that is not carried. */
  id: string
  among: string
  /** Along a row of them rather than down a column. */
  across?: boolean
  place: (moving: string, target: string, after: boolean) => void
}

/** Which half of a thing a point is over: past the middle lands after it. */
export function landsAfter(at: number, start: number, size: number): boolean {
  return at > start + size / 2
}

export function reorderDrag(node: HTMLElement, start: Carry) {
  let carry = start
  let from: { x: number; y: number } | null = null
  let lifted = false
  let over: { row: HTMLElement; after: boolean } | null = null

  const mark = (next: typeof over) => {
    over?.row.classList.remove('is-above', 'is-below', 'is-before', 'is-after')
    over = next
    over?.row.classList.add(
      over.after
        ? carry.across
          ? 'is-after'
          : 'is-below'
        : carry.across
          ? 'is-before'
          : 'is-above',
    )
  }

  /** What is carried: the one the action is on, or the one it is the handle of. */
  const carried = () => node.closest<HTMLElement>(`[data-${carry.among}]`) ?? node

  const lift = () => {
    lifted = true
    carried().classList.add('is-carried')
    // A drag is not a selection: nothing it passes over is chosen on the way.
    window.getSelection()?.removeAllRanges()
    document.documentElement.classList.add('nib-unselectable')
  }

  const move = (event: PointerEvent) => {
    if (!from) return
    if (!lifted) {
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < SLOP) return
      lift()
    }
    event.preventDefault()
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(`[data-${carry.among}]`)
    if (!row || row === carried()) {
      mark(null)
      return
    }
    const box = row.getBoundingClientRect()
    const after = carry.across
      ? landsAfter(event.clientX, box.left, box.width)
      : landsAfter(event.clientY, box.top, box.height)
    if (over?.row !== row || over.after !== after) mark({ row, after })
  }

  const swallow = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }

  const end = (drop: boolean) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    const was = lifted
    const target = over
    mark(null)
    lifted = false
    from = null
    carried().classList.remove('is-carried')
    document.documentElement.classList.remove('nib-unselectable')
    if (!was) return
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    const id = target?.row.dataset[carry.among]
    if (drop && target && id) carry.place(carry.id, id, target.after)
  }

  const up = () => end(true)
  const cancel = () => end(false)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    end(false)
  }

  const down = (event: PointerEvent) => {
    if (!carry.id || event.button !== 0 || event.pointerType === 'touch') return
    if (event.target instanceof Element && event.target.closest('input, .twist')) return
    from = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }

  node.addEventListener('pointerdown', down)
  return {
    update(next: Carry) {
      carry = next
    },
    destroy() {
      end(false)
      node.removeEventListener('pointerdown', down)
    },
  }
}
