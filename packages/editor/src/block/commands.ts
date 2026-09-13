/** What can be done to a block, as the things a menu row can call.
 *
 *  The menu itself is the app's, because every other row in it is: these are the
 *  editor's half, which is knowing which block a press landed in and changing the
 *  text. Each takes a document position rather than a block, so the caller never
 *  has to hold one across an edit.
 *
 *  Every one of them works on the whole selection when there is one, so a selection
 *  lying across four paragraphs duplicates, deletes, indents, moves, turns or links
 *  to all four. A selection in nib is a selection of text and never a mode; the
 *  blocks it touches are simply the blocks it touches, and this is where that is
 *  read off.
 *
 *  Which is the reason there are this many. A reader holding four blocks wants what
 *  they would want holding one, and a menu that offered two of the things and not
 *  the rest would be a menu saying that a selection across blocks is a lesser kind
 *  of selection. */

import type { ChangeSpec, EditorState, StateCommand } from '@codemirror/state'
import { indentLess, indentMore } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { blockIdOf, freeBlockId, blockIds } from '@nib/markdown/links'
import { headingText } from '../headings'
import { copyBlock, cutBlock, moveBlock } from './move'
import { type BlockShape, shaped, wordsOf } from './shape'
import { blockAt, type BlockKind, blocksIn, type BlockSpan } from './span'

/** The blocks a press acted on: everything the selection covers when it covers
 *  more than the block that was pressed, and that one block otherwise. */
export function blocksFor(view: EditorView, pos: number): BlockSpan[] {
  const range = view.state.selection.main
  const pressed = blockAt(view.state, pos)

  if (range.empty || pos < range.from || pos > range.to) return pressed ? [pressed] : []

  const covered = blocksIn(view.state, range.from, range.to).filter(
    (span) => span.to >= range.from && span.from <= range.to,
  )

  return covered.length ? covered : pressed ? [pressed] : []
}

