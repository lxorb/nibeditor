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

/** Scrolls so that the line holding `pos` starts at the top. Applied by the
 *  view after it has measured itself, so it needs no frame of its own. */
export function showLine(view: EditorView, pos: number) {
  const at = Math.min(Math.max(0, pos), view.state.doc.length)
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
}
