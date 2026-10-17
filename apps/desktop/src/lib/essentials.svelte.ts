/** The Essentials, Zen's (Emil, 2026-10-13), as they are used rather than drawn:
 *  where something carried over them lands, how the arrows walk the grid, and which
 *  tab an essential is. A press shows the file where a tab shows, with no tab in the strip: an ordinary
 *  tab that says which file it was made for (`Tab.essential`), which the strip leaves
 *  out. Per space, as the bookmarks are. Fetched with the first drag, key or press,
 *  never in front of the first paint; what a tile draws is BookmarkTile.svelte's. See
 *  docs/tree.md. */

import { carriedRows, draggedBookmark, isBookmarkDrag, isTreeDrag } from './drag-paths'
import { chorded } from './keys'
import { reading } from './direction'
import type { OpenHow } from './new-tab'
import { insideSpace, samePath } from './space-paths'
import { type Bookmark, MOST_BOOKMARKS, sameBookmark } from './workspace/bookmarks.svelte'
import { workspace, type Entry } from './workspace.svelte'

/** Where something carried over the bookmarks would land: the bookmark it is beside,
 *  by its place in the list, and which edge. Bookmarks.svelte draws the line; a tab
 *  carried out of the strip says where it is from tab-strip/bookmark-drop.ts. */
class Landing {
  at = $state<number | null>(null)
  /** After the tile, under the row. */
  after = $state(false)

  over(at: number, after: boolean) {
    if (this.at === at && this.after === after) return
    this.at = at
    this.after = after
  }

  /** Beside the bookmark in `zone` nearest the pointer; false where it holds none. */
  near(zone: HTMLElement, x: number, y: number): boolean {
    const spot = landingNear(zone, x, y)
    if (spot) this.over(spot.at, spot.after)
    return spot !== null
  }

  clear() {
    this.at = null
  }
}

export const landing = new Landing()

/** Whether the bookmarks take a drag: one of their own, or rows of the file list. */
export function takes(event: DragEvent): boolean {
  const transfer = event.dataTransfer
  if (!isBookmarkDrag(transfer) && !isTreeDrag(transfer)) return false

  event.preventDefault()
  if (transfer) transfer.dropEffect = isBookmarkDrag(transfer) ? 'move' : 'copy'
  return true
}

/** Over the grid: beside the tile nearest, gaps and the empty end of the last row
 *  included. */
export function overGrid(event: DragEvent) {
  if (takes(event)) landing.near(event.currentTarget as HTMLElement, event.clientX, event.clientY)
}

/** Out of the grid altogether, not onto the next tile. */
export function leaving(event: DragEvent) {
  const into = event.relatedTarget
  if (!(into instanceof Node) || !(event.currentTarget as HTMLElement).contains(into)) {
    landing.clear()
  }
}

/** The rows of the file list a drag carried, kept at `at` - false for any other drag. */
export function keepCarried(
  event: DragEvent,
  at: number,
  entry: (path: string) => Entry | undefined,
) {
  if (!isTreeDrag(event.dataTransfer)) return false

  const marks = carriedRows(event.dataTransfer)
    .map(entry)
    .filter((one): one is Entry => one !== undefined)
    .map((one) => workspace.bookmarks.forEntry(one))
    .filter((mark): mark is Bookmark => mark !== null)
  place(marks, at)
  return true
}

/** Let go of over the grid: where the line was, out of any group. */
export function dropOnGrid(event: DragEvent, entry: (path: string) => Entry | undefined) {
  event.preventDefault()

  const { at, after } = landing
  landing.clear()
  if (at === null || keepCarried(event, after ? at + 1 : at, entry)) return

  const from = draggedBookmark(event.dataTransfer)
  const moving = from === null ? undefined : workspace.bookmarks.list[from]
  if (from === null || !moving) return

  workspace.bookmarks.moveInto(moving, null)
  workspace.bookmarks.move(from, slotFor(from, at, after))
}

