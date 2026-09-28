import { EditorSelection, type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { embedKind, formatWikilink } from '@nib/markdown/links'

/** Stores a file a note was handed and returns the path to write into the document,
 *  relative to the note. Supplied by the host so the editor package stays free of
 *  platform concerns. Named for the picture it was first written for; see `isKept`
 *  for the other files it is handed. */
export type ImageSink = (file: File) => Promise<string | null>

/** Turns a document-relative image path into something the view can load.
 *  A desktop webview cannot fetch `assets/x.png` off disk on its own. */
export const imageResolver = Facet.define<(src: string) => string, (src: string) => string>({
  combine: (values) => values[0] ?? ((src) => src),
})

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

/** A file a note keeps when it is dropped or pasted in: a picture, and whatever else
 *  the note can show - a PDF, sound, a film, a canvas - which is what a drop from the
 *  file manager into Obsidian or Typora does. Anything else is left to the platform:
 *  a zip in a note would be a link nothing in the app can open. */
function isKept(file: File): boolean {
  return isImage(file) || embedKind(file.name) !== null
}

/** What the note says for a file once it is stored. A picture is written as markdown
 *  writes one, as it always was here; anything else as the embed Obsidian writes for a
 *  dropped file, by its name alone, which the space resolves wherever the file sits -
 *  the same embed a recording is written as. */
function markdownFor(file: File, path: string): string {
  if (isImage(file)) return `![](${encodeURI(path)})`

  const name = path.slice(path.lastIndexOf('/') + 1)
  return formatWikilink({ target: name, heading: null, block: null, alias: null, embed: true })
}

const dropAt = StateEffect.define<number | null>()

/** Where the drop being written landed, or null when nothing is being written.
 *
 *  Held by the editor rather than in a variable, so that it is mapped through
 *  every change like any other position. Storing the picture is a round trip to
 *  the host - it writes the file into the note's folder - and the reader keeps
 *  typing through it, so an offset taken at the moment of the drop is an offset
 *  into a document that has moved on. The markdown landed in the wrong text, and
 *  when the note had grown shorter in the meantime the insertion was out of range
 *  and threw. */
const dropPoint = StateField.define<number | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(dropAt)) return effect.value
    }
    if (value === null || !transaction.docChanged) return value
    // Leaning right, so text typed at the drop point stays before the picture.
    return transaction.changes.mapPos(value, 1)
  },
})

/** Stores the files and writes them into the document as markdown.
 *
 *  `at` is where a drop landed; null is a paste, which goes to the selection.
 *  Exported so that where the markdown ends up can be tested without a pointer
 *  and without a DOM - the position outliving a round trip to the host is the
 *  whole of what is interesting here. */
export async function receiveImages(
  view: EditorView,
  files: File[],
  sink: ImageSink,
  at: number | null,
) {
  const kept = files.filter(isKept)
  if (!kept.length) return

  // Handed over before anything is awaited, so that whatever is typed while the
  // files are being written moves it along; see `dropPoint`.
  view.dispatch({ effects: dropAt.of(at) })

  const written: string[] = []
  for (const file of kept) {
    const path = await sink(file)
    if (path) written.push(markdownFor(file, path))
  }
  if (!written.length) return

  // Asked again, not remembered: the mode can have come on while the picture was
  // being written, and read-only mode refuses every change anyway - it would drop
  // the insertion and let the selection through, against a document that never
  // took it.
  if (view.state.readOnly) return

  const markdown = written.join('\n')
  const range = view.state.selection.main
  const mapped = view.state.field(dropPoint, false) ?? null
  const from = mapped ?? range.from
  const to = mapped ?? range.to

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: EditorSelection.cursor(from + markdown.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
    effects: dropAt.of(null),
  })
}

/** Paste or drop a picture, or a file the note can show, and it lands in the
 *  document as markdown. */
export function imageHandling(sink: ImageSink): Extension {
  return [
    dropPoint,
    EditorView.domEventHandlers({
      paste(event, view) {
        // Nothing is stored while the document is read-only: the sink writes the
        // file into the note's folder before any markdown is inserted, and a
        // file left behind by an insertion that was refused is litter.
        if (view.state.readOnly) return false

        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.some(isKept)) return false

        event.preventDefault()
        void receiveImages(view, files, sink, null)
        return true
      },

      drop(event, view) {
        if (view.state.readOnly) return false

        const files = [...(event.dataTransfer?.files ?? [])]
        if (!files.some(isKept)) return false

        event.preventDefault()
        void receiveImages(
          view,
          files,
          sink,
          view.posAtCoords({ x: event.clientX, y: event.clientY }),
        )
        return true
      },

      dragover(event, view) {
        // Without this the browser refuses the drop - which is what should
        // happen while the document is read-only, so there it is left unsaid.
        if (view.state.readOnly) return false

        if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) {
          event.preventDefault()
        }
        return false
      },
    }),
  ]
}
