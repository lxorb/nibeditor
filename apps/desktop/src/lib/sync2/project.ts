/** A document's words written to its file: the file is the document's projection
 *  (docs/sync-v2.md section 5.1).
 *
 *  Only for a document nothing on screen is holding. A note open in a tab has its words
 *  written by autosave, a pause after they change - whether a keystroke changed them or
 *  another device did - so the engine never writes under a hand that is typing; it hears
 *  that the write happened (`saved`) and records it the same way.
 *
 *  What is recorded is what the next foreign edit is measured against: the words nib
 *  last wrote (`written`, the ancestor of section 5.5's three-way merge) and their
 *  digest on the entry, which is how a watcher's news is told apart from nib's own
 *  write. Compared with line endings as the editor holds them, because a file keeps its
 *  own on disk (`as_written` in src-tauri/src/notes.rs). */

import type { Core } from './core'
import type { Doc } from './docs'
import { unixLines } from './kinds'
import { type SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

/** What recording that nib wrote `text` to an entry's file changes. */
export async function wrote(core: Core, entry: EntryRow, text: string): Promise<Change[]> {
  entry.written_hash = await core.world.digest(unixLines(text))
  return [put('written', { id: entry.id, text: unixLines(text) }), put('entries', { ...entry })]
}

/** Writes a document's words to its file where nothing on screen holds it, keeping what
 *  the file said before as a version on this device. Answers the changes to record, or
 *  nothing when there is no file to write yet or the file already says it. */
export async function project(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  // Nor over another sync tool's copy, which is that tool's (`foreign` in places.ts).
  if (core.pinned.has(entry.id) || space.foreign(entry.id)) return []
  const path = entry.local_path || space.paths().get(entry.id)
  if (!path) return []
  // Another entry's file is still where this one is going: it moves on first.
  const holder = space.at(path)
  if (holder && holder !== entry) return []

  const text = doc.text()
  const full = core.world.join(space.row.root, path)
  const was = await core.world.disk.read(full)
  // A file nobody here has named yet is in the way: it becomes an entry of its own
  // (ingest), and nothing is written over it.
  if (!entry.local_path && (was !== null || (await core.world.disk.exists(full)))) return []
  if (was !== null && unixLines(was) === unixLines(text)) {
    entry.local_path = path
    const digest = await core.world.digest(unixLines(text))
    return entry.written_hash === digest ? [] : await wrote(core, entry, text)
  }

  if (was?.trim()) await core.world.disk.keep(full, was)
  await core.world.disk.write(full, text)
  entry.local_path = path
  return await wrote(core, entry, text)
}