/** The list with `marks` kept in front of whatever is at `at`, out of any group: one
 *  already kept moves rather than being kept twice, and what does not fit stays out
 *  rather than pushing the last bookmarks off the end. */
export function placed(held: readonly Bookmark[], marks: readonly Bookmark[], at: number) {
  const coming = (one: Bookmark) => marks.some((mark) => sameBookmark(one, mark))
  const rest = held.filter((one) => !coming(one))
  const into = Math.max(0, Math.min(at, held.length))
  const ahead = into - held.slice(0, into).filter(coming).length

  const come = marks
    .filter((mark, index) => marks.findIndex((other) => sameBookmark(mark, other)) === index)
    .map(({ kind, path, text, view }) => ({ kind, path, text, ...(view ? { view } : {}) }))
    .slice(0, MOST_BOOKMARKS - rest.length)

  return [...rest.slice(0, ahead), ...come, ...rest.slice(ahead)]
}

/** Rows let go of over the bookmarks, kept where they were let go of. */
export function place(marks: readonly Bookmark[], at: number) {
  const root = workspace.activeSpace?.root
  if (!marks.length || root === undefined) return

  workspace.bookmarks.put(root, placed(workspace.bookmarks.of(root), marks, at))
}

/** Left and right along the grid: the tile before and after, the way they read. */
export function along(key: string, tile: HTMLElement): boolean {
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false

  const all = [...(tile.parentElement?.parentElement?.querySelectorAll<HTMLElement>('.tile') ?? [])]
  const next = all[all.indexOf(tile) + (key === 'ArrowRight' ? 1 : -1)]
  next?.focus()
  return next !== undefined
}

/** Up and down the grid by its rows, off its foot onto the rows under it: heard on the
 *  grid before the list's own walk, which steps one at a time. */
export function gridKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (chorded(event) || event.shiftKey) return

  const grid = event.currentTarget as HTMLElement
  const all = [...grid.querySelectorAll<HTMLElement>('.tile')]
  const at = all.findIndex((one) => one === event.target)
  if (at < 0) return

  event.preventDefault()
  event.stopPropagation()

  const down = event.key === 'ArrowDown'
  const next = stepInGrid(at, all.length, columnsOf(all.map((one) => one.offsetTop)), down)
  if (next !== null) all[next]?.focus()
  else if (down) grid.parentElement?.querySelector<HTMLElement>('.row')?.focus()
}

/** Where a bookmark let go of in front of (or `after`) the one at `target` lands, as
 *  `move` takes it: in the list without the bookmark itself, when it is moved from
 *  `from`. */
export function slotFor(from: number | null, target: number, after: boolean): number {
  const at = from !== null && target > from ? target - 1 : target
  return at + (after ? 1 : 0)
}

/** Whether `x` is in the far half of `left` to `right`, the way the page reads. */
export function pastMiddle(x: number, left: number, right: number, rtl: boolean): boolean {
  const middle = (left + right) / 2
  return rtl ? x < middle : x > middle
}

/** The tile a step up or down the grid lands on, or null off its top or its foot. A
 *  last row too short for the column takes the step on its last tile. */
export function stepInGrid(
  at: number,
  count: number,
  columns: number,
  down: boolean,
): number | null {
  const next = at + (down ? columns : -columns)
  if (next >= 0 && next < count) return next

  const row = Math.floor(at / columns)
  return down && row < Math.floor((count - 1) / columns) ? count - 1 : null
}

