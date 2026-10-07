/** Which rows of a chat are worth having in the page, when no two rows are the same
 *  height (docs/chats.md 4.17).
 *
 *  A file list's rows are all one row tall, so `row-window.ts` places them by
 *  multiplying. A chat's are not: one message is a word and the next is a picture and a
 *  paragraph. So every row starts at a height guessed from what it says - lines of words
 *  at the column's width, a picture's stated size - and is measured once it is drawn,
 *  and where a row sits is the sum of the heights above it.
 *
 *  That sum is asked on every scroll, and a chat can hold many rows, so the heights are
 *  kept in a Fenwick tree: a height changed and a row's top found are each a walk of
 *  `log n` steps rather than a pass over the chat. A chat of 100,000 rows answers in
 *  seventeen. Rows are named by index here; the view keeps which message is which, and
 *  builds a new window when rows arrive above (history paging in), holding the row the
 *  reader is looking at still across the change; see `anchored`.
 *
 *  Pure: no DOM, so where a row sits is arithmetic a test reads as numbers. */

export class Heights {
  /** The Fenwick tree, one-based: `tree[i]` holds the sum of a run ending at `i`. */
  private tree: Float64Array
  /** Each row's own height, so a change is told as a difference. */
  private own: Float64Array
  private sum = 0

  constructor(heights: ArrayLike<number>) {
    const count = heights.length
    this.own = Float64Array.from(heights)
    this.tree = new Float64Array(count + 1)
    // Built in one pass rather than `count` updates: each node adds itself to its
    // parent once, which is linear where updates would be n log n.
    const tree = this.tree
    for (let i = 1; i <= count; i++) {
      const own = this.own[i - 1] ?? 0
      tree[i] = (tree[i] ?? 0) + own
      const parent = i + (i & -i)
      if (parent <= count) tree[parent] = (tree[parent] ?? 0) + (tree[i] ?? 0)
      this.sum += own
    }
  }

  get count(): number {
    return this.own.length
  }

  /** The whole list's height. */
  get total(): number {
    return this.sum
  }

  heightOf(index: number): number {
    return this.own[index] ?? 0
  }

  /** Gives a row its height as drawn. Answers by how much it changed, which is what
   *  the view moves the scroll by when the row is above what is being read. */
  set(index: number, height: number): number {
    if (index < 0 || index >= this.own.length) return 0
    const delta = height - (this.own[index] ?? 0)
    if (delta === 0) return 0
    this.own[index] = height
    this.sum += delta
    for (let i = index + 1; i <= this.own.length; i += i & -i) {
      this.tree[i] = (this.tree[i] ?? 0) + delta
    }
    return delta
  }

  /** Where a row starts: the heights of every row above it. */
  top(index: number): number {
    let sum = 0
    for (let i = Math.min(index, this.own.length); i > 0; i -= i & -i) sum += this.tree[i] ?? 0
    return sum
  }

  /** The row at a height down the list: the last whose top is at or above it. Past the
   *  end it is the last row; above the start, the first. */
  at(y: number): number {
    const count = this.own.length
    if (count === 0) return 0
    if (y <= 0) return 0
    // Down the tree by the largest power of two first, as a Fenwick search goes.
    let index = 0
    let left = y
    for (let step = 1 << Math.floor(Math.log2(count)); step > 0; step >>= 1) {
      const next = index + step
      const size = this.tree[next] ?? 0
      if (next <= count && size <= left) {
        index = next
        left -= size
      }
    }
    return Math.min(index, count - 1)
  }

  /** The rows to have in the page for a scroller at `top` showing `room` pixels: those
   *  in view and `overscan` pixels either side, `from` inclusive, `to` not. */
  span(top: number, room: number, overscan: number): { from: number; to: number } {
    const count = this.own.length
    if (count === 0) return { from: 0, to: 0 }
    const from = this.at(top - overscan)
    const to = Math.min(count, this.at(top + room + overscan) + 1)
    return { from, to }
  }
}

/** Where the reader is looking, as something that outlives a window being rebuilt: a
 *  row by its key, and how far below the scroller's top that row starts. */
export interface Anchor {
  key: string
  offset: number
}

/** The anchor for a scroller at `top`: the first row whose bottom is below the top, so
 *  the row partly scrolled away is the one held. Null for an empty list. */
export function anchorAt(heights: Heights, keys: readonly string[], top: number): Anchor | null {
  if (heights.count === 0) return null
  const index = heights.at(top)
  const key = keys[index]
  return key === undefined ? null : { key, offset: heights.top(index) - top }
}

/** Where to scroll so the anchored row sits where it sat: its new top less the same
 *  offset. Null where the row is gone, which leaves the scroll as it is. */
export function anchored(
  heights: Heights,
  keys: readonly string[],
  anchor: Anchor | null,
): number | null {
  if (!anchor) return null
  const index = keys.indexOf(anchor.key)
  return index === -1 ? null : heights.top(index) - anchor.offset
}
