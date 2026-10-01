/** The file list as one flat list of rows.
 *
 *  The tree is a tree on disk and a column on screen. It used to be drawn as a
 *  tree too - a component that renders one of itself per open note - and that is
 *  why a space of three thousand notes was three thousand buttons in the page.
 *  A window over the rows in view needs the rows counted and numbered, and a
 *  component that holds itself can count nothing, so the shape the list is drawn
 *  from is this: one row per line the reader can see, top to bottom, each saying
 *  how far in it sits.
 *
 *  The same list the keys walk and the selection ranges over, which is the whole
 *  reason it is here rather than inside the component: an arrow that lands on row
 *  forty and a window that mounts rows thirty to sixty have to agree about which
 *  row forty is. `visibleTree` in workspace.svelte.ts is this list, said in the
 *  vocabulary tree-keys.ts reads.
 *
 *  A note that holds notes is drawn as one row, not as a folder and a note: the
 *  note the folder is named after is the row, so the walk steps past it the way
 *  the eye does. See folder-notes.ts and docs/tree.md. */

import { folderNote, nestedIn } from './folder-notes'
import type { Entry } from './workspace.svelte'

/** One line of the list. */
export interface FlatRow {
  entry: Entry
  /** How many notes deep, which is how far the row steps in. */
  depth: number
}

/** Every row the list shows, top to bottom: a note's children only while its
 *  twist is turned, which is what "the next row" means to an arrow, to a
 *  shift-click and to the window. */
export function flatRows(tree: Entry | null, isOpen: (path: string) => boolean): FlatRow[] {
  const out: FlatRow[] = []
  if (!tree) return out

  const walk = (entry: Entry, depth: number) => {
    // A folder note is the row its folder is drawn as rather than a row of its
    // own, so it is left out here and nowhere else has to remember to skip it.
    const own = folderNote(entry)

    for (const child of entry.children) {
      if (own?.path === child.path) continue

      out.push({ entry: child, depth })
      if (child.is_dir && isOpen(child.path)) walk(child, depth + 1)
    }
  }

  walk(tree, 0)
  return out
}

/** How many rows a note holds open under it, which is how many appear or go when
 *  its twist is turned. What the fold's slide is measured in; see row-window.ts. */
export function heldRows(entry: Entry, isOpen: (path: string) => boolean): number {
  if (!entry.is_dir) return 0

  let count = 0
  for (const child of nestedIn(entry)) {
    count += 1
    if (child.is_dir && isOpen(child.path)) count += heldRows(child, isOpen)
  }

  return count
}

/** Where each row is in the list, by path. What turns the row an event came off
 *  into the number the window and the walk speak in. */
export function rowIndex(rows: readonly FlatRow[]): Map<string, number> {
  const at = new Map<string, number>()
  for (const [index, row] of rows.entries()) at.set(row.entry.path, index)
  return at
}
