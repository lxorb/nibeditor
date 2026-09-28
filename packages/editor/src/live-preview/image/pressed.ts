import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { embedKind, embedSize } from '@nib/markdown/links'
import { imageResolver } from '../../images'
import { linkAt } from '../../wikilink/at'
import { openLightbox } from './lightbox'
import { imageAt } from './markup'

/** The picture a right click landed on, for the menu the app shows over it.
 *
 *  Either spelling: `![words](shot.png)` and the `<img>` tag a resized one becomes,
 *  which the frame in widget.ts draws, and `![[shot.png]]`, which embed.ts draws. The
 *  menu asks the element it was opened on, and the document says the rest - where the
 *  picture is written, and what it is of - the way the frame's own toolbar does. */

export interface Picture {
  from: number
  to: number
  /** As the note writes it: a path beside the note, a bare name, or an address. */
  src: string
  alt: string
}

/** The picture written at `pos`, where one starts there. */
export function pictureAt(state: EditorState, pos: number): Picture | null {
  const image = imageAt(state, pos)
  if (image) return { from: image.from, to: image.to, src: image.src, alt: image.alt }

  const link = linkAt(state, pos)
  if (!link?.embed || link.from !== pos || embedKind(link.target) !== 'image') return null

  // After the bar is either a size or what the picture is of; see `embedSize`.
  const alt = link.alias !== null && !embedSize(link.alias) ? link.alias : ''
  return { from: link.from, to: link.to, src: link.target, alt }
}

/** The picture under an element of the editor, or null where the element is not one. */
export function pressedPicture(view: EditorView, target: EventTarget | null): Picture | null {
  const drawn = target instanceof Element ? target.closest('.nib-image-frame, .nib-embed-image') : null
  if (!drawn || !view.contentDOM.contains(drawn)) return null

  return pictureAt(view.state, view.posAtDOM(drawn))
}

/** Where the picture can be loaded from, which on a desktop is not where the note
 *  says it is; see `imageResolver`. */
export function pictureUrl(state: EditorState, picture: Picture): string {
  return state.facet(imageResolver)(picture.src)
}

/** The picture in the full-window view a double click opens. */
export function showPicture(view: EditorView, picture: Picture) {
  openLightbox(view, pictureUrl(view.state, picture), picture.alt)
}

/** Takes the picture out of the note, as the bin on its toolbar does. The file stays:
 *  a pasted picture is named by what it holds, so another note may be showing it. */
export function deletePicture(picture: Picture): StateCommand {
  return ({ state, dispatch }) => {
    // Asked again rather than trusted: the note can have moved on while the menu was
    // open, and a range that no longer holds the picture holds somebody's words.
    const still = pictureAt(state, picture.from)
    if (state.readOnly || still?.to !== picture.to) return false

    dispatch(
      state.update({
        changes: { from: picture.from, to: picture.to },
        selection: EditorSelection.cursor(picture.from),
        userEvent: 'delete.image',
      }),
    )
    return true
  }
}
