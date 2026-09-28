import type { EditorState } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { isTabFile, linkTarget, type Wikilink } from '@nib/markdown/links'
import { label } from '../labels'
import { type LinkPress, MAC, modifier } from '../links'
import { linkAt } from './at'
import { jumpFor, noteIndex, type NoteJump, noteOpener } from './notes'

/** Following a link between notes, and what the link says about itself.
 *
 *  The same gesture web links already have (see links.ts): a plain click puts
 *  the caret where it landed, and the modifier follows the link instead, so
 *  nothing in the text becomes unreachable. Reading mode has no caret to place,
 *  so there a plain click follows. */

/** What a modifier-click on a link will do, in the wordings that covers: open a
 *  note, make one, or open a file, with the key each platform uses. */
const HOW = {
  open: { mac: 'openNoteMac', other: 'openNote' },
  create: { mac: 'createNoteMac', other: 'createNote' },
  file: { mac: 'openLinkMac', other: 'openLink' },
} as const

/** The tooltip on a link to a note: where it goes, and what a click will do -
 *  which for a name nothing answers to is to make the note.
 *
 *  A PDF is a file rather than a note, so a click opens it and a name nothing
 *  answers to is nothing a click can make; the muted link says that on its own. */
export function noteLinkTitle(link: Wikilink, missing: boolean): string {
  const wording = isTabFile(link.target) ? HOW.file : HOW[missing ? 'create' : 'open']
  return `${linkTarget(link)}\n${label(MAC ? wording.mac : wording.other)}`
}

/** Where the link at a position goes, or null when there is no link there.
 *  Exported so what a click will do can be asked without a pointer, or a DOM. */
export function jumpAt(state: EditorState, pos: number): NoteJump | null {
  const link = linkAt(state, pos)
  return link && jumpFor(state.facet(noteIndex), link, link.kind)
}

/** Opens the note a click landed on, if it landed on one, saying how it was
 *  pressed so the app can put it in a tab of its own. */
function followNoteAt(view: EditorView, pos: number, press?: LinkPress): boolean {
  const jump = jumpAt(view.state, pos)
  if (!jump) return false

  view.state.facet(noteOpener)(jump, press)
  return true
}

/** Follows the link the caret sits in, with no pointer involved. Gives way
 *  when there is no link there, so the key it is on goes on to whatever else
 *  wants it. Unbound until a reader or a preset gives it a key; Obsidian's is
 *  Alt+Enter. */
export const followNoteAtCaret: Command = (view) =>
  followNoteAt(view, view.state.selection.main.head)

/** The middle button follows a link to a note either way, as it does a link to the
 *  web: it places no caret, so it is ambiguous nowhere. See `linkClicks`. */
export const noteClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const asked =
      event.button === 1 || (event.button === 0 && (modifier(event) || view.state.readOnly))
    if (!asked) return false

    // An event's target is only an element some of the time, so it is asked
    // rather than assumed - the same reading links.ts does.
    const target = event.target
    const link = target instanceof Element ? target.closest('.nib-link[data-note]') : null
    if (!link) return false

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    event.preventDefault()
    return followNoteAt(view, pos, event)
  },
})
