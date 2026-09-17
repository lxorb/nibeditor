/** The words in the notes of a space, read and written without opening them.
 *
 *  A replacement across the space, a tag renamed, a task ticked in a row of search
 *  results: each is a write to notes nobody has open, and each has the same four
 *  obligations. Keep the version about to be replaced. Write the file. Tell the
 *  index what it says now. And where a pane does happen to be showing that note,
 *  hand it the words that changed rather than the whole note, so nobody's caret
 *  moves under them.
 *
 *  However many notes were touched, what somebody did was one thing, so it is one
 *  thing to undo; see workspace/undo.svelte.ts.
 *
 *  Its own module because none of it is about what is open: `noteText` prefers an
 *  open document over the disk and that is the whole of its dealings with them. */

import { oneEdit } from '@nib/markdown/edits'
import { taskAt } from '@nib/markdown/tasks'
import type { SpaceTag } from '@nib/editor'
import { links } from '../link-index.svelte'
import type { Change } from '../search/apply'
import { lineStarts } from '../search/match'
import { invoke } from '../tauri'
import type { Entry, Space } from '../workspace.svelte'
import type { NoteDoc } from './documents.svelte'
import type { FileAction, FileActions } from './undo.svelte'

/** What writing across a space needs of the store it belongs to. */
export interface HoldsNotes {
  readonly activeSpace: Space | null
  readonly notes: Entry[]
  readonly documents: NoteDoc[]
  readonly undone: FileActions
  tags: SpaceTag[]
  /** The document a file is open as; see workspace/open.ts. */
  documentAt(path: string): NoteDoc | null
  flush(): void
  loadTree(): Promise<void>
  persist(): void
}

/** The tags of the open space, for the panel that draws them as a tree.
 *
 *  Read off the index rather than off the disk. See `spaceTags` in
 *  link-index.svelte.ts, which is the one answer to what a space is tagged with and
 *  the one place what a number beside a tag means is written down - the editor's
 *  `#` popup is handed the same list.
 *
 *  A panel opened while the space is still being read shows what the index has so
 *  far and the rest of it when the scan lands, which is what the wait below is
 *  for: asking the disk used to answer whatever the scan was doing, and a tag tree
 *  that stayed empty until something else happened to ask again would be worse
 *  than the read it replaced. */
export async function loadTags(ws: HoldsNotes): Promise<void> {
  const root = ws.activeSpace?.root
  if (!root) return

  ws.tags = links.spaceTags
  if (!links.scanning) return

  await links.scanned()
  // Read again rather than remembered: the scan takes as long as the space is big,
  // and the space that is open may not be the one that was.
  if (ws.activeSpace.root === root) ws.tags = links.spaceTags
}

/** Renames a tag, and everything under it, in every note of the space.
 *
 *  Silently and as one thing to undo, the way renaming a note rewrites every
 *  link to it: a tag is a name for a set of notes, and nobody who renames one
 *  wants to be asked about each of them. Answers how many notes were touched.
 *
 *  `to` is the path the node becomes, or null to take the tag away. */
export async function retagNotes(ws: HoldsNotes, from: string, to: string | null): Promise<number> {
  const { tagChanges } = await import('../tag-edits')

  const changes = await tagChanges(
    ws.notes.map((one) => one.path),
    from,
    to,
    (path) => noteText(ws, path),
  )

  await replaceInNotes(ws, changes)
  // The tree the tags are drawn as is now a tree of the tags that were.
  await loadTags(ws)
  return changes.length
}

/** A note's words as they stand: what is on screen when it is open, and what
 *  is on disk otherwise. A replacement reads through here so it never writes
 *  over work that has not been saved yet. */
export async function noteText(ws: HoldsNotes, path: string): Promise<string | null> {
  ws.flush()

  const open = ws.documentAt(path)
  if (open) return open.text

  return invoke<string>('read_note', { path }).catch(() => null)
}

/** Ticks or clears the box on one line of a note, without opening it.
 *
 *  What a task in a row of search results is for: a list of everything still to
 *  do is only a tool if it can be done from. Written through the same path a
 *  replacement takes - a snapshot, the words that changed rather than the whole
 *  note so no caret in a pane moves, and one thing to undo - because it is the
 *  same kind of write, of one character.
 *
 *  Answers whether there was a box: the line is read again here rather than
 *  trusted from the row, so a note edited since the list was drawn is ticked
 *  where it says a task is now, or not at all. */
export async function toggleTaskAt(ws: HoldsNotes, path: string, line: number): Promise<boolean> {
  const before = await noteText(ws, path)
  if (before === null) return false

  const starts = lineStarts(before)
  const from = starts[line]
  if (from === undefined) return false

  const next = starts[line + 1]
  const task = taskAt(before.slice(from, next === undefined ? before.length : next - 1))
  if (!task) return false

  const at = from + task.box + 1
  const insert = task.done ? ' ' : 'x'

  await replaceInNotes(ws, [
    {
      path,
      before,
      after: before.slice(0, at) + insert + before.slice(at + 1),
      edits: [{ from: at, to: at + 1, insert }],
      back: [{ from: at, to: at + 1, insert: before.slice(at, at + 1) }],
    },
  ])

  return true
}

/** Writes the whole of one note, from words somebody typed somewhere other than a
 *  pane: the editor mounted in a hover card, which is a note being written in without
 *  being opened. See wikilink/hover.ts in @nib/editor and preview-card.ts.
 *
 *  The whole note in, one span of characters out: `oneEdit` is the smallest change the
 *  two versions differ by, so a pane that happens to be showing the same note takes
 *  the words that moved rather than the note again and nobody's caret moves. Which is
 *  the same road a replacement across the space takes, and the reason this is here
 *  rather than beside the card: a note is written in one way.
 *
 *  `before` is what the file says now and is the caller's to read: it is what the
 *  snapshot keeps and what the edit is measured against. */
export async function writeNoteText(
  ws: HoldsNotes,
  path: string,
  before: string,
  after: string,
): Promise<void> {
  const edit = oneEdit(before, after)
  if (!edit) return

  await replaceInNotes(ws, [
    {
      path,
      before,
      after,
      edits: [edit],
      back: [
        {
          from: edit.from,
          to: edit.from + edit.insert.length,
          insert: before.slice(edit.from, edit.to),
        },
      ],
    },
  ])
}

/** Writes a replacement across the space. Every note keeps a snapshot of
 *  what it said before it is written, a note open in a pane takes the change
 *  as the words that changed so no caret moves, and however many notes were
 *  touched it is one thing to undo. */
export async function replaceInNotes(ws: HoldsNotes, changes: readonly Change[]): Promise<void> {
  if (!changes.length) return

  const done: Extract<FileAction, { kind: 'replace' }>['notes'] = []

  for (const change of changes) {
    // Keeping the version about to be replaced, the same way saving does.
    await invoke('snapshot_note', {
      path: change.path,
      content: change.before,
    }).catch(() => undefined)

    await invoke('write_note', { path: change.path, content: change.after })

    done.push({ path: change.path, content: change.before, edits: change.back })
    links.noteSaved(change.path, change.after)
    ws.documentAt(change.path)?.edited(change.edits, change.after)
  }

  ws.undone.record({ kind: 'replace', notes: done })
  await ws.loadTree()
  ws.persist()

  // Imported here rather than at the top: syncing reads the workspace, and
  // the two would import each other. Same as the writing beside it.
  const { sync } = await import('../sync.svelte')
  sync.nudge()
}
