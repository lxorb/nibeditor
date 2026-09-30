/** Putting the last file operation back.
 *
 *  Seven kinds of operation and seven ways back, each of them a write or two and then
 *  the operation said the way every file operation is: once, to everything kept by
 *  path (see workspace/file-ops.ts), with a document open on a file taking the words
 *  it says now. What is on the stack and how long it stays there is
 *  workspace/undo.svelte.ts; this is what one entry means when somebody asks for it
 *  back; redoing.ts is the way forward again.
 *
 *  Its own module because none of it is about the workspace's own state. Every one
 *  of these reads a recorded action and writes the disk, which is why it can be
 *  tested by handing it a stand-in store rather than a workspace. */

import { oneEdit } from '@nib/markdown/edits'
import { applied, type Edit } from '../search/replace'
import { invoke } from '../tauri'
import type { Entry } from '../workspace.svelte'
import type { Archive } from './archive.svelte'
import type { NoteDoc } from './documents.svelte'
import type { Kind } from './file-ops'
import type { FileAction, FileActions } from './undo.svelte'
import { writeFile } from './write-file'

/** What putting a file operation back needs of the store holding it. */
export interface PutsBack {
  readonly undone: FileActions
  readonly archive: Archive
  openEntry(path: string): Promise<void>
  /** The document a file is open as; see workspace/open.ts. */
  documentAt(path: string): NoteDoc | null
  entryAt(path: string): Entry | null
  reload(path: string, content: string): void
  retarget(from: string, to: string): Promise<number>
  /** A file operation, said once to everything kept by path; see `fileMoved` in
   *  workspace.svelte.ts. A rename put back is a rename, a delete put back is a file
   *  come back, and an import or a copy taken back is files gone. */
  fileMoved(from: string, to: string, kind: Kind): Promise<void>
  fileGone(path: string, kind: 'file' | 'folder'): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
  loadTree(): Promise<void>
  persist(): void
}

/** Puts the last file operation back. */
export async function undoLastFileAction(ws: PutsBack): Promise<void> {
  const action = ws.undone.last
  if (!action) return

  try {
    switch (action.kind) {
      case 'delete':
        // And the index reads it again, so the links to it resolve at once.
        await ws.fileCame(await putBack(action), 'file')
        break
      case 'merge':
        await unmerge(ws, action)
        break
      case 'split':
      case 'extract':
        await uncarve(ws, action)
        break
      case 'move':
      case 'rename':
        await putName(ws, action)
        break
      case 'replace':
        await putWordsBack(ws, action)
        break
      case 'import':
        await unimport(ws, action)
        break
      case 'copy':
        await uncopy(ws, action)
        break
      case 'archive':
      case 'unarchive':
        await unarchive(ws, action)
        break
    }
  } catch {
    // Something else has since changed the file; leave what is there alone.
    // The action stays on the stack, so the same undo can be tried again
    // once whatever is in the way has been dealt with.
    return
  }

  ws.undone.drop()
  await ws.loadTree()
  ws.persist()
}

/** An import taken back: the files it wrote, gone again.
 *
 *  Outright rather than into the trash. What an import wrote was never a note
 *  anybody kept, and putting three thousand rows into Recently deleted would
 *  bury whatever is actually in there. A tab that is open on one of them is
 *  closed, the way a deleted note's is.
 *
 *  A file that will not go is stepped over rather than stopping the undo: the
 *  rest of the import still goes, and what is left is what somebody has since
 *  taken an interest in. */
async function unimport(ws: PutsBack, action: Extract<FileAction, { kind: 'import' }>) {
  for (const path of action.paths) {
    const gone = await invoke('delete_note', { path })
      .then(() => true)
      .catch(() => false)
    if (gone) await ws.fileGone(path, 'file')
  }
}

/** A copy taken back: what it made, gone again. Outright, like an import's: the
 *  original is still where it was, so there is nothing in the copy the trash would
 *  be keeping safe. A tab open on anything in it closes as it goes. */
async function uncopy(ws: PutsBack, action: Extract<FileAction, { kind: 'copy' }>) {
  for (const { path, folder } of action.made) {
    await invoke(folder ? 'delete_folder' : 'delete_note', { path })
    await ws.fileGone(path, folder ? 'folder' : 'file')
  }
}

/** A deleted note back where it was, answering with where that is. Out of the
 *  device's trash when it went there - which moves it aside when something has
 *  taken its name meanwhile - and from the snapshot taken on the way out otherwise.
 *
 *  The trash can refuse: the sweep runs daily and clears anything past its
 *  fourteen days, and Recently deleted can purge an entry by hand. The
 *  snapshot is still here either way, so it stands in rather than leaving
 *  the note gone with nothing said. */
