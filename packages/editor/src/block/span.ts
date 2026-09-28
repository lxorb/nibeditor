/** What a block is.
 *
 *  A note is text, not a list of blocks in a database, so nothing here is a
 *  record of anything: a block is a run of lines the grammar already says belongs
 *  together - a paragraph, a list item and whatever is nested under it, a quote, a
 *  fence, a table - read out of the syntax tree at the moment somebody asks.
 *
 *  A heading is the exception, and deliberately: its block is its whole section,
 *  the way folding means it and the way the outline moves it. "This part" is what
 *  a reader means by a heading, and a mark in the margin that took only the line
 *  of hashes would be a mark that lies about what it holds.
 *
 *  Two callers: the mark in the margin beside every block, which drags it and
 *  opens what can be done to it, and the app's own menu, which asks what block a
 *  press landed in. */

import { foldable, syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { headingLevel } from '../headings'
import { enclosing } from '../nodes'

/** What a block is, in a word. The app turns these into the reader's own
 *  language; the editor never writes them down. */
export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'math'
  | 'properties'
  | 'rule'
  | 'block'

/** A block, as the lines it covers: from the first character of its first line to
 *  the last of its last. */
export interface BlockSpan {
  from: number
  to: number
  kind: BlockKind
}

/** The blocks the grammar names, and what each of them is. Anything else a note
 *  can hold - an HTML block, a link definition - is a block all the same, since
 *  it is a run of lines that moves as one. */
const KINDS: Readonly<Record<string, BlockKind>> = {
  Paragraph: 'paragraph',
  Blockquote: 'quote',
  ListItem: 'list',
  FencedCode: 'code',
  CodeBlock: 'code',
  Table: 'table',
  BlockMath: 'math',
  FrontMatter: 'properties',
  HorizontalRule: 'rule',
  HTMLBlock: 'block',
  LinkReference: 'block',
  CommentBlock: 'block',
}

function kindOf(name: string): BlockKind | null {
  if (headingLevel(name) !== null) return 'heading'
  return KINDS[name] ?? null
}

/** One node as a span of whole lines. A heading's is its section: `foldable`
 *  answers where that ends, which is the same answer the chevron in the margin
 *  and the fold command get. */
function spanOf(state: EditorState, node: SyntaxNode, kind: BlockKind): BlockSpan {
  const doc = state.doc
  const first = doc.lineAt(node.from)

  if (kind === 'heading') {
    const section = foldable(state, first.from, first.to)
    return { from: first.from, to: section ? section.to : first.to, kind }
  }

  return { from: first.from, to: doc.lineAt(Math.min(node.to, doc.length)).to, kind }
}

/** Every block whose first line begins inside `from` to `to`, in document order,
 *  one to a line.
 *
 *  One to a line because that is what a mark in the margin can be: a list item
 *  and the paragraph inside it begin on the same line, and the item is the one
 *  the reader means. The first found wins, and the walk is outside in. */
export function blocksIn(state: EditorState, from: number, to: number): BlockSpan[] {
  const doc = state.doc
  const found: BlockSpan[] = []
  const taken = new Set<number>()

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const kind = kindOf(node.name)
      if (!kind) return true

      const span = spanOf(state, node.node, kind)
      const line = doc.lineAt(span.from).from
      if (!taken.has(line)) {
        taken.add(line)
        found.push(span)
      }

      // Into a list item, because what is nested in one is a block of its own
      // and begins on a line of its own. Not into anything else: a quote, a
      // fence and a table are each one thing to take hold of.
      return kind === 'list'
    },
  })

  return found.sort((one, other) => one.from - other.from)
}

/** The block a position is in.
 *
 *  The one that begins on that line, when a block does - so a nested list item
 *  answers for itself rather than handing back the item it sits in. Otherwise the
 *  outermost block around the position, which is the same block the mark in the
 *  margin of its first line takes hold of: the second line of a quote belongs to
 *  the quote, not to the paragraph inside it. */
export function blockAt(state: EditorState, pos: number): BlockSpan | null {
  const line = state.doc.lineAt(pos)
  const starting = blocksIn(state, line.from, line.to).find(
    (span) => state.doc.lineAt(span.from).from === line.from,
  )
  if (starting) return starting

  // The outermost block that matches rather than the innermost, so the walk runs
  // to the end of the chain.
  let found: BlockSpan | null = null
  for (const node of enclosing(syntaxTree(state).resolveInner(pos, -1))) {
    const kind = kindOf(node.name)
    if (kind) found = spanOf(state, node.node, kind)
  }

  return found
}

/** The nearest line with something on it, from line `number` on towards `delta`, that
 *  line included; null past the end of the note. Blank lines are stepped over: they
 *  are the separation between blocks rather than blocks of their own. */
export function writtenLine(state: EditorState, number: number, delta: -1 | 1): Line | null {
  const doc = state.doc

  for (let at = number; at >= 1 && at <= doc.lines; at += delta) {
    const line = doc.line(at)
    if (line.text.trim()) return line
  }

  return null
}
