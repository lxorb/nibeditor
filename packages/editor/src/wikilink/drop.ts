import { EditorSelection, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { linkWriter, noteIndex } from './notes'

/** A row of the app's file list let go over the words: a link to it at the drop, as
 *  in Obsidian. Which notes a drag carries is the app's to say, as paths inside the
 *  space, and a drag carrying none goes the way it always went. */

/** Read at `dragover`, where a browser hides the data, so the app answers from what
 *  it remembers of its own drag. */
export const noteCarrier = Facet.define<
  (transfer: DataTransfer | null) => readonly string[],
  (transfer: DataTransfer | null) => readonly string[]
>({ combine: (values) => values[0] ?? (() => []) })

/** The writer, fetched by the first drop rather than carried to the first paint. */
export const noteLinksCode = () => import('./note-links')

export const noteDrops: Extension = EditorView.domEventHandlers({
  dragover(event, view) {
    // Read-only says nothing, which leaves the drop to the pane: it opens the row.
    if (view.state.readOnly || !carried(event, view).length) return false

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    return false
  },

  drop(event, view) {
    const paths = carried(event, view)
    if (view.state.readOnly || !paths.length) return false

    event.preventDefault()
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    view.focus()

    void noteLinksCode().then(({ noteLinks }) => {
      const { state } = view
      if (state.readOnly) return

      const text = noteLinks(state.facet(noteIndex), paths, state.facet(linkWriter))
      const from = Math.min(at, state.doc.length)

      view.dispatch({
        changes: { from, insert: text },
        selection: EditorSelection.cursor(from + text.length),
        userEvent: 'input.drop',
      })
    })
    return true
  },
})

function carried(event: DragEvent, view: EditorView): readonly string[] {
  return view.state.facet(noteCarrier)(event.dataTransfer)
}
