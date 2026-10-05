/** A note's task lines as rows, and a note's `file.*`: the half of making rows that
 *  needs no YAML. The rows store and the connector build a note's rows through
 *  note-rows.ts, which adds the note's own row and its front matter; the glasses, which
 *  carry no YAML parser, and a task found again in a note's words read the task rows
 *  alone (`taskRowsOfText`). See docs/tasks.md 5.3. */

import { readTask } from '@nib/markdown/task-line'
import { type ScannedTask, scanRows, type Stamp } from './scan'
import { taskHash } from './task-hash'
import type { FileInfo, Row, TaskRow, Value } from './types'

/** What a row has none of, shared by every row that has none. Frozen, so a row that
 *  is given one is given a new list rather than writing into everybody's. */
const NONE: never[] = []
Object.freeze(NONE)
const NO_FIELDS: Record<string, string> = Object.freeze({})

/** What `file.*` is made of. */
interface FileRead {
  path: string
  stamp: Stamp | null
  tags: readonly string[]
  links: readonly { target: string; embed: boolean }[]
}

/** Bases' `file.*` for one note. */
export function fileInfo(read: FileRead): FileInfo {
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
function targets(links: FileRead['links'], embeds: boolean): string[] {
  const out = links.filter((one) => one.embed === embeds && one.target).map((one) => one.target)
  return out.length ? out : NONE
}

/** A note's task lines as rows, in the order they are written. */
export function taskRowsOf(
  space: string,
  path: string,
  tasks: readonly ScannedTask[],
  file: FileInfo,
  note: Record<string, Value>,
): Row[] {
  const rows: Row[] = []
  // The tasks a task may be indented under: the open run of them above it, each less
  // indented than the next. A heading ends the run, because a task under the next
  // heading is no sub-task of the last one under this.
  const above: { indent: number; line: number }[] = []
  let section = ''

  for (const scanned of tasks) {
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
      path,
      anchor: { line: scanned.line, hash: taskHash(fields.text) },
      file,
      note,
      task,
    })
  }
  return rows
}

/** A note's task rows from what a scan read of it, its front matter left unread. */
export function scannedTaskRows(space: string, path: string, tasks: readonly ScannedTask[]): Row[] {
  return taskRowsOf(space, path, tasks, fileInfo({ path, stamp: null, tags: [], links: [] }), {})
}

/** A note's task rows from its words, its front matter left unread. */
export function taskRowsOfText(space: string, path: string, text: string): Row[] {
  return scannedTaskRows(space, path, scanRows(text).tasks)
}
