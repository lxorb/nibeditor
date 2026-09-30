/** One note out of another, and two notes into one.
 *
 *  Three gestures and they are the same handful of writes in a different order: a
 *  merge appends a note into another and points every link that came to the first
 *  at the second; a split takes everything from the caret on; an extraction takes
 *  the selection. Each leaves a link behind, keeps a snapshot of every note it
 *  touches, tells the index what each says now, and records one entry to undo.
 *
 *  What the words themselves become is composer.ts, which is pure and tested on its
 *  own. What is here is the writing, the links and the undo - which is why it takes
 *  a store rather than a string. */

import { extracted, merged, splitAt } from '../composer'
import { folderOf, samePath } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { type Tab, UNTITLED } from './documents.svelte'
import type { FileActions } from './undo.svelte'
import { writeFile } from './write-file'

/** What composing needs of the store the notes are open in. */
export interface Composes {
  readonly active: Tab | null
  readonly undone: FileActions
  flush(): void
  reload(path: string, content: string): void
  /** The note merged away, said the way a delete is; see workspace/file-ops.ts. */
  fileGone(path: string, kind: 'file'): Promise<void>
  retarget(from: string, to: string): Promise<number>
  open(path: string): Promise<void>
  freeName(dir: string, wanted: string): string
  loadTree(): Promise<void>
  persist(): void
}

/** Appends this note into another, deletes it, and points every link that came
 *  here at the note it went into. */
export async function mergeInto(ws: Composes, from: string, into: string): Promise<void> {
  if (samePath(from, into)) return

  const [fromContent, intoContent] = await Promise.all([
    invoke<string>('read_note', { path: from }).catch(() => null),
    invoke<string>('read_note', { path: into }).catch(() => null),
  ])
  if (fromContent === null || intoContent === null) return

  const joined = merged(intoContent, fromContent)

  await invoke('snapshot_note', { path: into, content: intoContent }).catch(() => undefined)
  await writeFile(into, joined)
  ws.reload(into, joined)

  // Before the note goes, so the links that pointed at it can still be found.
  await ws.retarget(from, into)

  await invoke('snapshot_note', { path: from, content: fromContent }).catch(() => undefined)
  await invoke('delete_note', { path: from })
  await ws.fileGone(from, 'file')

  ws.undone.record({ kind: 'merge', from, fromContent, into, intoContent })
  await ws.loadTree()
  await ws.open(into)
}

/** Everything from the caret on becomes a note of its own, with a link left in
 *  its place. */
export async function splitAtCaret(ws: Composes, at: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const carved = splitAt(tab.doc, at, UNTITLED)
  if (!carved) return

  await carve(ws, tab.path, tab.doc, carved, 'split')
}

/** The selection becomes a note of its own, with a link in its place. */
export async function extractSelection(ws: Composes, from: number, to: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const carved = extracted(tab.doc, from, to, UNTITLED)
  if (!carved) return

  await carve(ws, tab.path, tab.doc, carved, 'extract')
}

/** What a split and an extraction both do: write the new note, write what is
 *  left of this one, and remember enough to undo both. */
async function carve(
  ws: Composes,
  path: string,
  before: string,
  carved: { kept: string; taken: string; name: string },
  kind: 'split' | 'extract',
) {
  // Stepped aside the way every other new name in the app is, through the store's
  // own `freeName`: a copy of the numbering lived here, and it counted only the
  // files, so a carved note could be handed the name of a folder.
  const folder = folderOf(path)
  const created = joinPath(folder, ws.freeName(folder, `${carved.name}.md`))

  await writeFile(created, carved.taken)

  await invoke('snapshot_note', { path, content: before }).catch(() => undefined)
  await writeFile(path, carved.kept)
  ws.reload(path, carved.kept)

  ws.undone.record({ kind, from: path, fromContent: before, created })
  await ws.loadTree()
  ws.persist()
}
