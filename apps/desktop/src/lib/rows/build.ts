/** One note read into rows: a row for the note, and a row for every task line in it.
 *
 *  Pure, and the only place a row is made, so a note read by the first scan of a space
 *  and the same note read again after a save come back as the same rows. The fields are
 *  read by the engine's own readers (`readTask`, `noteValues`, `taskHash` from
 *  `@nib/bases`), never here: the crate and the browser hand over raw lines (see
 *  scan-rows.ts and `scan_links` in links.rs), and this is where they meet the one
 *  parser there is. See docs/tasks.md 5.3. */

import { type FileInfo, noteValues, type Row, type TaskRow, taskHash, type Value } from '@nib/bases'
import { readTask } from '@nib/markdown/task-line'
import type { ScannedTask, Stamp } from '../scan-rows'

/** What a row has none of, shared by every row that has none. Frozen, so a row that
 *  is given one is given a new list rather than writing into everybody's. */
const NONE: never[] = []
Object.freeze(NONE)
const NO_FIELDS: Record<string, string> = Object.freeze({})

/** What a note gives its rows: the scan's fields (scan-note.ts, scan-rows.ts). */
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
  const rows: Row[] = [{ kind: 'note', space, path: read.path, file, note }]

  // The tasks a task may be indented under: the open run of them above it, each less
  // indented than the next. A heading ends the run, because a task under the next
  // heading is no sub-task of the last one under this.
  const above: { indent: number; line: number }[] = []
  let section = ''

  for (const scanned of read.tasks) {
    const fields = readTask(`- [${scanned.mark}] ${scanned.text}`)
    if (!fields) continue

    const under = scanned.section.join('\n')
    if (under !== section) above.length = 0
    section = under
    while ((above.at(-1)?.indent ?? -1) >= scanned.indent) above.pop()
    const parent = above.at(-1)?.line
    above.push({ indent: scanned.indent, line: scanned.line })

    // The fields' own object, made a row in place rather than copied, and its empty
    // lists the one shared empty list: ten thousand tasks are ten thousand of these.
    const task: TaskRow = Object.assign(fields, {
      section: scanned.section,
      indent: scanned.indent,
      remind: fields.remind.length ? fields.remind : NONE,
      tags: fields.tags.length ? fields.tags : NONE,
      dependsOn: fields.dependsOn.length ? fields.dependsOn : NONE,
      fields: Object.keys(fields.fields).length ? fields.fields : NO_FIELDS,
      ...(parent === undefined ? {} : { parent }),
    })
    rows.push({
      kind: 'task',
      space,
      path: read.path,
      anchor: { line: scanned.line, hash: taskHash(fields.text) },
      file,
      note,
      task,
    })
  }

  return rows
}

/** Bases' `file.*` for one note. */
function fileInfo(read: Pick<NoteRead, 'path' | 'stamp' | 'tags' | 'links'>): FileInfo {
  const name = read.path.slice(read.path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const slash = read.path.lastIndexOf('/')

  return {
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    path: read.path,
    folder: slash === -1 ? '' : read.path.slice(0, slash),
    ext: dot > 0 ? name.slice(dot + 1) : '',
    size: read.stamp?.size ?? 0,
    ctime: read.stamp?.ctime ?? 0,
    mtime: read.stamp?.mtime ?? 0,
    tags: read.tags.length ? [...read.tags] : NONE,
    links: targets(read.links, false),
    embeds: targets(read.links, true),
  }
}

/** The targets of a note's links, or of its embeds; the shared empty list for none. */
function targets(links: NoteRead['links'], embeds: boolean): string[] {
  const out = links.filter((one) => one.embed === embeds && one.target).map((one) => one.target)
  return out.length ? out : NONE
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
