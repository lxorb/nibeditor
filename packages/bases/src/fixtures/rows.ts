/** Rows for tests, built the way the rows store builds them: a note's front matter
 *  through `noteValues`, a task line through `readTask`. */

import { readTask } from '@nib/markdown/task-line'
import { noteValues, taskHash } from '../note-values'
import type { Context, FileInfo, Row, TaskRow, Value } from '../types'

/** A file at a path, with whatever a test says about it. */
function fileAt(path: string, extra: Partial<FileInfo> = {}): FileInfo {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return {
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    path,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    ext: dot === -1 ? '' : name.slice(dot + 1),
    size: 100,
    ctime: new Date(2026, 0, 1).getTime(),
    mtime: new Date(2026, 9, 1, 12).getTime(),
    tags: [],
    links: [],
    embeds: [],
    ...extra,
  }
}

/** A note row. `note` is front matter as YAML lines, or values. */
export function noteRow(
  path: string,
  note: string | Record<string, Value> = {},
  file: Partial<FileInfo> = {},
  space = 'Notes',
): Row {
  return {
    kind: 'note',
    space,
    path,
    file: fileAt(path, file),
    note: typeof note === 'string' ? noteValues(note) : note,
  }
}

/** A task row from its line. */
export function taskRow(
  path: string,
  line: string,
  at = 0,
  more: Partial<Pick<TaskRow, 'section' | 'parent' | 'indent'>> & {
    space?: string
    note?: Record<string, Value>
  } = {},
): Row {
  const fields = readTask(line)
  if (!fields) throw new Error(`not a task: ${line}`)
  const task: TaskRow = { ...fields, section: more.section ?? [], indent: more.indent ?? 0 }
  if (more.parent !== undefined) task.parent = more.parent
  return {
    kind: 'task',
    space: more.space ?? 'Notes',
    path,
    anchor: { line: at, hash: taskHash(fields.text) },
    file: fileAt(path),
    note: more.note ?? {},
    task,
  }
}

/** A context on 2026-10-04 at 10:00, Emil signed in. */
export function contextAt(extra: Partial<Context> = {}): Context {
  return { today: '2026-10-04', now: '2026-10-04T10:00:00', me: 'Emil', ...extra }
}
