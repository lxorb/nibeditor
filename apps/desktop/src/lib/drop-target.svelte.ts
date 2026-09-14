/** Which folder a drag over the file list would drop into.
 *
 *  One answer for the whole list rather than one per component. The list draws a
 *  component per folder, so a drop that lights a row another of them drew - a PDF
 *  held over its neighbour lights the folder both sit in - has to be answered
 *  somewhere both can read. So the answer is a folder, and it is kept here under
 *  the folder's own path, which is what the row compares against.
 *
 *  A note is the folder it is about to become: dropping onto `A.md` nests what
 *  was dropped, so the folder is `A/` and the row that lights is the note's own.
 *  Anything else that is a file and not a note - a PDF, a canvas - still stands
 *  for the folder it sits in, since none of those can hold a note.
 *
 *  A row at the top of a space stands for the space itself, and what lights for
 *  that is the space below the last row; see Sidebar.svelte. */

import { folderFor } from './folder-notes'
import { folderOf, isMarkdownPath } from './space-paths'

/** The folder a row stands for: a folder is itself, a note is the folder it would
 *  become, and any other file is the folder it sits in.
 *
 *  Most of the row, and in six of the seven orders all of it. The list used to have
 *  no order anybody arranged, so there was no "above this row" for a drop to mean and
 *  nothing for a band across the top or the bottom of a row to say. In Manual there
 *  is: the outer quarter of a row is the space between two rows and a drop there is a
 *  new order, which is `bandOf` in tree-lift.ts and never reaches here. Half the row
 *  is still the row, so this answer is still the one most of it gives. */
export function targetFor(path: string, isFolder: boolean): string {
  if (isFolder) return path
  return isMarkdownPath(path) ? folderFor(path) : folderOf(path)
}

class DropTarget {
  /** The folder a drop would land in, or null while nothing is over the list. */
  folder = $state<string | null>(null)

  /** Whether this folder is the one lit. An empty path is not a folder, so two
   *  of them are not the same folder either. */
  lit(folder: string): boolean {
    return !!this.folder && this.folder === folder
  }

  over(folder: string) {
    this.folder = folder
  }

  clear() {
    this.folder = null
  }
}

export const dropTarget = new DropTarget()