async function putBack(action: Extract<FileAction, { kind: 'delete' }>): Promise<string> {
  if (!action.trashId) {
    // Nothing kept and nothing in the trash, which is what a PDF deleted while
    // signed in looks like. Writing nothing would leave an empty file where the
    // paper was, so this says so instead.
    if (!action.content) throw new Error('there is nothing to put back')

    await invoke('write_note', { path: action.path, content: action.content })
    return action.path
  }

  const restored = await invoke<string>('restore_trash', { id: action.trashId }).catch(() => null)

  if (restored !== null) return restored || action.path
  if (!action.content) throw new Error('the deleted note is no longer in the trash')

  await invoke('write_note', { path: action.path, content: action.content })
  return action.path
}

/** Puts an archiving back, either way round, and opens the tabs it closed. */
async function unarchive(
  ws: PutsBack,
  action: Extract<FileAction, { kind: 'archive' | 'unarchive' }>,
) {
  await ws.archive.change(action.root, action.restored, action.archived)
  for (const path of action.closed) await ws.openEntry(path)
}

/** Puts a replacement back: every note that was touched says what it said, with
 *  whatever has been typed into it since the replacement kept.
 *
 *  The edits that take it back were worked out against the words the replacement
 *  left, and the reader may have gone on writing. So a note open in a pane takes
 *  them carried onto the words it holds now, through everything the document
 *  remembers changing - the same road the replacement itself took (see `writeOpen`
 *  in workspace/note-text.ts) - and keeps its caret; and a note nobody has open
 *  takes them carried past the one span its file has changed by since, an edit
 *  that falls inside that span being the reader's writing and left alone. */
async function putWordsBack(ws: PutsBack, action: Extract<FileAction, { kind: 'replace' }>) {
  for (const note of action.notes) {
    const open = ws.documentAt(note.path)
    if (open) {
      open.flush()
      const edits = open.live.carried(note.edits, note.after, true) ?? note.edits
      const back = applied(open.text, edits)
      open.edited(edits, back)
      await writeFile(note.path, back)
      continue
    }

    const now = await invoke<string>('read_note', { path: note.path }).catch(() => note.after)
    await writeFile(note.path, now === note.after ? note.content : carriedPast(note, now))
  }
}

/** The edits that take a replacement back, applied to a file that has changed since
 *  by one span: those before it as they were, those after it moved by what it grew
 *  or shrank by, and those it overlaps left out. */
function carriedPast(note: { after: string; edits: readonly Edit[] }, now: string): string {
  const since = oneEdit(note.after, now)
  if (!since) return applied(now, note.edits)

  const grew = since.insert.length - (since.to - since.from)
  const carried = note.edits.flatMap((one) => {
    if (one.to <= since.from) return [one]
    if (one.from >= since.to) return [{ ...one, from: one.from + grew, to: one.to + grew }]
    return []
  })

  return applied(now, carried)
}

/** Puts a rename or a move back: the file where it was, and the links that
 *  followed it pointed at the old name again. */
async function putName(ws: PutsBack, action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
  const kind = ws.entryAt(action.to)?.is_dir === true ? 'folder' : 'file'
  await invoke('rename_note', { from: action.to, to: action.from })

  // The rename rewrote every link that pointed at the note; putting the name
  // back has to put those back too, which is the same rewrite the other way
  // round - and, again, before anything is told the note moved.
  if (action.rewrote) await ws.retarget(action.to, action.from)
  await ws.fileMoved(action.to, action.from, kind)
}

/** Puts a merge back: both notes as they were, and the note that was folded
 *  in written again where it was. */
async function unmerge(ws: PutsBack, action: Extract<FileAction, { kind: 'merge' }>) {
  await writeFile(action.into, action.intoContent)
  await writeFile(action.from, action.fromContent)
  ws.reload(action.into, action.intoContent)

  // Links to the note that went away were pointed at the note it went into.
  await ws.retarget(action.into, action.from)
}

/** Puts a split or an extraction back: the note whole again, and the note that
 *  was carved out of it gone. */
async function uncarve(ws: PutsBack, action: Extract<FileAction, { kind: 'split' | 'extract' }>) {
  await writeFile(action.from, action.fromContent)
  await invoke('delete_note', { path: action.created }).catch(() => undefined)
  await ws.fileGone(action.created, 'file')
  ws.reload(action.from, action.fromContent)
}
