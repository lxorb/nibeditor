/** The words a search of the space starts from when its key is pressed over a
 *  selection, as VS Code and Obsidian both start one: what is selected, when it
 *  is a few words on one line. A selection over several lines is a passage rather
 *  than something to look for, and an empty one asks nothing, so both leave the
 *  field as it was. */

import type { EditorState } from '@nib/editor'

/** Longer than any phrase somebody would search for, short enough that a
 *  selected paragraph on one long line is still not taken for one. */
const LONGEST = 200

export function selectedWords(state: EditorState): string | null {
  const { from, to, empty } = state.selection.main
  if (empty) return null

  const words = state.sliceDoc(from, to).trim()
  if (!words || words.length > LONGEST || words.includes('\n')) return null

  return words
}
