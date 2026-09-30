/** A `#tag` pressed in a note asks the space's search about it: with the modifier,
 *  the way a link is followed (links.ts), since a plain click places the caret in
 *  words being written; alone in a note nobody can write in. What asking means is
 *  the app's, through a facet; an editor given none leaves the press to the caret
 *  and its tags promise nothing. */

import { Facet, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { label } from './labels'
import { MAC, modifier } from './links'

/** Asks the space about a tag, given its name without the hash. */
export type TagOpener = (tag: string) => void

export const tagOpener = Facet.define<TagOpener, TagOpener | null>({
  combine: (values) => values[0] ?? null,
})

/** A tag's tooltip, or null where a press would do nothing. */
export function tagTitle(state: EditorState): string | null {
  if (!state.facet(tagOpener)) return null
  return label(MAC ? 'searchTagMac' : 'searchTag')
}

export const tagClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(modifier(event) || view.state.readOnly)) return false

    const open = view.state.facet(tagOpener)
    if (!open) return false

    // A click can land on a text node, so the target is asked, not assumed.
    const target = event.target
    const tag = target instanceof Element ? target.closest('.tag[data-tag]') : null
    const name = tag?.getAttribute('data-tag')
    if (!name) return false

    event.preventDefault()
    open(name)
    return true
  },
})
