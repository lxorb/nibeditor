/** A note's cover, drawn across the top of it while it is being written.
 *
 *  Not a block like the others here. Every other widget in this folder replaces
 *  its own source and gives it back the moment the caret lands inside; a cover has
 *  no source of its own on the page - it is two keys of front matter - and a band
 *  of picture that disappeared whenever somebody put the caret in the metadata
 *  would be the one thing on the page that flickers. So it is a widget *inserted*
 *  before the front matter rather than a replacement of anything, and the YAML
 *  under it behaves exactly as it did: rows while the caret is elsewhere, source
 *  the moment it is inside.
 *
 *  Dragging it up and down writes `cover-position` - which part of the picture the
 *  band is taken from - back into the front matter, as one whole number. One
 *  document change per drag, on release: a change per pointer event would be a
 *  hundred undo steps for one gesture. Arrow keys do the same in fives, because a
 *  picture nobody can drag is a picture nobody can place. */

import type { EditorView } from '@codemirror/view'
import { COVER_MIDDLE, COVER_POSITION_KEY, type Cover, coverOf } from '@nib/markdown/cover'
import { frontMatterEdit } from '@nib/markdown/front-matter'
import { imageResolver } from '../images'
import { label } from '../labels'
import { NibWidget } from './widget'

/** How far one arrow key moves the band, in percent. Five is a nudge you can see
 *  and twenty presses from end to end, which is a control rather than a slider. */
const STEP = 5

/** The position, clamped, as a whole number. */
function inside(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Writes the band's position into the note, or nothing where it is already
 *  there. The middle is written as any other number: a reader who dragged a cover
 *  back to the middle asked for the middle, and taking the key away again would be
 *  the app deciding the gesture did not happen. */
function writePosition(view: EditorView, position: number) {
  const edit = frontMatterEdit(view.state.doc.toString(), COVER_POSITION_KEY, String(position))
  if (!edit) return

  view.dispatch({ changes: edit, userEvent: 'input.cover.position' })
}

export class CoverWidget extends NibWidget {
  constructor(private readonly cover: Cover) {
    super()
  }

  override eq(other: CoverWidget) {
    return other.cover.src === this.cover.src && other.cover.position === this.cover.position
  }

  /** Kept off the height of a line: a band of picture is not text, and asking
   *  CodeMirror to guess at it makes it scroll in jumps. */
  override get estimatedHeight() {
    return 200
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'nib-cover'

    const picture = document.createElement('img')
    picture.src = view.state.facet(imageResolver)(this.cover.src)
    picture.alt = ''
    picture.draggable = false
    picture.style.objectPosition = `50% ${this.cover.position}%`
    host.append(picture)

    // A handle rather than the picture itself, so a drag over a cover is a drag of
    // the cover and never a selection of the text under it.
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'nib-cover-drag'
    handle.title = label('dragCover')
    handle.setAttribute('aria-label', label('dragCover'))
    host.append(handle)

    let from = this.cover.position
    let at: number | null = null

    /** What the picture is showing, without writing anything down: the drag has to
     *  be seen while the button is held, and one document change per pointer event
     *  would be one undo step per pointer event. */
    const show = (position: number) => {
      picture.style.objectPosition = `50% ${position}%`
    }

    const moved = (event: PointerEvent) => {
      if (at === null) return
      // Across the picture's own height, so dragging the whole band moves the
      // whole way through the picture however tall it is drawn.
      const height = picture.clientHeight || 1
      show(inside(from + ((at - event.clientY) / height) * 100))
    }

    const lifted = (event: PointerEvent) => {
      if (at === null) return
      const height = picture.clientHeight || 1
      const landed = inside(from + ((at - event.clientY) / height) * 100)
      at = null
      handle.releasePointerCapture(event.pointerId)
      if (landed !== from) writePosition(view, landed)
      from = landed
    }

    const pressed = (event: PointerEvent) => {
      if (view.state.readOnly || event.button !== 0) return
      event.preventDefault()
      at = event.clientY
      from = coverOf(view.state.doc.toString())?.position ?? COVER_MIDDLE
      handle.setPointerCapture(event.pointerId)
    }

    const keyed = (event: KeyboardEvent) => {
      const step = event.key === 'ArrowUp' ? STEP : event.key === 'ArrowDown' ? -STEP : 0
      if (step === 0 || view.state.readOnly) return
      event.preventDefault()
      const now = inside((coverOf(view.state.doc.toString())?.position ?? COVER_MIDDLE) + step)
      show(now)
      writePosition(view, now)
    }

    handle.addEventListener('pointerdown', pressed)
    handle.addEventListener('pointermove', moved)
    handle.addEventListener('pointerup', lifted)
    handle.addEventListener('pointercancel', lifted)
    handle.addEventListener('keydown', keyed)

    this.onDestroy(host, () => {
      handle.removeEventListener('pointerdown', pressed)
      handle.removeEventListener('pointermove', moved)
      handle.removeEventListener('pointerup', lifted)
      handle.removeEventListener('pointercancel', lifted)
      handle.removeEventListener('keydown', keyed)
    })

    return host
  }

  /** The widget runs its own dragging, so CodeMirror should not read the pointer
   *  events inside it as a selection being made in the document. */
  override ignoreEvent() {
    return true
  }
}
