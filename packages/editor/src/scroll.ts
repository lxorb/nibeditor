import type { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** The document position at the top of what is on screen. A steadier thing
 *  to remember than a pixel offset: line heights are estimates until they
 *  are measured, and change with the width of the window, so the same offset
 *  lands on a different line from one opening to the next. A position does
 *  not. */
export function topLine(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  return view.lineBlockAtHeight(Math.max(0, top)).from
}

/** Which line the caret is on, counting from zero. The document knows this
 *  without reading itself: counting newlines up to the caret is a pass over
 *  the note, and the outline used to do exactly that on every keystroke. */
export function caretLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number - 1
}

/** A view put back at the line starting at `pos`: against the top, or nothing for
 *  the first line, whose place is the note's top - `y: 'start'` there scrolls past
 *  the room over the title. */
export function placeAt(pos: number): StateEffect<unknown> | null {
  return pos > 0 ? EditorView.scrollIntoView(pos, { y: 'start' }) : null
}

/** Scrolls so that the line holding `pos` starts at the top; see `placeAt`. Applied
 *  by the view after it has measured itself, so it needs no frame of its own. */
export function showLine(view: EditorView, pos: number) {
  const place = placeAt(
    view.state.doc.lineAt(Math.min(Math.max(0, pos), view.state.doc.length)).from,
  )
  if (place) view.dispatch({ effects: place })
  else view.scrollDOM.scrollTop = 0
}
