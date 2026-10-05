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
import { lineStarts } from '../search/lines'
import { samePath } from '../space-paths'
import { applied, changeOf, type Edit, reverse } from '../search/replace'
import { invoke } from '../tauri'
import type { Entry, Space } from '../workspace.svelte'
import type { NoteDoc } from './documents.svelte'
import type { FileAction, FileActions } from './undo.svelte'
import { writeFile } from './write-file'

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
  if (samePath(ws.activeSpace.root, root)) ws.tags = links.spaceTags
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

  // Ticked the way every box is: the done date, the open sub-tasks, and a recurring
  // task's next occurrence above it, as one thing to undo. The engine is fetched with
  // the first tick rather than carried by the first paint.
  const { tick, todayOf } = await import('@nib/bases/occurrence')
  const edits = tick(before, line, todayOf())
  if (!edits.length) return false

  await replaceInNotes(ws, [changeOf(path, before, edits)])
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

  await replaceInNotes(ws, [changeOf(path, before, [edit])])
}

/** One note's share of a replacement, as it is put back later. */
type Undone = Extract<FileAction, { kind: 'replace' }>['notes'][number]

/** How a write keeps the version it replaces. By default every note it touches is
 *  kept, the way saving keeps one. An agent's edits keep the version before its first
 *  edit of a note, and say whose edit it was kept for: fifty edits keeping fifty
 *  versions would push the one before them out of the forty a note keeps. See
 *  docs/agent-native.md 8.5. */
export interface Keeping {
  /** Whether a version is kept at all. */
  snapshot?: boolean
  /** Who it was kept for, written beside it and shown in the versions list. */
  source?: string
}

/** Keeps the version a write is about to replace, as `keeping` says. */
async function keep(path: string, content: string, keeping: Keeping) {
  if (keeping.snapshot === false) return

  const source = keeping.source === undefined ? {} : { source: keeping.source }
  await invoke('snapshot_note', { path, content, ...source }).catch(() => undefined)
}

/** Writes a replacement across the space. Every note keeps a snapshot of
 *  what it said before it is written, a note open in a pane takes the change
 *  as the words that changed so no caret moves, and however many notes were
 *  touched it is one thing to undo.
 *
 *  Each change was worked out against the words as they were read, and the reader
 *  may have typed since: between the read and this call, and inside the writes of
 *  the notes before it. So a note that is open takes its edits carried onto the
 *  words it holds at that moment, and is written as it then stands; see
 *  `writeOpen`. */
export async function replaceInNotes(
  ws: HoldsNotes,
  changes: readonly Change[],
  keeping: Keeping = {},
): Promise<void> {
  if (!changes.length) return

  const done: Undone[] = []

  for (const change of changes) {
    const open = ws.documentAt(change.path)
    done.push(
      open ? await writeOpen(open, change, keeping) : await writeClosed(ws, change, keeping),
    )
  }

  ws.undone.record({ kind: 'replace', notes: done })
  await ws.loadTree()
  ws.persist()

  // Imported here rather than at the top: syncing reads the workspace, and
  // the two would import each other. Same as the writing beside it.
  const { sync } = await import('../sync.svelte')
  sync.nudge()
}

/** A note that is open: the edits carried onto the words it holds now and applied in
 *  the same breath as they are read, so no keystroke can fall between the two, and
 *  then the note written as it stands - keystrokes included - rather than as the
 *  change imagined it. A keystroke landing while the write is in the air is the
 *  document's own, and marks it for the next write like any other.
 *
 *  Carried by guessing where the document no longer remembers the words the change
 *  was read from, because a replacement somebody asked for has to be written; the
 *  guess is exact wherever the edits are clear of what changed. */
async function writeOpen(open: NoteDoc, change: Change, keeping: Keeping): Promise<Undone> {
  open.flush()
  const before = open.text
  const edits = open.live.carried(change.edits, change.before, true) ?? change.edits
  const after = applied(before, edits)

  open.edited(edits, after)

  // Keeping the version about to be replaced, the same way saving does: the words
  // the reader had, unsaved ones and all.
  await keep(change.path, before, keeping)
  await writeFile(change.path, after)

  return { path: change.path, content: before, after, edits: reverse(before, edits) }
}

/** A note nobody has open, written as the change says. A pane that opened it while
 *  the write was in the air read the file before it, and takes the edits the way an
 *  open note does; one that read it after already has them. */
async function writeClosed(ws: HoldsNotes, change: Change, keeping: Keeping): Promise<Undone> {
  await keep(change.path, change.before, keeping)
  await writeFile(change.path, change.after)

  const late = ws.documentAt(change.path)
  const edits = late?.live.carried(change.edits, change.before)
  if (late && edits) catchUp(late, edits, change.after)

  return { path: change.path, content: change.before, after: change.after, edits: change.back }
}

/** A note opened from the file a write was about to replace, brought up to it. Its
 *  words are the file's again unless the reader has typed in the meantime, which
 *  is then what the next write is for. */
function catchUp(note: NoteDoc, edits: readonly Edit[], written: string) {
  note.flush()
  const text = applied(note.text, edits)
  note.edited(edits, text)
  if (text !== written) note.dirty = true
}
