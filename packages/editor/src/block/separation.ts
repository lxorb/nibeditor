/** What goes between two blocks so that they stay two blocks.
 *
 *  Markdown has no walls between blocks, only blank lines, and it reads the lack of
 *  one generously: a line of words straight under a list item is more of that item,
 *  straight under a quote more of the quote, straight under a table another row. So
 *  a blank line goes between any two blocks, with one exception - two list items,
 *  where a blank line is not a wall but the difference between a tight list and a
 *  loose one, and where the list they are in says which it is.
 *
 *  Even two items need the blank line when the lower one could not start a list
 *  where it stands: a numbered item that does not count from one, straight under
 *  the words of a list that is not numbered the same way, is read as more of those
 *  words.
 *
 *  Pure reading of the syntax tree; move.ts is what writes. */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosing } from '../nodes'

/** One side of a seam between two blocks.
 *
 *  `moving` marks the block being moved: its own list is the one it is leaving, so
 *  whether that list was tight or loose says nothing about where it lands. */
export interface Side {
  /** The list items the side's last line is inside of, innermost first. */
  items: SyntaxNode[]
  /** The list item the side's first line begins, when it begins one. */
  item: SyntaxNode | null
  /** How far in the side's first line starts, where it will stand. */
  indent: number
  moving: boolean
}

/** How far in a line's words start, in characters. */
export function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

/** The list items a position is inside of, innermost first. */
export function itemsAround(state: EditorState, pos: number): SyntaxNode[] {
  return [...enclosing(syntaxTree(state).resolveInner(pos, -1))].filter(
    (node) => node.name === 'ListItem',
  )
}

/** The outermost list item that begins on a line, or null. */
function itemStarting(state: EditorState, line: Line): SyntaxNode | null {
  let found: SyntaxNode | null = null
  for (const node of enclosing(
    syntaxTree(state).resolveInner(line.from + indentOf(line.text), 1),
  )) {
    if (node.name === 'ListItem' && node.from >= line.from) found = node
  }

  return found
}

/** A line of the note as the upper side of a seam. */
export function above(state: EditorState, line: Line): Side {
  return { items: itemsAround(state, line.to), item: null, indent: 0, moving: false }
}

/** A line of the note as the lower side of a seam. */
export function below(state: EditorState, line: Line, indent = indentOf(line.text)): Side {
  return { items: [], item: itemStarting(state, line), indent, moving: false }
}

/** An item's marker, as what decides whether it can start a list under words. */
function markerOf(state: EditorState, item: SyntaxNode): { number: number | null; tail: string } {
  const mark = item.getChild('ListMark')
  const text = mark ? state.doc.sliceString(mark.from, mark.to) : '-'
  const ordered = /^(\d+)([.)])$/.exec(text)

  return ordered
    ? { number: Number(ordered[1]), tail: ordered[2] ?? '.' }
    : { number: null, tail: text }
}

/** Whether the lower side can stand straight under the upper one and still be an
 *  item of its own. A bullet can always start a list, and so can a numbered item
 *  counting from one; any other number only carries on a numbered list already
 *  there. */
function joins(state: EditorState, upper: Side, lower: Side): lower is Side & { item: SyntaxNode } {
  if (!lower.item || !upper.items.length) return false

  const mark = markerOf(state, lower.item)
  if (mark.number === null || mark.number === 1) return true

  return upper.items.some((item) => {
    const other = markerOf(state, item)
    return other.number !== null && other.tail === mark.tail
  })
}

/** Whether a list is loose: a blank line between any two of its items. */
function loose(state: EditorState, list: SyntaxNode): boolean {
  const doc = state.doc
  return list
    .getChildren('ListItem')
    .slice(1)
    .some((item) => {
      const line = doc.lineAt(item.from).number
      return line > 1 && doc.line(line - 1).text.trim() === ''
    })
}

/** The list an item standing `indent` in would carry on, of the ones the upper
 *  side is inside: the innermost whose items start no further in. */
function listAt(state: EditorState, items: SyntaxNode[], indent: number): SyntaxNode | null {
  const doc = state.doc
  const item = items.find((one) => one.from - doc.lineAt(one.from).from <= indent) ?? items.at(-1)
  return item?.parent ?? null
}

/** A gap that is at least one blank line: the one already there when it is. */
function blank(existing: string | null): string {
  return existing !== null && existing.split('\n').length > 2 ? existing : '\n\n'
}

/** What goes between two sides. `existing` is what is between them now, kept when
 *  it is a blank line or more, so a note written with two blank lines between its
 *  paragraphs keeps them. */
export function gap(state: EditorState, upper: Side, lower: Side, existing: string | null): string {
  if (!joins(state, upper, lower)) return blank(existing)

  const lists = [
    upper.moving ? null : listAt(state, upper.items, lower.indent),
    lower.moving ? null : lower.item.parent,
  ].filter((list) => list !== null)
  const hosts = lists.length ? lists : [lower.item.parent].filter((list) => list !== null)

  return hosts.some((list) => loose(state, list)) ? '\n\n' : '\n'
}
