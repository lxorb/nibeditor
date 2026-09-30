/** A stand-in for the app, for the tests of this folder: a disk, documents that are
 *  really open - a `NoteDoc` with its live shared text - and panes on them that can be
 *  typed in, pressed Ctrl+Z in and looked at. What the app does with these is what
 *  the real desk in index.ts does; see desk.ts. */

import {
  agentsOf,
  documentOf,
  EditorState,
  type EditorView,
  remoteCarets,
  undoEdit,
} from '@nib/editor'
import type { Change } from '../../search/apply'
import { NoteDoc } from '../../workspace/documents.svelte'
import type { Keeping } from '../../workspace/note-text'
import type { Desk, Space } from './desk'

const SPACE: Space = { id: 's1', name: 'Space', root: '/space' }

/** A pane on a document: a state and a dispatch, joined to the document the way an
 *  editor is, with the carets extension so an agent's caret can be seen. */
export class Pane {
  state: EditorState

  constructor(
    readonly note: NoteDoc,
    caret = 0,
  ) {
    this.state = EditorState.create({
      doc: note.live.text,
      selection: { anchor: caret },
      extensions: [remoteCarets()],
    })
    note.live.join(this)
  }

  dispatch(spec: Parameters<EditorState['update']>[0]) {
    this.state = this.state.update(spec).state
  }

  get text(): string {
    return this.state.doc.toString()
  }

  get caret(): number {
    return this.state.selection.main.head
  }

  /** A keystroke, the way the editor hands one over; see editor.ts. */
  type(at: number, insert: string) {
    this.change({ from: at, insert }, at + insert.length)
  }

  /** Words taken out, the caret left where they were. */
  erase(from: number, to: number) {
    this.change({ from, to }, from)
  }

  select(from: number, to: number) {
    this.state = this.state.update({ selection: { anchor: from, head: to } }).state
  }

  undo(): boolean {
    return undoEdit(this as unknown as EditorView)
  }

  get agents() {
    return agentsOf(this.state)
  }

  private change(changes: { from: number; to?: number; insert?: string }, caret: number) {
    const made = this.state.update({ changes, selection: { anchor: caret } })
    this.state = made.state
    documentOf(this)?.local(made.changes, made.state.selection, this)
  }
}

/** A space with notes on its disk, some of them open. Paths are relative to it. */
export function deskWith(notes: Record<string, string>, open: readonly string[] = []) {
  const disk = new Map(Object.entries(notes).map(([path, text]) => [`${SPACE.root}/${path}`, text]))
  const documents = new Map<string, NoteDoc>()
  const written: { changes: readonly Change[]; keeping: Keeping | undefined }[] = []
  const kept: { path: string; content: string; source: string }[] = []
  let front: Pane | null = null

  const opened = (path: string, caret = 0): Pane => {
    const at = `${SPACE.root}/${path}`
    const note = new NoteDoc(
      { kind: 'note', path: at, name: path, text: disk.get(at) ?? '', dirty: false },
      () => undefined,
    )
    documents.set(at, note)
    return new Pane(note, caret)
  }

  const panes = Object.fromEntries(open.map((path) => [path, opened(path)]))

  const desk: Desk = {
    spaces: [SPACE],
    activeSpace: SPACE,
    documentAt: (path) => documents.get(path) ?? null,
    noteText: (path) => {
      const note = documents.get(path)
      if (note) {
        note.flush()
        return Promise.resolve(note.text)
      }
      return Promise.resolve(disk.get(path) ?? null)
    },
    replaceInNotes: (changes, keeping) => {
      written.push({ changes, keeping })
      for (const change of changes) disk.set(change.path, change.after)
      return Promise.resolve()
    },
    frontView: (note) => (front?.note === note ? (front as unknown as EditorView) : null),
    linksOf: () => [],
    backlinksOf: () => [],
    snapshot: (path, content, source) => {
      kept.push({ path, content, source })
      return Promise.resolve()
    },
    scheme: () => 'dark',
  }

  return {
    desk,
    panes,
    disk,
    written,
    kept,
    /** Opens a note that was closed, as a pane on a new document. */
    open: opened,
    /** Closes a note: its pane and its document go, and the disk keeps its words. */
    close: (path: string) => {
      const at = `${SPACE.root}/${path}`
      const note = documents.get(at)
      if (note) disk.set(at, note.live.text.toString())
      documents.delete(at)
    },
    inFront: (pane: Pane | null) => {
      front = pane
    },
    fileOf: (path: string) => disk.get(`${SPACE.root}/${path}`),
  }
}
