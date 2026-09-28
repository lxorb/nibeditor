/** The note a name typed into the palette makes, when nothing in the space
 *  answers to it: Obsidian's quick switcher and Notion's search both end on that
 *  row, so a name is one Enter from being a note.
 *
 *  A slash is a folder, as it is in Obsidian: `Uni/Lecture 3` is a note in `Uni`,
 *  made along with the folder where there is none yet. Each part is held to the
 *  rules a row's name is (naming.ts), and a part that breaks one makes no row at
 *  all rather than a note under some other name than the one typed. */

import { nameFault, nameToWrite } from '../naming'

export interface NoteToMake {
  /** Where, relative to the space, with `/` between folders; empty for the top. */
  folder: string
  /** The file's name, ending and all. */
  name: string
}

export function noteToMake(term: string): NoteToMake | null {
  const parts = term
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const last = parts.pop()
  if (last === undefined) return null

  const folders = parts.every(
    (part) => nameFault({ typed: part, extension: '', taken: [] }) === null,
  )
  if (!folders || nameFault({ typed: last, extension: '.md', taken: [] })) return null

  return { folder: parts.join('/'), name: nameToWrite(last, '.md') }
}
