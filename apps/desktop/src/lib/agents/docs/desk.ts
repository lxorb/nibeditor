/** What an agent's reads and edits of notes need of the app, and nothing more.
 *
 *  An interface rather than the workspace itself, for two reasons. Everything in
 *  this folder is tested by handing it a stand-in with real documents in it, the way
 *  workspace/note-text.test.ts is. And it is the whole of the seam the Yjs peer of
 *  sync v2 replaces (docs/agent-native.md 8.10): the words of a note, the note in
 *  front, the one write path. The app's own is built in `index.ts`, the one module
 *  here that reaches the workspace, so nothing is imported before an agent asks.
 *
 *  Which space a note is in is said by the agent and never switched to: an agent
 *  working in another space while the reader writes in this one must not change the
 *  reader's screen (8.6). */

import type { EditorView } from '@nib/editor'
import { insideOnly } from '../../automation/inside'
import type { Change } from '../../search/apply'
import type { Edit } from '../../search/replace'
import { insideSpace, isMarkdownPath, nameOf } from '../../space-paths'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Keeping } from '../../workspace/note-text'
import { DocError } from './problem'

export interface Space {
  id: string
  name: string
  root: string
}

export interface Desk {
  readonly spaces: readonly Space[]
  readonly activeSpace: Space | null
  /** The document a file is open as. */
  documentAt(path: string): NoteDoc | null
  /** A note's words as they stand: the open document's, else the disk's. */
  noteText(path: string): Promise<string | null>
  /** The one road a note nobody has open is written by: a snapshot, the write, the
   *  index told, sync nudged; see workspace/note-text.ts. */
  replaceInNotes(changes: readonly Change[], keeping?: Keeping): Promise<void>
  /** The view the reader is looking at, when it shows this document. */
  frontView(note: NoteDoc): EditorView | null
  /** The links out of a note and into it, off the link index, which knows the space
   *  that is open; a note of another space has none it can say. */
  linksOf(path: string): unknown[]
  backlinksOf(path: string): unknown[]
  /** Keeps a version of a note, saying who it was kept for. */
  snapshot(path: string, content: string, source: string): Promise<void>
  /** The note in a tab with no file yet, by the tab's id, or null. */
  draftIn(tab: string): NoteDoc | null
  /** The scratchpad's words as they stand: its card's while the card is up. */
  padText(): Promise<string>
  /** Edits into the scratchpad's words, worked out against `before`: through its card
   *  while it is up, and into its file. False when its words are no longer `before`. */
  padWrite(before: string, edits: readonly Edit[]): Promise<boolean>
  /** Which scheme a caret's colour is for. */
  scheme(): 'dark' | 'light'
}

/** What `tab` names the scratchpad by. It is a card and never a tab, but it is a
 *  note, the same one from every space, and the note verbs reach it as they reach a
 *  draft; see scratchpad/pad.ts. */
export const SCRATCHPAD_TAB = 'scratchpad'

/** A note as an agent names it: relative to a space, and the space when it is not
 *  the one that is open. */
export interface NoteAt {
  path: string
  space?: string
  /** A tab holding a note with no file yet (workspace/drafts.ts), or
   *  `SCRATCHPAD_TAB`, in place of a path. */
  tab?: string
  /** Where the scratchpad is on this disk, said with `SCRATCHPAD_TAB`; see `padded` in
   *  index.ts. */
  pad?: string
}

/** A note an agent named, found: its space, its path as the space speaks of it, and
 *  where it is on this disk. */
export interface Located {
  space: Space
  relative: string
  path: string
  /** The document itself, for a note with no file: always open, and on no disk. */
  draft?: NoteDoc
  /** The scratchpad, which no tab holds: read and written through the desk's own
   *  road, `padText` and `padWrite`. */
  pad?: true
}

/** The space an agent named by id or by name, or the open one. */
function spaceOf(desk: Desk, named: string | undefined): Space {
  if (!named?.trim()) {
    const open = desk.activeSpace
    if (!open) throw new DocError('no_such_space', named, 'there is no space open')
    return open
  }

  const folded = named.trim().toLowerCase()
  const found = desk.spaces.find((one) => one.id === named || one.name.toLowerCase() === folded)
  if (!found) throw new DocError('no_such_space', named, `there is no space called ${named}`)
  return found
}

/** The note an agent named, judged the way every path from outside the app is (see
 *  `insideOnly` and docs/conventions.md, Security). A name with no extension is the
 *  note of that name, as a link means it; anything but markdown is refused, because
 *  a canvas or a PDF is edited by its own verbs. */
export function located(desk: Desk, at: NoteAt): Located {
  const space = spaceOf(desk, at.space)

  if (at.tab === SCRATCHPAD_TAB) {
    if (!at.pad) throw new DocError('no_such_note', at.tab, 'there is no scratchpad here')
    return { space, relative: nameOf(at.pad), path: at.pad, pad: true }
  }

  if (at.tab !== undefined) {
    const draft = desk.draftIn(at.tab)
    if (!draft) throw new DocError('no_such_note', at.tab, `tab ${at.tab} holds no unsaved note`)
    // Its key stands for a path: what a note is known by in the edits and the undo.
    return { space, relative: '', path: `unsaved:${draft.key}`, draft }
  }

  const judged = insideOnly(at.path)
  if (judged === null) {
    throw new DocError('no_such_note', at.path, `${at.path} is not a path inside the space`)
  }

  const relative = nameOf(judged).includes('.') ? judged : `${judged}.md`
  if (!isMarkdownPath(relative)) {
    throw new DocError('not_a_note', at.path, `${relative} is not a markdown note`)
  }

  return { space, relative, path: insideSpace(space.root, relative) }
}

/** The document a located note is open as, when it is open as a note. */
export function openNote(desk: Desk, note: Located): NoteDoc | null {
  if (note.draft) return note.draft
  if (note.pad) return null
  const open = desk.documentAt(note.path)
  return open?.kind === 'note' ? open : null
}

/** A located note's words, with the one line ending the editor holds, or an error
 *  saying it is not there. */
export async function wordsOf(desk: Desk, note: Located): Promise<string> {
  const text = note.draft
    ? note.draft.latest
    : note.pad
      ? await desk.padText()
      : await desk.noteText(note.path)
  if (text === null)
    throw new DocError('no_such_note', note.relative, `there is no note at ${note.relative}`)

  return text.replace(/\r\n?/g, '\n')
}
