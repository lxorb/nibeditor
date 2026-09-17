/** A website that was written as a note, turned into a `.url` shortcut.
 *
 *  A website used to be a note with a `url:` line in its front matter, and some
 *  spaces are full of those. Rather than two formats to read for ever, a note
 *  becomes a shortcut the first time anybody opens it - `Svelte docs.md` is read,
 *  `Svelte docs.url` is written beside it, and the note goes - and the palette can
 *  do a whole space at once.
 *
 *  Beside `note.ts` and `shortcut.ts`, whose reading and writing it is the migration
 *  for, rather than in the workspace: what it needs of the store is the tree, not
 *  the tabs, so it takes the handful of tree-edit calls as an interface and leaves
 *  the opening of the shortcut it makes to the caller. `workspace.openWeb` runs it
 *  and then opens what it points at; see the workspace section of
 *  docs/conventions.md. */

import { account } from '../account.svelte'
import { links } from '../link-index.svelte'
import { shownName } from '../note-name'
import { folderOf, isMarkdownPath, nameOf, withoutExtension } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { Entry, Space } from '../workspace.svelte'
import { keptBody, webTitleOf, webUrlOf } from './note'
import { writeShortcut } from './shortcut'

/** What turning a note into a shortcut needs of the store: the tree it draws the
 *  new row into, and the space it is walking. The optimistic row and the listing
 *  that settles it are the workspace's own; see `showEntry` and `loadTree`. */
export interface Converts {
  readonly notes: readonly Entry[]
  readonly activeSpace: Space | null
  entryAt(path: string): Entry | null
  /** The document a file is open as, or null when nothing is showing it. What
   *  makes a conversion something done to a file rather than to a file somebody
   *  is looking at; see `asShortcut`. */
  documentAt(path: string): NoteDoc | null
  freeName(dir: string, wanted: string): string
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  loadTree(): Promise<void>
}

/** Turns the note at `path` into a shortcut and answers where the website now
 *  lives, or null for a note that is not one after all.
 *
 *  Unless the note had something to say. What the old format wrote was a heading and
 *  the address as a link, and nothing of that is worth keeping; a note somebody had
 *  written into as well is a note, and it stays where it is with the `url:` line
 *  taken out of it. So a shortcut and a note of the same name can both come out of
 *  this, which is exactly what was in the file.
 *
 *  Never a file a document is open on. This writes `X.url` and then rewrites or
 *  deletes `X.md`, and a document over `X.md` is holding that file's words and
 *  writes them back as the typing pauses - so the note would come back beside its
 *  own shortcut, both of them live and both of them the website. `openWeb` asks
 *  the same question before it gets here, because a website somebody is already
 *  reading is a tab to bring forward rather than a file to convert; the palette's
 *  pass over a whole space asked nothing at all, and that was the one gesture in
 *  the app that wrote a file out from under a document. It is asked here rather
 *  than at each door, because the doors are what keep being added. See
 *  workspace/open.ts. */
export async function asShortcut(ws: Converts, path: string): Promise<string | null> {
  if (ws.documentAt(path)) return null

  const text = await invoke<string>('read_note', { path }).catch(() => null)
  const url = webUrlOf(text)
  if (text === null || url === null) return null

  const title = webTitleOf(text) ?? shownName(nameOf(path))
  const written = writeShortcut(url, title, new Date())
  const shortcut = `${withoutExtension(path)}.url`

  // A name that is taken is a website that has already been converted, or a file
  // somebody else put there. Either way this one keeps its own name.
  const free = ws.entryAt(shortcut) ? ws.freeName(folderOf(path), nameOf(shortcut)) : null
  const target = free === null ? shortcut : joinPath(folderOf(path), free)

  ws.showEntry(ws.freshEntry(target, false))
  await invoke('write_note', { path: target, content: written })

  const kept = keptBody(text)
  if (kept === null) await oldNoteGone(path)
  else await invoke('write_note', { path, content: kept }).catch(() => undefined)

  links.noteGone(path)
  await ws.loadTree()
  return target
}

/** The note a website used to be, put where a deleted note goes.
 *
 *  Nothing is lost and nothing is recorded: a conversion is not a delete somebody
 *  asked for, so there is no undo step for it, but the file is in Recently deleted
 *  for anybody who wants it back. A file that will not go is a file left beside its
 *  shortcut, which breaks nothing: the shortcut is what its name opens now. */
async function oldNoteGone(path: string) {
  try {
    if (account.signedIn) await invoke('delete_note', { path })
    else await invoke('trash_item', { path, kind: 'note' })
  } catch {
    // Said above: a note that stays is a note beside a shortcut, and harmless.
  }
}

/** Every website still written as a note in the open space, converted where it
 *  stands. Answers how many there were, so the palette can say what it did.
 *
 *  One pass rather than a wait for each file to be opened: a space that came from an
 *  older nib has all of its websites in the old format, and a reader who wants them
 *  all as shortcuts should not have to open each one. */
export async function convertWebsites(ws: Converts): Promise<number> {
  if (!ws.activeSpace) return 0

  const notes = ws.notes.filter((one) => isMarkdownPath(one.name) && links.urlOf(one.path) !== null)

  let done = 0
  for (const note of notes) {
    if ((await asShortcut(ws, note.path)) !== null) done += 1
  }

  if (done) await ws.loadTree()
  return done
}
