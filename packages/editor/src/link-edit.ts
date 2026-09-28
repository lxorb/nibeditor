import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

/** A link changed from its own menu: pointed somewhere else, or taken away with its
 *  words kept. What Chrome's editors, Obsidian, Notion and Typora all offer on a right
 *  click, and all of it a change to the text, so the undo takes it back as one step.
 *
 *  Every spelling of a link a note holds: `[words](address)`, `<address>`, an address
 *  written out, and `[[Note|words]]`. A picture is not one of them - its menu is its
 *  own - and neither is `![[embed]]`, which is a thing shown rather than a link. */

/** Where a link is, where it points, and what is left of it without the link. */
export interface LinkParts {
  from: number
  to: number
  /** The address or the note, as written: what editing the link selects. */
  target: { from: number; to: number }
  /** The words a reader sees, or null where taking the link away would leave the same
   *  link behind: an address written out is a link by being one. */
  words: string | null
}

const LINKS = new Set(['Link', 'Autolink', 'URL', 'Wikilink'])

/** The innermost link around a position, looking to one side of it. An address inside
 *  `[…](…)` or `<…>` belongs to the link it is written in, and one inside a picture or
 *  a reference definition is no link of its own. */
function linkToward(state: EditorState, pos: number, side: 1 | -1): SyntaxNode | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), LINKS)
  if (node?.name !== 'URL') return node

  const parent = node.parent?.name
  if (parent === 'Link' || parent === 'Autolink') return node.parent
  return parent === 'Image' || parent === 'LinkReference' ? null : node
}

function wikilinkParts(state: EditorState, node: SyntaxNode): LinkParts | null {
  const open = node.firstChild
  const close = node.lastChild
  if (!open || !close || open === close) return null
  if (state.doc.sliceString(open.from, open.from + 1) === '!') return null

  // `[[Note#heading|words]]` parses with everything up to the bar in its opening mark,
  // so a mark longer than the two brackets is a link with words of its own.
  const inner = open.from + 2
  const aliased = open.to > inner

  return {
    from: node.from,
    to: node.to,
    target: { from: inner, to: aliased ? open.to - 1 : close.from },
    words: state.doc.sliceString(aliased ? open.to : inner, close.from),
  }
}

function markdownParts(state: EditorState, node: SyntaxNode): LinkParts {
  const marks = node.getChildren('LinkMark')
  // An address written out is its own pointer.
  const pointer =
    node.name === 'URL' ? node : (node.getChild('URL') ?? node.getChild('LinkLabel'))
  // `[words]()` points nowhere yet, and editing it is typing between the brackets.
  const empty = marks[3] ? { from: marks[2]?.to ?? node.to, to: marks[3].from } : null
  const target = pointer
    ? { from: pointer.from, to: pointer.to }
    : (empty ?? { from: node.to, to: node.to })

  if (node.name !== 'Link') return { from: node.from, to: node.to, target, words: null }

  const open = marks[0]
  const close = marks[1]
  return {
    from: node.from,
    to: node.to,
    target,
    words: open && close ? state.doc.sliceString(open.to, close.from) : null,
  }
}

/** The link at a position, of whichever spelling, or null where there is none. */
export function linkPartsAt(state: EditorState, pos: number): LinkParts | null {
  const node = linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkParts(state, node) : markdownParts(state, node)
}

/** Selects where the link at `pos` points, which in the live preview is also what
 *  shows its markup: the next thing typed is the new address. */
export function editLink(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const parts = state.readOnly ? null : linkPartsAt(state, pos)
    if (!parts) return false

    dispatch(
      state.update({
        selection: EditorSelection.range(parts.target.from, parts.target.to),
        scrollIntoView: true,
        userEvent: 'select',
      }),
    )
    return true
  }
}

/** Takes the link at `pos` away and leaves its words where it was. */
export function removeLink(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const parts = state.readOnly ? null : linkPartsAt(state, pos)
    if (!parts || parts.words === null) return false

    dispatch(
      state.update({
        changes: { from: parts.from, to: parts.to, insert: parts.words },
        userEvent: 'delete.link',
      }),
    )
    return true
  }
}
