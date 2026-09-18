/** Getting into a block that draws itself, with the up and down arrows.
 *
 *  A formula, a diagram, a `[toc]` and the note's metadata are drawn by replacing
 *  the lines they are written on, and a replacement is atomic: there is nothing on
 *  those lines for a caret to stand on. Sideways that works out, because the
 *  position either side of the block is still a position and arriving at one
 *  reveals the block. Down and up there is no such position at all: the lines are
 *  not drawn, so the next line the caret can reach is the line past the block, and
 *  the whole thing goes by without ever showing its source. A reader walking their
 *  own note with the keyboard could not get into their own formula.
 *
 *  So a press that would step over a drawn block stops at its near edge instead,
 *  which is what reveals it - and the press after that is an ordinary press in
 *  ordinary text. One press, one block, the same as a press that steps over a line.
 *
 *  Registered under the named bindings in editor.ts, so the two blocks that have
 *  navigation of their own get the arrow first: a table walks into its cells and a
 *  selected picture steps off itself. Everything else answers by revealing, which
 *  is the same answer the sideways arrows already give; see blocks.ts and
 *  table/keymap.ts.
 *
 *  Plain arrows only. A press holding Shift is about a selection rather than about
 *  walking the note, and a selection may cross a block the way it always could. */

import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { blockDecorations } from './blocks'

/** The near edge of the drawn block on the line a press is aiming at, or null
 *  where that line holds no block - which is every ordinary press, and the answer
 *  the binding gives way on. */
export function edgeBeside(state: EditorState, head: number, down: boolean): number | null {
  const blocks = state.field(blockDecorations, false)
  if (!blocks) return null

  const line = state.doc.lineAt(head)
  const number = down ? line.number + 1 : line.number - 1
  if (number < 1 || number > state.doc.lines) return null

  const aim = state.doc.line(number)
  let edge: number | null = null
  blocks.decorations.between(aim.from, aim.to, (from, to, value) => {
    // A replacement with something drawn in its place, and nothing else. Metadata
    // somebody asked to hide is a replacement with nothing there and no source to
    // open, and a cover is a picture inserted at a point rather than instead of a
    // run of the document - neither is a block the caret is being kept out of.
    const spec = value.spec as { widget?: unknown } | null
    if (to <= from || !spec?.widget) return undefined

    edge = down ? from : to
    return false
  })

  return edge
}

function step(down: boolean): Command {
  return (view) => {
    const range = view.state.selection.main
    if (!range.empty) return false

    const edge = edgeBeside(view.state, range.head, down)
    if (edge === null) return false

    view.dispatch({
      selection: EditorSelection.cursor(edge),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

/** Down into the block on the line below, and up into the one on the line above,
 *  in the one slot editor.ts binds them in. */
export const steppingKeymap = [
  { key: 'ArrowDown', run: step(true) },
  { key: 'ArrowUp', run: step(false) },
]
