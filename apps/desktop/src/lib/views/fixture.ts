/** Rows for the views' tests, built the way the rows store builds them (rows/build.ts):
 *  a note's front matter through `noteValues`, a task line through `readTask`. Only
 *  the tests import this. */

import { type FileInfo, noteValues, type Row, type TaskRow, taskHash, type Value } from '@nib/bases'
import { readTask } from '@nib/markdown/task-line'

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

/** A note row; `note` is front matter as YAML lines, or values. */
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

/** A task row from its line, at a line of its note. */
export function taskRow(
  path: string,
  line: string,
  at = 0,
  more: Partial<Pick<TaskRow, 'section' | 'parent' | 'indent'>> & { space?: string } = {},
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
    note: {},
    task,
  }
}
