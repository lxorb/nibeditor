import { type EditorState, Facet } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Holds every reveal shut, wherever the selection happens to be.
 *
 *  Reading mode sets it. What reveals syntax is the caret being inside the
 *  construct that owns it, and a document nobody can type into has no caret to
 *  put there - so a `**` that came back into view under a click would be
 *  answering a question the reader never asked. One switch rather than a
 *  check at each of the two dozen places that ask: everything below funnels
 *  through `overlaps`, so this is where the answer changes. */
export const noReveal = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

/** Keeps the formatting marks out of sight while the note is written, which is
 *  how Notion and Word edit: the words are bold, and the `**` that says so is the
 *  file's business. The caret steps over a hidden mark as one, so a Backspace at
 *  the start of a heading takes its `# ` away and the line is a paragraph again,
 *  which is Notion's gesture too.
 *
 *  Only the marks that say how text looks. What says where something points or
 *  what it is - a link's target, a formula, a fence and its language, a comment -
 *  still opens under the caret, because nothing else on screen can edit it. */
export const quietMarks = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

/** The marks `quietMarks` keeps shut. A fence's backticks are not among them:
 *  their `CodeMark` is told apart by its parent below. */
const QUIET = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'HighlightMark',
  'CodeMark',
  'HeaderMark',
  'QuoteMark',
])

function quiet(state: EditorState, node: SyntaxNode): boolean {
  if (!QUIET.has(node.name) || !state.facet(quietMarks)) return false
  return node.name !== 'CodeMark' || node.parent?.name === 'InlineCode'
}

/** A `#` or a `>`: per line, as `lineRevealed`, unless the marks are kept quiet. */
export function blockMarkRevealed(state: EditorState, node: SyntaxNode): boolean {
  return !quiet(state, node) && lineRevealed(state, node.from)
}

/** Typora reveals a construct's syntax characters when the caret is inside that
 *  construct - not the whole paragraph. So the reveal region for a syntax mark
 *  is its parent element: the `**` of one bold word stays hidden while you edit
 *  a different bold word on the same line. */
export function revealed(state: EditorState, node: SyntaxNode): boolean {
  if (quiet(state, node)) return false
  const parent = node.parent ?? node
  return overlaps(state, parent.from, parent.to)
}

export function overlaps(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) return false
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

/** Block constructs reveal per line, which is what Typora does for `#` and `>`. */
export function lineRevealed(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return overlaps(state, line.from, line.to)
}
