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
import { isScratchpad } from '../../scratchpad/is.svelte'
import { scratchpad } from '../../scratchpad/pad'
import { withinSpace } from '../../space-paths'
import { invoke } from '../../tauri'
import { theme } from '../../theme.svelte'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import { isDraft } from '../../workspace/drafts'
import { type Desk, located, type NoteAt, SCRATCHPAD_TAB } from './desk'
import {
  editNote,
  type NoteEdited,
  putBackAt,
  undoAgent,
  undoAt,
  undoSomeAt,
  writeNote,
} from './edit'
import type { Agent } from './presence'
import { type NoteRead, readNote } from './read'

export type { Agent } from './presence'
export type { NoteAt } from './desk'
export type { NoteEdited } from './edit'
export type { NoteRead } from './read'
export { DocError, type Problem } from './problem'
export { onTracks, trackedAgents, tracksOf } from './edit'
export type { Span } from './track'

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
  draftIn(id) {
    const tab = workspace.tabs.find((one) => one.id === id)
    return tab?.kind === 'note' && isDraft(tab.note) ? tab.note : null
  },
  padText: () => scratchpad.text(),
  padWrite: (before, edits) => scratchpad.replace(before, edits),
  scheme: () => theme.current,
}

/** A call naming the scratchpad, with where it is on this disk: asked once a run, and
 *  only of a call that names it. */
async function padded(at: NoteAt): Promise<NoteAt> {
  return at.tab === SCRATCHPAD_TAB ? { ...at, pad: await scratchpad.where() } : at
}

/** The notes of this window, on today's editor. */
export const notes: NoteDocs = {
  readNote: async (at, include) => readNote(desk, await padded(at), include),
  editNote: async (agent, at, edits, ifRev) =>
    editNote(desk, agent, await padded(at), edits, ifRev),
  writeNote: async (agent, at, text, ifRev) =>
    writeNote(desk, agent, await padded(at), text, ifRev),
  undoAgent: async (agent, at) => undoAgent(desk, agent, await padded(at)),
}

/** Takes back one agent's edits in the note at `path`, a path on this disk: what the
 *  palette's row and the activity panel ask, about the note in front. */
export async function undoAgentIn(agent: Agent, path: string): Promise<{ undone: number }> {
  const note = locatedAt(path)
  return note ? undoAt(desk, agent, note) : { undone: 0 }
}

/** The note at `path`, a path on this disk or a draft's `unsaved:` key, as the
 *  space it is in names it; null for one that is not there. */
function locatedAt(path: string) {
  if (isScratchpad(path)) return located(desk, { path: '', tab: SCRATCHPAD_TAB, pad: path })
  if (path.startsWith('unsaved:')) {
    const key = path.slice('unsaved:'.length)
    const tab = workspace.tabs.find((one) => one.kind === 'note' && one.note.key === key)
    return tab ? located(desk, { path: '', tab: tab.id }) : null
  }
  for (const space of workspace.spaces) {
    const relative = withinSpace(space.root, path)
    if (relative !== null) return located(desk, { path: relative, space: space.id })
  }
  return null
}

/** Some of one agent's edits of the note at `path` taken back (the review's Undo, a
 *  rewind): the ids that went. */
export async function undoSomeIn(
  agent: Agent,
  path: string,
  ids: ReadonlySet<string>,
  token?: string,
): Promise<string[]> {
  const note = locatedAt(path)
  return note ? undoSomeAt(desk, agent, note, ids, token) : []
}

/** What a rewind took back of one agent's edits of the note at `path`, put back. */
export async function putBackIn(agent: Agent, path: string, token: string): Promise<string[]> {
  const note = locatedAt(path)
  return note ? putBackAt(desk, agent, note, token) : []
}