/** Every one of them again, under itself. */
export function duplicateBlocks(view: EditorView, pos: number): boolean {
  const spans = blocksFor(view, pos)
  if (!spans.length) return false

  // Bottom up, so a copy made below one block does not move the block above it
  // out from under its own offsets.
  const changes: ChangeSpec[] = []
  let caret: number | null = null

  for (const span of [...spans].reverse()) {
    const edit = copyBlock(view.state, span)
    changes.push(...edit.changes)
    caret ??= edit.caret
  }

  view.dispatch({
    changes,
    ...(caret === null ? {} : { selection: { anchor: caret } }),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** Every one of them, gone. */
export function deleteBlocks(view: EditorView, pos: number): boolean {
  const spans = blocksFor(view, pos)
  if (!spans.length) return false

  const changes = [...spans].reverse().flatMap((span) => cutBlock(view.state, span).changes)

  view.dispatch({
    changes,
    selection: { anchor: Math.min(spans[0]?.from ?? 0, view.state.doc.length) },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** What a link into this note would point at: `#A heading` for a heading, since
 *  that is what a heading is already called, and `#^name` for anything else.
 *
 *  A block that has no name is given one, which is a change to the note: the name
 *  is a marker Obsidian reads the same way, it is written at the end of the block
 *  where Obsidian writes it, and nothing shows it - see withoutBlockIds in
 *  @nib/markdown. Null when there is no block to point at. */
export function blockTarget(view: EditorView, pos: number): string | null {
  const span = blockAt(view.state, pos)
  if (!span) return null

  const doc = view.state.doc
  const first = doc.lineAt(span.from)

  if (span.kind === 'heading') {
    const words = headingText(first.text)
    return words ? `#${words}` : null
  }

  // The end of the block is where a name goes, which is where Obsidian looks for
  // one. A fence's name goes after its closing marks, not inside the code.
  const last = doc.lineAt(span.to)
  const already = blockIdOf(last.text)
  if (already) return `#^${already}`

  const taken = new Set(blockIds(doc.toString()).map((one) => one.id))
  const id = freeBlockId(taken)
  const end = last.from + last.text.trimEnd().length

  view.dispatch({ changes: { from: end, to: end, insert: ` ^${id}` } })
  return `#^${id}`
}

/** Which kinds of block hold prose, and so have a line of words that could be a
 *  heading or an item instead.
 *
 *  A fence, a table, an equation and front matter are typed exactly as they stand:
 *  a hash put in front of a line of code is a line of code with a hash in it, and a
 *  rule has no words at all. Those are left alone rather than refused, so a
 *  selection that happens to cross a code block still turns the paragraphs either
 *  side of it. */
const PROSE = new Set<BlockKind>(['heading', 'paragraph', 'list', 'quote'])

/** Every block a press acted on, as the shape that was asked for.
 *
 *  A heading is one line in markdown, so a block turning into one puts its first
 *  line under the hashes and leaves the rest of it as the words beneath - which is
 *  what a reader means by turning a paragraph into a heading. Every other shape is
 *  a mark in front of each line, and a numbered list counts from one across the
 *  whole run rather than starting again at every block.
 *
 *  Sets rather than toggles; see shape.ts for why this is not the keyboard's own
 *  command with a selection laid over it. */
export function turnBlocksInto(view: EditorView, pos: number, shape: BlockShape): boolean {
  const spans = blocksFor(view, pos).filter((span) => PROSE.has(span.kind))
  if (!spans.length) return false

  const doc = view.state.doc
  const changes: ChangeSpec[] = []
  const heading = shape.startsWith('heading')
  let nth = 1

  for (const span of spans) {
    const first = doc.lineAt(span.from).number
    const last = doc.lineAt(Math.min(span.to, doc.length)).number

    for (let number = first; number <= last; number++) {
      const line = doc.line(number)
      // A blank line is what makes two paragraphs two paragraphs, and a marker in
      // front of nothing is an item nobody asked for.
      if (!wordsOf(line.text).words.trim()) continue

      const into: BlockShape = heading && number > first ? 'paragraph' : shape
      const text = shaped(line.text, into, nth)
      if (into === 'numbered') nth++
      if (text === line.text) continue

      changes.push({ from: line.from, to: line.to, insert: text })
    }
  }

  if (!changes.length) return false

  view.dispatch({ changes, userEvent: 'input' })
  view.focus()
  return true
}

/** Runs one of the editor's own commands over every line of the blocks a press
 *  acted on.
 *
 *  The keyboard already indents and outdents, and it does it to the selection. A
 *  menu row over four blocks is that same question asked of four blocks' lines, so
 *  the selection goes over them and the command is asked - rather than a second
 *  implementation of indenting written here that could come to a different answer
 *  from the key. The selection is left over the blocks, which is what the reader
 *  had in hand. */
function overBlocks(view: EditorView, pos: number, command: StateCommand): boolean {
  const spans = blocksFor(view, pos)
  const first = spans[0]
  const last = spans.at(-1)
  if (!first || !last) return false

  view.dispatch({
    selection: { anchor: first.from, head: Math.min(last.to, view.state.doc.length) },
  })

  const ran = command({
    state: view.state,
    dispatch: (transaction) => view.dispatch(transaction),
  })
  view.focus()
  return ran
}

/** One step further in, and one step back out. */
export function indentBlocks(view: EditorView, pos: number): boolean {
  return overBlocks(view, pos, indentMore)
}

export function outdentBlocks(view: EditorView, pos: number): boolean {
  return overBlocks(view, pos, indentLess)
}

/** The nearest line with something on it above or below a position, or null at the
 *  end of the note it is walking towards. Blank lines are stepped over: they are
 *  the separation between blocks rather than blocks of their own. */
function nextWritten(state: EditorState, from: number, delta: -1 | 1): number | null {
  const doc = state.doc
  let number = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number + delta

  while (number >= 1 && number <= doc.lines) {
    const line = doc.line(number)
    if (line.text.trim()) return line.from
    number += delta
  }

  return null
}

/** The block above a run of them, or the one below it. */
function beside(state: EditorState, run: BlockSpan, delta: -1 | 1): BlockSpan | null {
  const at = nextWritten(state, delta < 0 ? run.from : run.to, delta)
  return at === null ? null : blockAt(state, at)
}

/** Where a run of blocks lands when it steps over its neighbour.
 *
 *  Going up, that is the neighbour's own first character. Going down, it is where
 *  the block after the neighbour begins - or the end of the note, which is what
 *  `moveBlock` reads as "after everything". Null when there is no neighbour to step
 *  over, which is a press that does nothing rather than one that reshuffles the
 *  note. */
function landingFor(state: EditorState, run: BlockSpan, delta: -1 | 1): number | null {
  const neighbour = beside(state, run, delta)
  if (!neighbour) return null
  if (delta < 0) return neighbour.from

  const after = beside(state, neighbour, 1)
  return after ? after.from : state.doc.length
}

/** Every block a press acted on, one step up or one step down.
 *
 *  One run and not each block in turn: four blocks moved one at a time would each
 *  step over a different neighbour and the run would come apart. The run is cut
 *  whole and put back whole, through the same `moveBlock` a block dragged by its
 *  mark in the margin goes through - so the blank lines around it are settled by
 *  the one piece of code that knows what a blank line means in markdown. */
export function moveBlocks(view: EditorView, pos: number, delta: -1 | 1): boolean {
  const spans = blocksFor(view, pos)
  const first = spans[0]
  const last = spans.at(-1)
  if (!first || !last) return false

  const run: BlockSpan = { from: first.from, to: last.to, kind: first.kind }
  const at = landingFor(view.state, run, delta)
  if (at === null) return false

  const edit = moveBlock(view.state, run, at)
  if (!edit) return false

  view.dispatch({
    changes: edit.changes,
    ...(edit.caret === null ? {} : { selection: { anchor: edit.caret } }),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** What a link into this note would point at, for every block a press acted on, in
 *  document order.
 *
 *  Bottom up, because naming a block writes into the note: a name written into one
 *  block moves every offset after it, so the blocks below are named first and the
 *  ones above are still where they were when their turn comes. Answered in document
 *  order all the same, because that is the order they are read in. */
export function blockTargets(view: EditorView, pos: number): string[] {
  const found: string[] = []

  for (const span of [...blocksFor(view, pos)].reverse()) {
    const target = blockTarget(view, span.from)
    if (target) found.unshift(target)
  }

  return found
}
