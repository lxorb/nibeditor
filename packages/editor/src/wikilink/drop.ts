import { EditorSelection, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isAudioTarget, isImageTarget, isVideoTarget } from '@nib/markdown/links'
import { about } from './complete'
import { type LinkWrite, linkWriter, type NoteIndex, noteIndex } from './notes'

/** A note dragged out of the file list and let go over the words: a link to it at
 *  the drop, which is what Obsidian does with the same gesture.
 *
 *  Which notes a drag carries is the app's to say, because the file list is the
 *  app's and so is the type it writes into the transfer; it arrives through
 *  `noteCarrier` as paths inside the space. A drag carrying none is left alone,
 *  so text dragged within the note and a picture dropped from outside go the way
 *  they always went. The link is spelled by `linkWriter`, the one writer the `[[`
 *  popup uses too, so the Links setting answers here as well. */

/** The notes a drag carries, relative to the space; empty for a drag that carries
 *  none. Read at `dragover`, when a browser shows the types and hides the data,
 *  so the app answers from what it remembers of its own drag. */
export const noteCarrier = Facet.define<
  (transfer: DataTransfer | null) => readonly string[],
  (transfer: DataTransfer | null) => readonly string[]
>({ combine: (values) => values[0] ?? (() => []) })

/** The links to some notes of the space: one per path, each on its own line, which is a list
 *  of links a note can hold. A picture, a sound or a film is embedded rather than
 *  linked, because `![[pic.png]]` is how a note shows one. */
export function noteLinks(
  index: NoteIndex,
  paths: readonly string[],
  write: (target: LinkWrite) => string,
): string {
  return paths.map((path) => linkFor(index, path, write)).join('\n')
}

function linkFor(index: NoteIndex, path: string, write: (target: LinkWrite) => string): string {
  const note = index.notes.find((one) => one.path === path)
  if (note) return write(about(index, note))

  // Anything else is a file, named with its extension the way `[[paper.pdf]]` is,
  // or a note that is not written yet: a folder's own, which the name alone finds
  // once it is.
  const file = index.files.includes(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const link = write({ name: file ? name : name.replace(/\.[^.]+$/, ''), path, from: index.path })

  return file && shown(path) ? `!${link}` : link
}

/** Whether a note shows the file rather than pointing at it. */
function shown(path: string): boolean {
  return isImageTarget(path) || isAudioTarget(path) || isVideoTarget(path)
}

export const noteDrops: Extension = EditorView.domEventHandlers({
  dragover(event, view) {
    // Read-only refuses the drop by saying nothing, which leaves the pane to
    // answer it: a note that cannot take a link opens the one dropped on it.
    if (view.state.readOnly || !carried(event, view).length) return false

    event.preventDefault()
    // The only effect a move out of the list allows; the link is what lands.
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    return false
  },

  drop(event, view) {
    if (view.state.readOnly) return false
    const paths = carried(event, view)
    if (!paths.length) return false

    event.preventDefault()
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    const text = noteLinks(view.state.facet(noteIndex), paths, view.state.facet(linkWriter))

    view.focus()
    view.dispatch({
      changes: { from: at, insert: text },
      selection: EditorSelection.cursor(at + text.length),
      userEvent: 'input.drop',
    })
    return true
  },
})

function carried(event: DragEvent, view: EditorView): readonly string[] {
  return view.state.facet(noteCarrier)(event.dataTransfer)
}
