/** Which rows of the file list are picked, and what a click does to that.
 *
 *  The rules are the ones every file list has: a plain click replaces, Ctrl
 *  adds or removes, Shift takes everything between the last plain click and
 *  here. "Between" means in the order the rows are shown, which is why this
 *  needs to be handed the rows rather than working them out - a folder's
 *  children are only between anything while the folder is open. */

export class Selection {
  /** The picked rows, as paths. In the order the rows are shown, because that is
   *  the order a move or a deletion walks them in. */
  paths = $state<string[]>([])

  /** The same rows to look one up in.
   *
   *  Every drawn row asks `has` on every render, and Ctrl+A in a space of three
   *  thousand notes picks three thousand rows: walking the list per row made
   *  scrolling a selected space cost a hundred thousand string comparisons a
   *  frame. Built once per change to the selection instead. */
  // A plain Set: never mutated, since a change to the selection builds it again,
  // which is what makes it derived.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
  private readonly held = $derived(new Set(this.paths))

  /** Where a Shift range starts: the last row clicked without Shift. */
  private anchor: string | null = null

  has(path: string): boolean {
    return this.held.has(path)
  }

  /** A plain click: that row alone. */
  select(path: string) {
    this.paths = [path]
    this.anchor = path
  }

  /** Ctrl-click: in or out, leaving the rest as it is. */
  toggle(path: string) {
    this.paths = this.has(path) ? this.paths.filter((one) => one !== path) : [...this.paths, path]
    this.anchor = path
  }

  /** Shift-click: from the anchor to here, in the order the rows are shown. */
  range(path: string, order: string[]) {
    const from = this.anchor === null ? -1 : order.indexOf(this.anchor)
    const to = order.indexOf(path)
    if (from < 0 || to < 0) {
      this.select(path)
      return
    }

    this.paths = order.slice(Math.min(from, to), Math.max(from, to) + 1)
  }

  /** Shift and an arrow, from the row the keyboard is on to the next. The range is
   *  anchored where the last one was, as long as the row the keyboard left is still
   *  part of it; otherwise the arrows walked away from the selection first, and the
   *  range starts again from where they stopped, which is how every file list reads
   *  Shift after a walk. */
  extend(from: string, to: string, order: string[]) {
    if (this.anchor === null || !this.has(from)) this.anchor = from
    this.range(to, order)
  }

  all(order: string[]) {
    this.paths = order
    this.anchor = order[0] ?? null
  }

  clear() {
    this.paths = []
    this.anchor = null
  }

  /** Rows that have gone away take themselves out. */
  keepOnly(exists: (path: string) => boolean) {
    if (!this.paths.length) return
    this.paths = this.paths.filter(exists)
  }

  /** What a drag from `path` carries: the whole selection when the row is part
   *  of it, the row alone otherwise. */
  dragging(path: string): string[] {
    return this.has(path) && this.paths.length > 1 ? [...this.paths] : [path]
  }
}

/** Every path a row could sit inside: the part of it before each separator.
 *
 *  Which is every path `one` for which `path` starts with `${one}/` - so asking
 *  about these is the same question as asking about every other row, and there are
 *  as many of them as the row is folders deep rather than as many as the list is
 *  long. */
function couldHold(path: string): string[] {
  const out: string[] = []

  for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
    out.push(path.slice(0, at))
  }

  return out
}

/** The rows that are not inside another row of the same list: a folder takes
 *  what is in it along, so those need no move or deletion of their own.
 *
 *  Asked of the whole selection, which Ctrl+A makes as long as the space is, so
 *  every row is looked up rather than compared with every other row. */
export function outermost(paths: string[]): string[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call
  const held = new Set(paths)
  return paths.filter((path) => !couldHold(path).some((one) => held.has(one)))
}
