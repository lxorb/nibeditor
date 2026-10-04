/** One note read into rows: a row for the note, and a row for every task line in it.
 *
 *  Pure, and the only place a row is made, so a note read by the first scan of a space,
 *  the same note read again after a save, and the same note read by the account
 *  connector on the Worker come back as the same rows. The fields are read by the
 *  engine's own readers (`readTask`, `noteValues`, `taskHash`), never here: the
 *  crate and the browser hand over raw lines (see scan.ts and `scan_links` in
 *  links.rs), and this is where they meet the one parser there is. Its own entry,
 *  `@nib/bases/rows`. See docs/tasks.md 5.3. */

import { findLinks } from '@nib/markdown/links'
import { tagsIn } from '@nib/markdown/task-line'
import { noteValues } from './note-values'
import { type ScannedTask, scanRows, type Stamp } from './scan'
import { fileInfo, taskRowsOf } from './task-rows'
import type { FileInfo, Row, Value } from './types'

/** What a note gives its rows: the scan's fields (the app's scan-note.ts, scan.ts). */
export interface NoteRead {
  /** Relative to the space, `/` between folders. */
  path: string
  front: string | null
  tasks: readonly ScannedTask[]
  stamp: Stamp | null
  /** Folded, without `#`, each once: what the link index keeps. */
  tags: readonly string[]
  links: readonly { target: string; embed: boolean }[]
}

/** The note's row first, then its tasks in the order they are written. */
export function rowsOf(space: string, read: NoteRead): Row[] {
  const file = fileInfo(read)
  const note: Record<string, Value> = read.front === null ? {} : noteValues(read.front)
  const own: Row = { kind: 'note', space, path: read.path, file, note }
  return [own, ...taskRowsOf(space, read.path, read.tasks, file, note)]
}

/** A note's rows from its words alone, where no scan has read it: the account
 *  connector's notes, read off storage. Its tags are the ones its lines carry and its
 *  links every link written, folded the way the link index folds them. */
export function rowsOfText(
  space: string,
  path: string,
  text: string,
  stamp: Stamp | null = null,
): Row[] {
  const scanned = scanRows(text)
  const tags = [...new Set(tagsIn(text).map((tag) => tag.toLowerCase()))]
  const links = findLinks(text).map((link) => ({ target: link.target, embed: link.embed }))
  return rowsOf(space, { path, front: scanned.front, tasks: scanned.tasks, stamp, tags, links })
}

/** The same rows under another path: a note renamed or moved keeps everything it
 *  said and only says where it is. */
export function movedRows(rows: readonly Row[], path: string, space: string): Row[] {
  const first = rows[0]
  if (!first) return []

  const { name, basename, folder, ext } = fileInfo({ path, stamp: null, tags: [], links: [] })
  const file: FileInfo = { ...first.file, path, name, basename, folder, ext }
  return rows.map((row) => ({ ...row, space, path, file }))
}
