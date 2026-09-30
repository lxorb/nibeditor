/** A tab with no file, and the file it becomes.
 *
 *  A new tab is a tab and nothing else, so one closed untouched leaves no `Untitled`
 *  behind; its first words make it a file in the space, asked nothing. Emil,
 *  2026-09-30: *"I don't want there to be any manual saving anymore."*
 *
 *  What the file is called is what its tab is called: its first heading or line
 *  (note-name.ts). And the name follows that line while the note is the draft it was
 *  born as, as in Apple Notes and iA Writer, until somebody names it; see `follows`
 *  in documents.svelte.ts. Pure: when and where are saving.svelte.ts's. */

import { endingOf, nameFromContent, TITLE_CHARS } from '../note-name'
import { isMarkdownPath } from '../space-paths'
import { holdsWords, type NoteDoc, type TabKind, UNTITLED } from './documents.svelte'

/** The kinds of document a draft can be, and the ending each is written under. */
type Bearable = 'note' | 'canvas' | 'pages'

const EXTENSION: Record<Bearable, string> = {
  note: '.md',
  canvas: '.canvas',
  pages: '.pages',
}

const bearable = (kind: TabKind): kind is Bearable => kind in EXTENSION

/** Whether a document is a draft: words of its own and no file for them. A file
 *  somebody shared on its own is not one: its room keeps it. */
export function isDraft(note: NoteDoc): boolean {
  return note.path === null && note.shared === null && holdsWords(note.kind)
}

/** Whether a draft has something in it worth a file. A note once it holds a
 *  character that is not white space; a plane or a deck on its first change, since
 *  every change to one is a stroke, a card or a page somebody made. */
export function hasWords(note: NoteDoc): boolean {
  return note.kind !== 'note' || !note.blank
}

/** The file a name comes to, under its kind's own ending, read the app's own way so
 *  `Plan.canvas` does not become `Plan.canvas.canvas`. */
export function fileNamed(name: string, kind: TabKind): string {
  if (!bearable(kind)) return name

  const already =
    kind === 'note' ? isMarkdownPath(name) : endingOf(name)?.toLowerCase() === EXTENSION[kind]
  return already ? name : `${name}${EXTENSION[kind]}`
}

/** What the top of a note would name a file: its first heading, else its first
 *  line, else Untitled. A fixed slice of the rope, never the whole, because this is
 *  asked again whenever a note that follows its words is written. */
function nameFromWords(note: NoteDoc): string {
  return nameFromContent(note.live.text.sliceString(0, TITLE_CHARS)) ?? UNTITLED
}

/** Whether a draft is named after its words, rather than after a name it came with:
 *  an import and a file uploaded in the browser arrive called what they were called.
 *  Only a note: a plane and a deck have no words at the top to read a name off. */
export function namedByWords(note: NoteDoc): boolean {
  return note.kind === 'note' && note.name === UNTITLED
}

/** The file a draft is first written as, before any number steps it aside from a
 *  name that is taken. */
export function draftFile(note: NoteDoc): string {
  const stem = namedByWords(note) ? nameFromWords(note) : note.name
  return fileNamed(stem, note.kind)
}

/** The name the file of a note that follows its words should have now, or null
 *  where it already has it. `free` steps a name aside from whatever else the folder
 *  holds, the note's own file left out: `Plan 2.md` beside somebody's `Plan.md` is
 *  already the name `Plan` asks for, and without leaving itself out it would step
 *  on to `Plan 3.md`.
 *
 *  A name that differs only in case is the name it has: Windows and a Mac call those
 *  one file and refuse the rename, which would otherwise be tried again at every
 *  pause for as long as the note was open. */
export function followedName(note: NoteDoc, free: (file: string) => string): string | null {
  if (!note.follows || note.path === null) return null

  const wanted = free(fileNamed(nameFromWords(note), 'note'))
  return wanted.toLowerCase() === note.name.toLowerCase() ? null : wanted
}
