/** Putting the last file operation back.
 *
 *  Six kinds of operation and six ways back, each of them a write or two and then
 *  the same three things said to the rest of the app: the index hears what the
 *  file says now, a document open on it takes those words, and the row moves. What
 *  is on the stack and how long it stays there is workspace/undo.svelte.ts; this is
 *  what one entry means when somebody asks for it back.
 *
 *  Its own module because none of it is about the workspace's own state. Every one
 *  of these reads a recorded action and writes the disk, which is why it can be
 *  tested by handing it a stand-in store rather than a workspace. */

import { links } from '../link-index.svelte'
import { paperMoved } from '../pdf/papers'
import { nameOf } from '../space-paths'
import { invoke } from '../tauri'
import type { ArchivedFolders } from './archived-folders.svelte'
import type { Excluded } from './excluded.svelte'
import type { FolderIcons } from './folder-icons.svelte'
import type { NoteDoc, Tab } from './documents.svelte'
import type { Positions } from './positions'
import type { FileAction, FileActions } from './undo.svelte'

/** What putting a file operation back needs of the store holding it. */
export interface PutsBack {
  readonly undone: FileActions
  readonly tabs: Tab[]
  readonly documents: NoteDoc[]
  readonly positions: Positions
  readonly folderIcons: FolderIcons
  readonly excluded: Excluded
  readonly archivedFolders: ArchivedFolders
  close(id: string): void
  reload(path: string, content: string): void
  retarget(from: string, to: string): Promise<number>
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
        await putBack(action)
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
    if (!gone) continue

    for (const tab of ws.tabs.filter((entry) => entry.path === path)) ws.close(tab.id)
    links.noteGone(path)
  }
}

/** A deleted note back where it was. Out of the device's trash when it went
 *  there, and from the snapshot taken on the way out otherwise.
 *
 *  The trash can refuse: the sweep runs daily and clears anything past its
 *  fourteen days, and Recently deleted can purge an entry by hand. The
 *  snapshot is still here either way, so it stands in rather than leaving
 *  the note gone with nothing said. */
async function putBack(action: Extract<FileAction, { kind: 'delete' }>) {
  if (!action.trashId) {
    // Nothing kept and nothing in the trash, which is what a PDF deleted while
    // signed in looks like. Writing nothing would leave an empty file where the
    // paper was, so this says so instead.
    if (!action.content) throw new Error('there is nothing to put back')

    await invoke('write_note', { path: action.path, content: action.content })
    return
  }

  const restored = await invoke('restore_trash', { id: action.trashId })
    .then(() => true)
    .catch(() => false)

  if (restored) return
  if (!action.content) throw new Error('the deleted note is no longer in the trash')

  await invoke('write_note', { path: action.path, content: action.content })
}

/** Puts a replacement back: every note that was touched says what it said,
 *  and a note open in a pane takes its old words as the words that changed,
 *  so undoing costs nobody their caret either. */
async function putWordsBack(ws: PutsBack, action: Extract<FileAction, { kind: 'replace' }>) {
  for (const note of action.notes) {
    await invoke('write_note', { path: note.path, content: note.content })
    links.noteSaved(note.path, note.content)
    ws.documents.find((one) => one.path === note.path)?.edited(note.edits, note.content)
  }
}

/** Puts a rename or a move back: the file where it was, and the links that
 *  followed it pointed at the old name again. */
async function putName(ws: PutsBack, action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
  await invoke('rename_note', { from: action.to, to: action.from })
  ws.positions.move(action.to, action.from)

  for (const note of ws.documents.filter((entry) => entry.path === action.to)) {
    note.path = action.from
    note.name = nameOf(action.from)
  }

  // The rename rewrote every link that pointed at the note; putting the name
  // back has to put those back too, which is the same rewrite the other way
  // round - and, again, before the index is told the note moved.
  if (action.rewrote) await ws.retarget(action.to, action.from)
  links.notesMoved(action.to, action.from)
  paperMoved(action.to, action.from)
  ws.folderIcons.moved(action.to, action.from)
  ws.excluded.moved(action.to, action.from)
  ws.archivedFolders.moved(action.to, action.from)
}

/** Puts a merge back: both notes as they were, and the note that was folded
 *  in written again where it was. */
async function unmerge(ws: PutsBack, action: Extract<FileAction, { kind: 'merge' }>) {
  await invoke('write_note', { path: action.into, content: action.intoContent })
  await invoke('write_note', { path: action.from, content: action.fromContent })

  links.noteSaved(action.into, action.intoContent)
  links.noteSaved(action.from, action.fromContent)
  ws.reload(action.into, action.intoContent)

  // Links to the note that went away were pointed at the note it went into.
  await ws.retarget(action.into, action.from)
}

/** Puts a split or an extraction back: the note whole again, and the note that
 *  was carved out of it gone. */
async function uncarve(ws: PutsBack, action: Extract<FileAction, { kind: 'split' | 'extract' }>) {
  await invoke('write_note', { path: action.from, content: action.fromContent })
  await invoke('delete_note', { path: action.created }).catch(() => undefined)

  links.noteSaved(action.from, action.fromContent)
  links.noteGone(action.created)

  for (const tab of ws.tabs.filter((one) => one.path === action.created)) ws.close(tab.id)
  ws.reload(action.from, action.fromContent)
}