/** How many tiles are in a row: as many as start on the first one's line. */
export function columnsOf(tops: readonly number[]): number {
  const [first] = tops
  return first === undefined ? 1 : Math.max(1, tops.filter((top) => top === first).length)
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** The tile nearest a pointer, or -1 with none: the nearest row first, then along it,
 *  so a gap or the empty end of the last row is beside the tile it is next to. */
export function nearestTile(boxes: readonly Box[], x: number, y: number): number {
  let best = -1
  let nearest = { down: Infinity, across: Infinity }

  for (const [at, box] of boxes.entries()) {
    const down = Math.max(box.top - y, 0, y - box.bottom)
    const across = Math.max(box.left - x, 0, x - box.right)
    if (down < nearest.down || (down === nearest.down && across < nearest.across)) {
      nearest = { down, across }
      best = at
    }
  }

  return best
}

/** Where a drop at `x`, `y` over the bookmarks drawn in `zone` lands: beside the one
 *  nearest, across for a tile and down for a row. Null where the zone holds none. */
function landingNear(
  zone: HTMLElement,
  x: number,
  y: number,
): { at: number; after: boolean } | null {
  const all = [...zone.querySelectorAll<HTMLElement>('[data-at]')]
  const boxes = all.map((one) => one.getBoundingClientRect())
  const at = nearestTile(boxes, x, y)
  const near = all[at]
  const box = boxes[at]
  if (!near || !box) return null

  const after = near.classList.contains('tile')
    ? pastMiddle(x, box.left, box.right, reading() === 'rtl')
    : pastMiddle(y, box.top, box.bottom, false)
  return { at: Number(near.dataset.at), after }
}

interface Held {
  essential: string | null
  paneId: string
}

/** The tab an essential is: one on screen before one in a set put aside. */
export function essentialTab<T extends Held>(
  tabs: readonly T[],
  path: string,
  shown: (paneId: string) => boolean,
): T | undefined {
  const all = tabs.filter((one) => one.essential !== null && samePath(one.essential, path))
  return all.find((one) => shown(one.paneId)) ?? all[0]
}

/** The essentials whose file is no longer kept, which go back to their strip, as a tab
 *  taken out of Zen's Essentials does. */
export function released<T extends Held>(tabs: readonly T[], kept: readonly string[]): T[] {
  return tabs.filter(
    (one) => one.essential !== null && !kept.some((path) => samePath(path, one.essential)),
  )
}

/** A press on an essential's tile: its own tab, which the strip leaves out, brought
 *  forward as it was left; else a view of its own of a file already open - for a web
 *  note, which is open in one tab only (`secondWebTabs`), that tab, its page and its web
 *  data with it - or the file opened with its tab an essential as it lands. One view an
 *  essential. */
export async function openEssential(path: string) {
  const ws = workspace
  const held = essentialTab(ws.tabs, path, (paneId) => ws.panes.at(paneId) !== null)
  if (held) {
    ws.front(held.id)
    return
  }

  const open = ws.opened.at(path)
  const web = open?.kind === 'web' ? ws.tabs.find((one) => one.note === open) : undefined
  if (web) {
    web.essential = path
    ws.front(web.id)
    return
  }
  if (open) {
    ws.secondView(open, {}, path)
    return
  }

  ws.essentialComing = path
  try {
    await ws.openEntry(path, { activate: true })
  } finally {
    ws.essentialComing = null
  }
}

/** An essential asked for in the strip: the strip's tab of it, or a view of its own,
 *  since every opener would answer with the essential itself. */
export async function openInStrip(path: string, how: OpenHow) {
  const ws = workspace
  const open = ws.opened.at(path)
  const inStrip = ws.tabs.some(
    (one) => one.essential === null && one.note === open && ws.panes.at(one.paneId),
  )
  if (open && !inStrip) ws.secondView(open, how)
  else await ws.openEntry(path, how)
}

/** Essentials taken out of the list back in their strips: heard on every change. */
export function kept() {
  const root = workspace.activeSpace?.root
  if (root === undefined) return

  const files = workspace.bookmarks
    .of(root)
    .filter((one) => one.kind === 'note')
    .map((one) => insideSpace(root, one.path))
  const shown = workspace.tabs.filter((one) => workspace.panes.at(one.paneId) !== null)
  for (const one of released(shown, files)) one.essential = null
}
