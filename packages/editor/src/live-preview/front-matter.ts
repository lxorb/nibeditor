/** What the two widgets drawn from a note's front matter - its rows and its cover -
 *  both have to do about the caret when they write.
 *
 *  A note is opened with the caret at 0, which is inside the front matter, and the rows
 *  are drawn anyway because nobody put it there; see `chosen` in blocks.ts. The moment
 *  anything is written the caret counts as chosen, and a caret inside the block is what
 *  turns the rows back into YAML. So the first thing a control wrote used to swap the
 *  table for the source under the control being used.
 *
 *  A caret the reader put outside the block is left exactly where it is. */

import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@nib/markdown/edits'
import { frontMatterBlock } from '@nib/markdown/front-matter'

/** The note as an edit leaves it. */
export function applied(source: string, edit: TextEdit): string {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

/** Where the caret goes so the rows stay rows, or nothing where it is already clear
 *  of the block.
 *
 *  `after` is the note as the edit leaves it, because a selection dispatched with a
 *  change is a position in the new document: measured against the old one, a value
 *  that got longer would leave the caret back inside the block it was meant to be out
 *  of. Just past the block, which is where a note opened at the top reads from anyway. */
export function clearOfBlock(view: EditorView, after: string): { anchor: number } | undefined {
  const was = frontMatterBlock(view.state.doc.toString())
  if (!was || view.state.selection.main.head >= was.to) return undefined

  const block = frontMatterBlock(after)
  return block ? { anchor: Math.min(block.to, after.length) } : undefined
}
