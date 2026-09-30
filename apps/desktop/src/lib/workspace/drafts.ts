/** A tab with no file, and the file it becomes once somebody gives it a place.
 *
 *  A new tab is a tab and nothing else - no file, no row in the list - however much is
 *  written in it, until it is saved: Ctrl+S or its dot, which ask where and under what
 *  name, or the tab dropped on a row of the file list. Its words are in the session
 *  meanwhile, the way VS Code's hot exit keeps an untitled editor, and closing it asks
 *  nothing. Emil, 2026-09-30: *"When I open a new tab or note on nib it should be in an
 *  unsaved state (with no saving location) and there should be a dot behind it
 *  (indicating that). For web tabs there should not be the dot behind them if they're
 *  unsaved."* Pure: when and where are the workspace's and saving.svelte.ts's. */

import { endingOf, nameFromContent, nameFromTitle, shownName, TITLE_CHARS } from '../note-name'
import { isMarkdownPath } from '../space-paths'
import { holdsWords, type NoteDoc, type TabKind, UNTITLED } from './documents.svelte'

type Placeable = 'note' | 'canvas' | 'pages' | 'web'

const EXTENSION: Record<Placeable, string> = {
  note: '.md',
  canvas: '.canvas',
  pages: '.pages',
  web: '.url',
}

const placeable = (kind: TabKind): kind is Placeable => kind in EXTENSION

/** Whether a document is a draft: words of its own and no file for them, which is
 *  what wears the dot. A file somebody shared on its own is not one: its room keeps
 *  it. */
export function isDraft(note: NoteDoc): boolean {
  return note.path === null && note.shared === null && holdsWords(note.kind)
}

/** Whether a document is waiting for a place: a draft, or a web tab nobody has kept,
 *  which wears no dot - a browser tab has nothing unwritten in it - but is saved the
 *  same way. */
export function isUnsaved(note: NoteDoc): boolean {
  return isDraft(note) || (note.kind === 'web' && note.path === null && note.shared === null)
}

/** Whether a draft has anything in it worth keeping: a note once it holds a character
 *  that is not white space, a plane or a deck once anything was drawn on it. */
export function hasWords(note: NoteDoc): boolean {
  return note.kind === 'note' ? !note.blank : note.dirty
}

/** The file a name comes to, under its kind's own ending, read the app's own way so
 *  `Plan.canvas` does not become `Plan.canvas.canvas`. */
export function fileNamed(name: string, kind: TabKind): string {
  if (!placeable(kind)) return name

  const already =
    kind === 'note' ? isMarkdownPath(name) : endingOf(name)?.toLowerCase() === EXTENSION[kind]
  return already ? name : `${name}${EXTENSION[kind]}`
}

/** Whether a draft is named after its words rather than after a name it came with, as
 *  an import does. Only a note: a plane and a deck have no words to read a name off. */
export function namedByWords(note: NoteDoc): boolean {
  return note.kind === 'note' && note.name === UNTITLED
}

/** The name saving offers, without an ending: a note's first heading or line (a
 *  fixed slice of the rope, never the whole), the name a document came with, or a web
 *  tab's page title. */
export function offeredName(note: NoteDoc, title?: string): string {
  if (note.kind === 'web') return nameFromTitle(title?.trim() ? title : note.name) ?? UNTITLED
  if (!namedByWords(note)) return shownName(note.name)

  return nameFromContent(note.live.text.sliceString(0, TITLE_CHARS)) ?? UNTITLED
}

/** The file a draft is written as where nobody typed a name. */
export function draftFile(note: NoteDoc): string {
  return fileNamed(offeredName(note), note.kind)
}
