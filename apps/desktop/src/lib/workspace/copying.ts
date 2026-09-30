/** Files copied into the space: rows of its own pasted, duplicated or dragged with
 *  Ctrl, and files dropped onto the list from outside the app.
 *
 *  Nothing is written over. A row copied beside itself is `Plan copy.md`, the word
 *  Duplicate has always used, and a file dropped in from outside that meets a name
 *  already there steps aside by number the way a new note does - `Plan 2.md` -
 *  since it is not a copy of anything here.
 *
 *  Every file lands through the one write (`write-file.ts`), so the link index
 *  knows it the moment it is there. A row that is a folder drawn as its note keeps
 *  being one: the note inside `Trip copy/` is renamed `Trip copy.md` through the
 *  rename every file operation is said as (`fileMoved`), or the copy would be a
 *  folder holding a note called something else.
 *
 *  However many rows one copy made, it is one thing to undo. */

import { toBase64 } from '../bytes'
import { folderNote, isFolderNote } from '../folder-notes'
import type { Picked } from '../import/sources'
import { readsWords } from '../link-index.svelte'
import { copiesInto } from '../move-targets'
import { copyName } from '../note-name'
import { nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import type { Entry } from '../workspace.svelte'
import type { Copied, FileActions } from './undo.svelte'
import { copyPath, writeBytes, writeFile } from './write-file'

/** What copying needs of the store: the tree-edit trio, the numbering every new
 *  name goes through, the two file operations a copy is said as, and the undo
 *  stack. */
export interface Copies {
  readonly undone: FileActions
  entryAt(path: string): Entry | null
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  freeName(dir: string, wanted: string): string
  fileMoved(from: string, to: string, kind: 'file'): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
}

/** One row to copy, and the folder it goes into. */
export interface Copying {
  from: string
  into: string
}

/** The name a copy of `name` lands under in `dir`: its own where nothing there
 *  answers to it, `Plan copy.md` where something does, and `Plan copy 2.md` past
 *  a copy already made. A folder has no ending to keep the word in front of. */
function copyNameIn(ws: Pick<Copies, 'freeName'>, dir: string, name: string, folder: boolean) {
  if (ws.freeName(dir, name) === name) return name
  return ws.freeName(dir, folder ? `${name} copy` : copyName(name))
}

/** The note a copied folder is drawn as, renamed after the copy: `Trip/Trip.md`
 *  copied to `Trip copy/` is `Trip copy/Trip.md` until this makes it `Trip copy/Trip
 *  copy.md`. Null where the folder has no namesake - an `index.md` is named after
 *  its place and is right where it is - and for anything that is not a folder. */
function ownNoteRenamed(entry: Entry, to: string): { from: string; to: string } | null {
  const own = folderNote(entry)
  if (!own || !isFolderNote(own.path)) return null

  const ending = /\.[^.]+$/.exec(own.name)?.[0] ?? '.md'
  const renamed = `${nameOf(to)}${ending}`
  if (renamed === own.name) return null

  return { from: joinPath(to, own.name), to: joinPath(to, renamed) }
}

/** Copies rows of the space, each into its own folder, and answers where each
 *  landed. The rows are the outermost of a selection: a row inside another goes
 *  with it rather than twice. A folder is never copied into itself, and a row that
 *  will not copy is stepped over rather than stopping the rest. */
export async function copyRows(ws: Copies, rows: readonly Copying[]): Promise<string[]> {
  const made: Copied[] = []

  for (const { from, into } of rows) {
    const entry = ws.entryAt(from)
    if (!entry || !copiesInto([from], into)) continue

    const path = joinPath(into, copyNameIn(ws, into, entry.name, entry.is_dir))
    if (await copyEntry(ws, entry, path)) made.push({ path, folder: entry.is_dir, from })
  }

  if (made.length) ws.undone.record({ kind: 'copy', made })
  return made.map((one) => one.path)
}

/** A copy undone, made again where it was: the same paths, so a redo lands where
 *  the first copy did. One whose source has gone since is stepped over. */
export async function copyAgain(ws: Copies, made: readonly Copied[]): Promise<void> {
  const again: Copied[] = []

  for (const one of made) {
    const entry = one.from === undefined ? null : ws.entryAt(one.from)
    if (entry && (await copyEntry(ws, entry, one.path))) again.push(one)
  }

  if (again.length) ws.undone.record({ kind: 'copy', made: again })
}

/** One row copied to `path`, its row on the list before the disk has answered.
 *  Answers whether it landed. */
async function copyEntry(ws: Copies, entry: Entry, path: string): Promise<boolean> {
  // On the tree first, which is also what makes the next name in the same paste
  // step past this one: the listing is a round trip behind.
  ws.showEntry(ws.freshEntry(path, entry.is_dir))

  const landed = await copyPath(entry.path, path)
    .then(() => true)
    .catch(() => false)
  if (!landed) return false
  await ws.fileCame(path, entry.is_dir ? 'folder' : 'file')

  const own = ownNoteRenamed(entry, path)
  if (own) {
    const renamed = await invoke('rename_note', own)
      .then(() => true)
      .catch(() => false)
    if (renamed) await ws.fileMoved(own.from, own.to, 'file')
  }

  return true
}

/** One file dropped from outside, by where it goes inside what was dropped:
 *  `Trip/map.png` for a folder's picture, `plan.md` for a file on its own. */
function partsOf(file: Picked): string[] {
  const inside = (file.webkitRelativePath ?? '').trim()
  return (inside.length ? inside : file.name)
    .split(/[\\/]/)
    .filter((part) => part && part !== '.' && part !== '..')
}

/** Files and folders dropped from outside the app, written into `into`, answering
 *  where each thing dropped landed. A folder arrives with everything in it; what
 *  the link index reads the words of is written as words, so it is linked at once,
 *  and everything else is written as the bytes it is. */
export async function bringIn(
  ws: Copies,
  files: readonly Picked[],
  into: string,
): Promise<string[]> {
  // What each top-level thing that was dropped is called now it is here: its own
  // name, or the next free one.
  const landed = new Map<string, Copied>()

  // Recorded whatever happens, so a write that fails halfway leaves what did land
  // one undo away rather than nowhere.
  try {
    for (const file of files) {
      const [top, ...rest] = partsOf(file)
      if (top === undefined) continue

      let at = landed.get(top)
      if (!at) {
        const folder = rest.length > 0
        at = { path: joinPath(into, ws.freeName(into, top)), folder }
        landed.set(top, at)
        ws.showEntry(ws.freshEntry(at.path, folder))
      }

      const path = rest.length ? joinPath(at.path, rest.join('/')) : at.path
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (readsWords(path)) await writeFile(path, new TextDecoder().decode(bytes))
      else await writeBytes(path, toBase64(bytes))
    }
  } finally {
    if (landed.size) ws.undone.record({ kind: 'copy', made: [...landed.values()] })
  }

  return [...landed.values()].map((one) => one.path)
}
