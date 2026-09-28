/** An address pasted over selected words, as the link it makes of them.
 *
 *  Its own module, fetched behind the door in line-door.ts: the paste handler in
 *  paste.ts only has to recognise an address to answer the event, and the reading of
 *  the syntax tree that decides whether the words can be a link waits for the one
 *  paste that needs it. */

import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state'
import type { Tree } from '@lezer/common'
import { inCode } from './code'
import { enclosingNamed } from './nodes'
import { ADDRESS } from './paste'

/** Where a selection is already something other than words to link: the inside of a
 *  link, a picture, an address, a formula, markup, or the note's metadata. Code is
 *  asked of `inCode`, which is the one list of what code is. */
const NOT_WORDS = new Set([
  'Link',
  'Image',
  'URL',
  'Autolink',
  'Wikilink',
  'LinkReference',
  'InlineMath',
  'BlockMath',
  'HTMLTag',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'FrontMatter',
])

function linkable(state: EditorState, range: SelectionRange): boolean {
  if (range.empty) return false

  const words = state.sliceDoc(range.from, range.to)
  // Words across a blank line are two paragraphs, which one link cannot hold; and an
  // address selected is an address being replaced, the way GitHub reads it.
  if (/\n[ \t]*\n/.test(words) || ADDRESS.test(words.trim())) return false

  const tree = syntaxTree(state)
  if (halfOfSomething(tree, range.from, range.to)) return false

  for (const [pos, side] of [
    [range.from, 1],
    [range.to, -1],
  ] as const) {
    if (inCode(state, pos, side)) return false
    if (enclosingNamed(tree.resolveInner(pos, side), NOT_WORDS)) return false
  }

  return true
}

/** Whether a piece of markup starts inside the selection and ends outside it, or the
 *  other way round - half of a `**bold**`, one item of a list and the start of the
 *  next - which one pair of brackets around the selection would break. */
function halfOfSomething(tree: Tree, from: number, to: number): boolean {
  let half = false
  tree.iterate({
    from,
    to,
    enter: (node) => {
      const startsInside = node.from > from && node.from < to
      const endsInside = node.to > from && node.to < to
      if ((startsInside && node.to > to) || (endsInside && node.from < from)) half = true
      return !half
    },
  })
  return half
}

/** An address as a link's destination: as it is, or in angle brackets where a
 *  bracket in it would otherwise end the link early. A bare `www.` is given the
 *  scheme a browser would have put in front of it. */
function destination(typed: string): string {
  const address = /^www\./i.test(typed) ? `https://${typed}` : typed
  let depth = 0
  for (const char of address) {
    if (char === '(') depth += 1
    if (char === ')' && --depth < 0) break
  }
  return depth === 0 ? address : `<${address}>`
}

/** An address pasted over selected words, as the link it makes of them:
 *  `[words](address)`. Obsidian, Notion and GitHub all read the paste that way, and a
 *  reader who selected words and pasted an address over them did not mean to lose
 *  the words.
 *
 *  The markdown package has one of these as well, `pasteURLAsLink`, and nib turns it
 *  off (see modes.ts): it carries the line break a copy often ends with into the link,
 *  refuses words with any markup in them, links the main selection only, leaves the
 *  words selected rather than the caret after the link, and a paste from the menu
 *  never reaches it. This is the one.
 *
 *  Null where the paste is anything else - more than an address, nothing selected,
 *  or a selection in code, in a link already, or in anything else that is not prose
 *  - which leaves the paste to go in as it stands. Ctrl+Shift+V never comes here, so
 *  plain is always a key away. */
export function linkedPaste(state: EditorState, text: string): TransactionSpec | null {
  const address = text.trim()
  if (!ADDRESS.test(address)) return null
  if (!state.selection.ranges.every((range) => linkable(state, range))) return null

  const target = destination(address)
  return {
    ...state.changeByRange((range) => {
      const insert = `[${state.sliceDoc(range.from, range.to)}](${target})`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      }
    }),
    scrollIntoView: true,
    userEvent: 'input.paste',
  }
}
