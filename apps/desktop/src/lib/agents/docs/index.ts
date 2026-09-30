/** An agent reading and editing notes, as a collaborator would: the interface the
 *  window's agent verbs call. See docs/agent-native.md 8.1 to 8.5 and 13.1.
 *
 *  Three calls and the one that writes a whole note: `readNote`, `editNote`,
 *  `writeNote` and `undoAgent`. This implementation works on today's editor - the
 *  open document's shared state, a CodeMirror transaction, the change sets the
 *  history keeps. Under sync v2 an agent is one more peer on a note's Yjs document
 *  instead (8.10): its own client id, anchors as `Y.RelativePosition`s, `UndoManager`
 *  tracking its origin, awareness for its caret. That peer is a second `NoteDocs`,
 *  and nothing that calls these has to change.
 *
 *  The one module here that reaches the workspace, and it is only ever imported on
 *  the first agent call: nothing of lib/agents is in the first paint. */

import { documentOf } from '@nib/editor'
import { links } from '../../link-index.svelte'
import { withinSpace } from '../../space-paths'
import { invoke } from '../../tauri'
import { theme } from '../../theme.svelte'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import { type Desk, located, type NoteAt } from './desk'
import { editNote, type NoteEdited, undoAgent, undoAt, writeNote } from './edit'
import type { Agent } from './presence'
import { type NoteRead, readNote } from './read'

export type { Agent } from './presence'
export type { NoteAt } from './desk'
export type { NoteEdited } from './edit'
export type { NoteRead } from './read'
export { DocError, type Problem } from './problem'

/** What an agent can do with notes. */
export interface NoteDocs {
  readNote(at: NoteAt, include?: unknown): Promise<NoteRead>
  editNote(agent: Agent, at: NoteAt, edits: unknown, ifRev?: string): Promise<NoteEdited>
  writeNote(agent: Agent, at: NoteAt, text: string, ifRev?: string): Promise<NoteEdited>
  undoAgent(agent: Agent, at: NoteAt): Promise<{ undone: number }>
}

/** The app itself, as the docs see it. */
const desk: Desk = {
  get spaces() {
    return workspace.spaces
  },
  get activeSpace() {
    return workspace.activeSpace
  },
  documentAt: (path) => workspace.documentAt(path),
  noteText: (path) => workspace.noteText(path),
  replaceInNotes: (changes, keeping) => workspace.replaceInNotes(changes, keeping),
  frontView(note) {
    const tab = workspace.active
    if (tab?.note !== note) return null

    const view = views.of(tab.paneId)
    return view && documentOf(view) === note.live ? view : null
  },
  linksOf: (path) => links.outgoing(path),
  backlinksOf: (path) => links.backlinks(path),
  snapshot: async (path, content, source) => {
    await invoke('snapshot_note', { path, content, source }).catch(() => undefined)
  },
  scheme: () => theme.current,
}

/** The notes of this window, on today's editor. */
export const notes: NoteDocs = {
  readNote: (at, include) => readNote(desk, at, include),
  editNote: (agent, at, edits, ifRev) => editNote(desk, agent, at, edits, ifRev),
  writeNote: (agent, at, text, ifRev) => writeNote(desk, agent, at, text, ifRev),
  undoAgent: (agent, at) => undoAgent(desk, agent, at),
}

/** Takes back one agent's edits in the note at `path`, a path on this disk: what the
 *  palette's row and the activity panel ask, about the note in front. */
export async function undoAgentIn(agent: Agent, path: string): Promise<{ undone: number }> {
  for (const space of workspace.spaces) {
    const relative = withinSpace(space.root, path)
    if (relative !== null)
      return undoAt(desk, agent, located(desk, { path: relative, space: space.id }))
  }

  return { undone: 0 }
}
