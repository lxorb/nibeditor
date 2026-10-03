/** What a drag in the file list carries.
 *
 *  Out of the tree: one row, or the whole selection when the row dragged is
 *  part of it. The single path travels alongside the list, so every target
 *  keeps recognising a tree drag by the type it always had. Into it, from
 *  outside the app: files, which a browser hands over only at the drop.
 *
 *  Within the bookmarks: which row is moving, by its place in the list. Its own
 *  type, so a bookmark dragged over the tree is not read as a note to move and
 *  a note dropped on the bookmarks does not reorder them. */

import type { Platform } from './keys'

const ONE = 'text/nib-path'
const MANY = 'text/nib-paths'
const BOOKMARK = 'text/nib-bookmark'
const SECTION = 'text/nib-section'

/** What the drag under way carries, kept from its start to its end.
 *
 *  A `dragover` may not read the transfer: a browser hides the data until the
 *  drop, so that a page cannot look through what is being dragged over it. Only
 *  the types are readable, and a target that can see nothing but the type has to
 *  light for everything - including a folder being dropped into itself, which
 *  does nothing. The rows are this window's own, so it may simply remember
 *  them. */
let carrying: readonly string[] = []

export function carry(transfer: DataTransfer | null, paths: string[]) {
  const [first] = paths
  if (!transfer || !first) return
  transfer.setData(ONE, first)
  transfer.setData(MANY, JSON.stringify(paths))
  transfer.effectAllowed = 'copyMove'
  carrying = paths
}

/** The rows the drag is carrying, or nothing when it started somewhere else. */
export function carried(): readonly string[] {
  return carrying
}

/** Said at the end of a drag, however it ended. */
export function carriedNothing() {
  carrying = []
}

export function isTreeDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(ONE)
}

/** Whether a drag from another app may carry a link: not a file, not one of ours.
 *  The drop itself is judged in tab-strip/dropped.ts. */
export function mayCarryAddress(types: readonly string[]): boolean {
  if (types.includes('Files') || types.some((one) => one.startsWith('text/nib-'))) return false
  return types.includes('text/uri-list') || types.includes('text/plain')
}

/** Files from outside the app rather than rows of the list. */
export function isFileDrop(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes('Files') && !isTreeDrag(transfer)
}

/** Whether a drag carries a link and no file: a link dragged out of a web tab's page or
 *  another browser, which the file list keeps as a web note. A picture dragged out of a
 *  page carries itself as a file as well, and is copied in as one; a sentence carries no
 *  link list, and nothing else leaves a page. See web-tab/dropped-site.ts. */
export function isLinkDrop(transfer: DataTransfer | null): boolean {
  const types = transfer?.types ?? []
  return types.includes('text/uri-list') && mayCarryAddress(types) && !isTreeDrag(transfer)
}

/** A drop's files, read while it is still happening: the transfer is emptied once
 *  the event is over, and a folder is only an entry until it is walked. */
export interface CaughtFiles {
  entries: FileSystemEntry[]
  loose: File[]
}

export function caughtFiles(transfer: DataTransfer): CaughtFiles {
  const entries = [...transfer.items]
    .filter((one) => one.kind === 'file')
    .map((one) => one.webkitGetAsEntry())
    .filter((one): one is FileSystemEntry => !!one)

  return { entries, loose: [...transfer.files] }
}

/** What a drop on the file list would do: move its own rows, copy them - Ctrl held,
 *  Alt on a Mac, as Explorer, Finder and VS Code read it - or copy files in. */
export function landing(
  event: Pick<DragEvent, 'dataTransfer' | 'ctrlKey' | 'altKey'>,
  platform: Platform,
): 'move' | 'copy' | null {
  if (isFileDrop(event.dataTransfer) || isLinkDrop(event.dataTransfer)) return 'copy'
  if (!isTreeDrag(event.dataTransfer)) return null

  return (platform === 'mac' ? event.altKey : event.ctrlKey) ? 'copy' : 'move'
}

/** The rows a drag out of the list carries, read off the transfer where it can be. */
export function carriedRows(transfer: DataTransfer | null): readonly string[] {
  if (!isTreeDrag(transfer)) return []

  const rows = dragged(transfer)
  return rows.length ? rows : carrying
}

export function dragged(transfer: DataTransfer | null): string[] {
  if (!transfer) return []
  try {
    const many = JSON.parse(transfer.getData(MANY) || '[]') as unknown
    if (Array.isArray(many) && many.every((one) => typeof one === 'string') && many.length) {
      return many
    }
  } catch {
    // Not from the tree, or from an older build: the single path below.
  }
  const one = transfer.getData(ONE)
  return one ? [one] : []
}

export function carryBookmark(transfer: DataTransfer | null, at: number) {
  if (!transfer) return

  transfer.setData(BOOKMARK, String(at))
  transfer.effectAllowed = 'move'
}

export function isBookmarkDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(BOOKMARK)
}

/** Which row is being dragged, or null when the drag is not a bookmark's. The
 *  index travels as text, so anything that is not a whole number is not ours. */
export function draggedBookmark(transfer: DataTransfer | null): number | null {
  return index(transfer, BOOKMARK)
}

/** Which row of the outline is being dragged, by its place in the list. Its own
 *  type, so a heading dragged over the file tree is not read as a note to move,
 *  and a note dropped on the outline does not reorder a note's sections. */
export function carrySection(transfer: DataTransfer | null, at: number) {
  if (!transfer) return

  transfer.setData(SECTION, String(at))
  transfer.effectAllowed = 'move'
}

export function isSectionDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(SECTION)
}

export function draggedSection(transfer: DataTransfer | null): number | null {
  return index(transfer, SECTION)
}

/** A row's place in its list, as the drag carries it. Text, so anything that is
 *  not a whole number is not ours. */
function index(transfer: DataTransfer | null, type: string): number | null {
  const written = transfer?.getData(type) ?? ''
  const at = Number(written)

  return written !== '' && Number.isInteger(at) && at >= 0 ? at : null
}
