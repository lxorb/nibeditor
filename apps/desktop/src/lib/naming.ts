/** What a name may be, and what a commit writes.
 *
 *  A field on a row cannot ask the disk on every keystroke, so the rules a
 *  filesystem enforces are stated here and answered at once: the row says what is
 *  wrong with the name while it is being typed, rather than a rename failing
 *  afterwards with nothing to show for it. `is_reserved` in
 *  src-tauri/src/paths.rs is what would refuse it, and naming.test.ts reads that
 *  file so the two lists cannot drift apart.
 *
 *  Every rule is asked on every platform, for the reason the crate gives: a note
 *  that syncs has to land on all of the reader's machines, and a name only some
 *  of them can hold is not a name.
 *
 *  Pure, so the whole rule reads as a list of names and the field is left with
 *  nothing to decide; see naming.test.ts. */

import { endingOf } from './note-name'

/** Why a name will not do. One per sentence a row can show, which is why a
 *  slash and a colon are two of them: what the row says is what to change, not
 *  that something is invalid.
 *
 *  `empty` is the odd one. A field nobody has finished typing in is not a
 *  mistake and is never shown as one; it is here because it is still a name
 *  that cannot be written. */
export type NameFault = 'empty' | 'separator' | 'illegal' | 'trailing' | 'reserved' | 'taken'

/** Names Windows keeps for devices, whatever the extension is: `NUL.md` names
 *  the device as surely as `NUL`. The crate's own list, said again here because
 *  the field answers between two keystrokes and cannot wait for a round trip to
 *  the one place that has it. */
const RESERVED = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]

/** The characters Windows reserves. The separators are asked about on their own,
 *  because "a name cannot hold a slash" is a sentence and this list is not. */
const ILLEGAL = /[<>:"|?*]/

const SEPARATOR = /[\\/]/

/** A control character, which every platform refuses and no name has a use for.
 *  Said as the Unicode class rather than as a range, so the source of a module
 *  about names does not itself hold a run of unprintable ones. */
const CONTROL = /\p{Cc}/u

/** What a row hands over about the name being typed on it. */
export interface Naming {
  /** What has been typed, without the extension the document is not shown with. */
  typed: string
  /** The extension the commit puts back: `.md` for a note, nothing for a folder
   *  or a space. */
  extension: string
  /** What else is in that folder, this row's own name left out - keeping it
   *  would make every name its own duplicate. */
  taken: readonly string[]
}

/** Whether the name is one of the device names, going by the part in front of
 *  the first dot, which is where Windows looks. */
function isReserved(name: string): boolean {
  const stem = name.split('.')[0] ?? name
  return RESERVED.includes(stem.toUpperCase())
}

/** Why this name cannot be written, or null when it can. */
export function nameFault({ typed, extension, taken }: Naming): NameFault | null {
  const name = typed.trim()

  if (!name) return 'empty'
  if (SEPARATOR.test(name)) return 'separator'
  if (ILLEGAL.test(name) || CONTROL.test(name)) return 'illegal'
  // Windows drops a trailing dot without a word, so a file named with one is a
  // file under a name other than the one that was typed.
  if (name.endsWith('.')) return 'trailing'
  if (isReserved(name)) return 'reserved'

  // Against the name that would be written rather than against what was typed,
  // so `A` collides with `A.md` and not with the folder `A` beside it - which is
  // the folder-note layout and a pair that is meant to exist. Case-insensitively,
  // because two of the three platforms this runs on say those are one file.
  const written = nameToWrite(name, extension).toLowerCase()
  return taken.some((one) => one.toLowerCase() === written) ? 'taken' : null
}

/** The name a commit writes: what was typed with the file's own ending put back.
 *
 *  Unless it is already there, in which case the ending on the end of what was typed
 *  is taken for the one it is: a note and a canvas are shown without the ending they
 *  were written with and keep it, so a vault of `.markdown` files stays one, and a
 *  PDF is shown with its own, so a second copy of it would make `paper.pdf.pdf`.
 *
 *  And the file's own spelling of it rather than the reader's. `NOTE.MD` renamed by
 *  typing `Note.md` is the same file under the same name to Windows and to a Mac, so
 *  writing back what was typed asked the disk for a rename it refuses - and the row
 *  kept the name it could not have until the next listing. What is renamed here is
 *  the name; the ending stays exactly as the file wrote it. */
export function nameToWrite(typed: string, extension: string): string {
  const name = typed.trim()
  if (!extension) return name
  if (!name.toLowerCase().endsWith(extension.toLowerCase())) return name + extension

  return name.slice(0, name.length - extension.length) + extension
}

/** The ending the commit puts back for a row holding this name.
 *
 *  A folder has none, because a folder's name is not a file name. A file keeps its
 *  own, which is `endingOf` - the same reading `shownName` takes the ending off by,
 *  so what the field shows and what the commit writes cannot come apart. A name with
 *  no ending at all becomes markdown, which is what everything the app writes itself
 *  is. */
export function extensionOf(name: string, isFolder: boolean): string {
  if (isFolder) return ''
  return endingOf(name) ?? '.md'
}

/** The name leaving the field writes, or null for nothing to do.
 *
 *  Nothing to do covers three endings that all leave the row exactly as it was:
 *  a name that cannot be written, a name nobody changed, and a row being made
 *  that never got one. So a blur is safe to treat as a commit, which is what
 *  every file manager does, and Escape is this answer taken without asking. */
export function nameToCommit(naming: Naming & { was: string }): string | null {
  if (nameFault(naming)) return null

  const name = nameToWrite(naming.typed, naming.extension)
  return name === nameToWrite(naming.was, naming.extension) ? null : name
}
