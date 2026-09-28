/** Moving a block, copying one, and taking one out.
 *
 *  All three are the same questions, so they are answered once: which lines the
 *  block is, what is left between its neighbours once it is gone, and what goes
 *  either side of it where it lands. The last two are separation.ts, because in
 *  markdown the blank lines between blocks are what keep them apart - a move that
 *  got them wrong would not put a block somewhere else, it would put it inside
 *  something else.
 *
 *  A block also never lands inside something it is not already in: between a list
 *  item and the items nested under it, in the middle of a quote, above a note's
 *  front matter. A landing like that is moved to the nearest edge of the thing it
 *  was inside, so the block steps over it whole. And a block that comes out of the
 *  list item it was nested in comes out to that item's depth, since a line
 *  indented four spaces under a paragraph is code.
 *
 *  Nothing here dispatches: what to do with the changes is the caller's, and this
 *  can be read without an editor in front of it. Every change is one transaction,
 *  so one undo puts the note back exactly. */

import { syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { frontMatterSpan } from '../live-preview/hidden-front-matter'
import { enclosing } from '../nodes'
import { above, below, gap, indentOf, itemsAround, type Side } from './separation'
import type { BlockSpan } from './span'
import { writtenLine } from './span'

/** A block as the lines around it: its first and last, the nearest written line
 *  either side, and the list items it is nested in, outermost first. */
interface Measured {
  first: Line
  last: Line
  up: Line | null
  down: Line | null
  nests: SyntaxNode[]
}

function measure(state: EditorState, span: BlockSpan): Measured {
  const doc = state.doc
  const first = doc.lineAt(span.from)
  const last = doc.lineAt(Math.min(span.to, doc.length))

  const nests = itemsAround(state, first.from + indentOf(first.text) + 1)
    .filter((item) => doc.lineAt(item.from).from < first.from && item.to >= last.to)
    .reverse()

  return {
    first,
    last,
    up: writtenLine(state, first.number - 1, -1),
    down: writtenLine(state, last.number + 1, 1),
    nests,
  }
}

/** The first line with something on it at or after `pos`, as a position, or the end
 *  of the note. A position partway into a line means the line after it. */
function settled(state: EditorState, pos: number): number {
  const doc = state.doc
  if (pos >= doc.length) return doc.length

  const line = doc.lineAt(pos)
  const from = pos > line.from ? line.number + 1 : line.number
  return writtenLine(state, from, 1)?.from ?? doc.length
}

/** Nodes a block may land between the children of without landing inside anything:
 *  the note itself, and a list, whose items are blocks of their own. */
const OPEN = new Set(['Document', 'BulletList', 'OrderedList'])

/** The outermost thing a landing is inside of that the block is not. */
function strangerAt(state: EditorState, block: Measured, at: number): SyntaxNode | null {
  let found: SyntaxNode | null = null

  for (const node of enclosing(syntaxTree(state).resolveInner(at, 1))) {
    const holds = node.from <= block.first.from && node.to >= block.last.to
    if (!OPEN.has(node.name) && !holds && state.doc.lineAt(node.from).from < at) found = node
  }

  return found
}

/** Where a block dropped at `at` really lands, or null when that is where it is. */
function landingOf(
  state: EditorState,
  span: BlockSpan,
  block: Measured,
  at: number,
): number | null {
  // Front matter is the note's own, and has to stay its first line.
  if (span.kind === 'properties') return null

  const doc = state.doc
  let to = settled(state, at)

  const front = frontMatterSpan(state)
  if (front && to <= front.end) to = settled(state, front.after)

  const stranger = to < doc.length ? strangerAt(state, block, to) : null
  if (stranger) {
    to =
      to < block.first.from
        ? doc.lineAt(stranger.from).from
        : settled(state, doc.lineAt(stranger.to).to + 1)
  }

  const end = block.down ? block.down.from : doc.length
  return to >= block.first.from && to <= end ? null : to
}

/** Where a block dropped at `at` lands - the first character of the block it lands
 *  in front of, or the end of the note - or null when it would not move at all. The
 *  line a drag draws is this answer, so it is the line the block lands on. */
export function landing(state: EditorState, span: BlockSpan, at: number): number | null {
  return landingOf(state, span, measure(state, span), at)
}

/** The block's lines as they will read where they land, with how much was taken off
 *  the front of each: a block that comes out of an item it was nested in comes out
 *  to that item's depth. */
function bodyAt(
  state: EditorState,
  block: Measured,
  leaving: SyntaxNode | undefined,
): { text: string; taken: number[] } {
  const doc = state.doc
  const lines = doc.sliceString(block.first.from, block.last.to).split('\n')
  const depth = leaving ? leaving.from - doc.lineAt(leaving.from).from : indentOf(block.first.text)
  const out = Math.max(0, indentOf(block.first.text) - depth)

  const taken = lines.map((line) => Math.min(out, indentOf(line)))
  return { text: lines.map((line, index) => line.slice(taken[index])).join('\n'), taken }
}

/** Where the caret was in the block, as an offset into its moved text. */
function caretIn(state: EditorState, block: Measured, taken: number[], caret: number): number {
  const doc = state.doc
  const line = doc.lineAt(caret)
  let offset = 0

  for (let number = block.first.number; number < line.number; number++) {
    offset += doc.line(number).length - (taken[number - block.first.number] ?? 0) + 1
  }

  return offset + Math.max(0, caret - line.from - (taken[line.number - block.first.number] ?? 0))
}

function breaks(text: string): number {
  return text.split('\n').length
}

/** The block, taken out: its lines and the separation on one side of them, with what
 *  its two neighbours need between them left in their place. */
function cut(state: EditorState, block: Measured): ChangeSpec & { from: number; insert: string } {
  const doc = state.doc
  const { first, last, up, down } = block

  if (up && down) {
    const upper = doc.sliceString(up.to, first.from)
    const lower = doc.sliceString(last.to, down.from)
    const wider = breaks(upper) >= breaks(lower) ? upper : lower
    const between = gap(state, above(state, up), below(state, down), wider)
    return { from: up.to, to: down.from, insert: between }
  }

  if (down) return { from: first.from, to: down.from, insert: '' }
  if (up) return { from: up.to, to: last.to, insert: '' }
  return { from: first.from, to: last.to, insert: '' }
}

/** What a change to a block leaves behind: the edits, and where the caret goes
 *  when it was in the block that moved. */
export interface BlockEdit {
  changes: ChangeSpec[]
  /** Null when the caret was nowhere near it, which leaves it to the change set
   *  to map on its own. */
  caret: number | null
}

/** The block, cut from where it is and put in at `at` - the first character of
 *  the block it lands in front of, or the end of the note. */
export function moveBlock(
  state: EditorState,
  span: BlockSpan,
  at: number,
  caret = state.selection.main.head,
): BlockEdit | null {
  const block = measure(state, span)
  const to = landingOf(state, span, block, at)
  if (to === null) return null

  const doc = state.doc
  // The items it is nested in that the landing is not, outermost first.
  const staying = to < doc.length
  const leaving = block.nests.filter(
    (item) => !(staying && doc.lineAt(item.from).from < to && item.to >= to),
  )
  const { text, taken } = bodyAt(state, block, leaving[0])

  // Its own sides, as they will be where it lands: the items it leaves are not
  // around it any more.
  const own: Side = {
    items: itemsAround(state, block.last.to).filter((item) => !leaving.includes(item)),
    item: below(state, block.first).item,
    indent: indentOf(text),
    moving: true,
  }

  const lower = staying ? doc.lineAt(to) : null
  const upper = writtenLine(state, (lower ? lower.number : doc.lines + 1) - 1, -1)
  const existing = upper && lower ? doc.sliceString(upper.to, lower.from) : null
  const before = upper ? gap(state, above(state, upper), own, existing) : ''
  const after = lower ? gap(state, own, below(state, lower), existing) : ''

  const from = upper ? upper.to : (lower?.from ?? 0)
  const put = { from, to: upper && lower ? lower.from : from, insert: before + text + after }
  const changes: ChangeSpec[] = [cut(state, block), put]

  const inside = caret >= block.first.from && caret <= block.last.to
  if (!inside) return { changes, caret: null }

  const landed = state.changes(changes).mapPos(put.from, -1) + before.length
  return { changes, caret: landed + caretIn(state, block, taken, caret) }
}

/** The block again, right under itself. */
export function copyBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const block = measure(state, span)
  const doc = state.doc
  const text = doc.sliceString(block.first.from, block.last.to)
  const existing = block.down ? doc.sliceString(block.last.to, block.down.from) : null
  const between = gap(state, above(state, block.last), below(state, block.first), existing)

  return {
    changes: [{ from: block.last.to, insert: between + text }],
    // In the copy rather than the original: a duplicate is made to be changed.
    caret: block.last.to + between.length,
  }
}

/** The block, gone. */
export function cutBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const change = cut(state, measure(state, span))
  return { changes: [change], caret: change.from + change.insert.length }
}
