/** Growing the selection outwards a step at a time, and back in again.
 *
 *  VS Code's Shift+Alt+Right and Shift+Alt+Left. Each press takes the next thing
 *  out that holds what is selected: the word, then what the markup around it says
 *  - the words inside the stars, then the stars too - then the line's block, the
 *  list it is in, the heading's section, the sections around that, and the note.
 *  The library has one of these, `selectParentSyntax`, but it knows nothing of
 *  words, of what is between the marks, or of sections, and its key is Italic here.
 *
 *  Shrinking goes back down the same steps rather than guessing new ones, so each
 *  press undoes one grow exactly; the steps are kept in grow-steps.ts, which every
 *  editor carries, and this arrives behind the door in line-door.ts.
 *
 *  Each press reads the nodes around the selection and the lines above it up to
 *  the heading it is under, never the whole note. */

import { foldable, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { grew, growing, shrank } from './grow-steps'
import { headingLevel } from './headings'
import { hiddenFrontMatter } from './live-preview/hidden-front-matter'
import { enclosing } from './nodes'

interface Span {
  from: number
  to: number
}

/** Inline markup whose words sit between two marks: the stars of emphasis, the
 *  backticks of code, a link's brackets. Its words are one step, and the words
 *  with the marks the next. */
const BETWEEN_MARKS = new Set([
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'Highlight',
  'InlineCode',
  'InlineMath',
  'Link',
  'Image',
  'Wikilink',
])

/** A block whose words come after one mark at its front: a heading's hashes, a
 *  task's box. */
function afterLeadingMark(node: SyntaxNode): boolean {
  return headingLevel(node.name) !== null || node.name === 'Task'
}

const isMark = (node: SyntaxNode) => node.name.endsWith('Mark') || node.name === 'TaskMarker'

/** The words a node's marks stand around, or null where it has none. */
function inside(state: EditorState, node: SyntaxNode): Span | null {
  const marks: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isMark(child)) marks.push(child)
  }

  const [first, second] = marks
  if (BETWEEN_MARKS.has(node.name) && first && second) return { from: first.to, to: second.from }
  if (!afterLeadingMark(node) || first?.from !== node.from) return null

  const words = state.sliceDoc(first.to, node.to)
  const from = first.to + (words.length - words.trimStart().length)
  return { from, to: Math.max(from, first.to + words.trimEnd().length) }
}

/** The heading sections a range sits in, innermost first, up to the first one that
 *  holds it with room to spare - which is all the smallest step needs. */
function sections(state: EditorState, range: Span, top: number): Span[] {
  const doc = state.doc
  const found: Span[] = []

  for (let number = doc.lineAt(range.from).number; number >= top; number--) {
    const line = doc.line(number)
    if (!/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line.text)) continue

    const fold = foldable(state, line.from, line.to)
    const section = { from: line.from, to: fold ? fold.to : line.to }
    if (section.to < range.to) continue

    found.push(section)
    if (section.from < range.from || section.to > range.to) break
  }

  return found
}

/** Everything a range could grow to, in no order. */
function outwards(state: EditorState, range: SelectionRange, top: number): Span[] {
  const found: Span[] = []
  if (range.empty) {
    const word = state.wordAt(range.head)
    if (word) found.push(word)
  }

  const tree = syntaxTree(state)
  const seen = new Set<SyntaxNode>()
  for (const side of [-1, 1] as const) {
    for (const node of enclosing(tree.resolveInner(range.from, side))) {
      if (seen.has(node) || isMark(node)) continue
      seen.add(node)
      found.push({ from: node.from, to: node.to })
      const words = inside(state, node)
      if (words) found.push(words)
    }
  }

  found.push(...sections(state, range, state.doc.lineAt(top).number))
  found.push({ from: top, to: state.doc.length })
  return found
}

/** The smallest of those that holds the range and more, kept out of hidden
 *  metadata: the note's top is the first line that shows. */
function grown(state: EditorState, range: SelectionRange, top: number): SelectionRange {
  let best: Span | null = null
  for (const span of outwards(state, range, top)) {
    const from = Math.max(span.from, top)
    if (from > range.from || span.to < range.to) continue
    if (span.to - from <= range.to - range.from) continue
    if (!best || span.to - from < best.to - best.from) best = { from, to: span.to }
  }

  return best ? EditorSelection.range(best.from, best.to) : range
}

export const expandSelection: StateCommand = ({ state, dispatch }) => {
  const hidden = hiddenFrontMatter(state)
  const top = hidden ? hidden.after : 0
  const next = EditorSelection.create(
    state.selection.ranges.map((range) => grown(state, range, top)),
    state.selection.mainIndex,
  )
  if (next.eq(state.selection)) return false

  dispatch(
    state.update({ selection: next, effects: grew.of(state.selection), scrollIntoView: true }),
  )
  return true
}

export const shrinkSelection: StateCommand = ({ state, dispatch }) => {
  const back = state.field(growing, false)?.at(-1)
  if (!back) return false

  dispatch(state.update({ selection: back, effects: shrank.of(null), scrollIntoView: true }))
  return true
}
