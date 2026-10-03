/** The one write path for rows: a property of a note, a field of a task.
 *
 *  A cell in a table, a card dragged to another column, a box ticked in Today, a date
 *  dragged on the calendar and an agent's `update_task` all come here, and here is the
 *  only place that knows how a change becomes characters (docs/tasks.md 5.12). A
 *  property is a front matter edit (`writeProperty`, `writeList`); a task field is the
 *  engine's smallest edits to its line (`writeTask`). Both are written through
 *  note-text.ts the way a replacement across the space is: an open note takes the edit
 *  as a transaction of its own document, so nothing typed is lost and no caret moves; a
 *  closed one is written with the version before it kept; either way it is one thing to
 *  undo. And the write tells the link index, which tells the rows (`hearSaves`), so the
 *  row a view drew moves in every view at once with nothing said here.
 *
 *  The line a task is on is found again rather than trusted: the note may have been
 *  edited since the row was drawn, so the anchor's line is checked by its words' hash
 *  and, where the words have moved, the nearest line with the same words is the one. */

import type { Row, TaskChange, Value } from '@nib/bases'
import { taskHash } from '@nib/bases'
import type { TextEdit } from '@nib/markdown/edits'
import { oneEdit } from '@nib/markdown/edits'
import { writeList, writeProperty } from '@nib/markdown/property-edits'
import type { PropertyKind } from '@nib/markdown/properties'
import { writeTask } from '@nib/markdown/task-edits'
import { readTask } from '@nib/markdown/task-line'
import { changeOf } from '../search/replace'
import { type HoldsNotes, noteText, replaceInNotes } from '../workspace/note-text'

/** What a write changes: properties of the note (null takes one away), fields of the
 *  task (null takes one away), or both. */
export interface RowChange {
  note?: Record<string, Value | null>
  task?: TaskChange
}

/** Writes one change to the note a row is in. Answers whether anything was written:
 *  false for a task whose line is no longer in the note, and for a change the note
 *  already says. */
export async function writeRow(
  ws: HoldsNotes,
  path: string,
  row: Row,
  change: RowChange,
): Promise<boolean> {
  const before = await noteText(ws, path)
  if (before === null) return false

  const after = changed(before, row, change)
  if (after === null) return false

  const edit = oneEdit(before, after)
  if (!edit) return false

  await replaceInNotes(ws, [changeOf(path, before, [edit])])
  return true
}

/** The note's words with the change made, or null where the change cannot be made. */
export function changed(text: string, row: Row, change: RowChange): string | null {
  let after = text

  for (const [key, value] of Object.entries(change.note ?? {})) {
    const edit = propertyEdit(after, key, value)
    if (edit === undefined) return null
    if (edit) after = applied(after, [edit])
  }

  if (change.task && Object.keys(change.task).length) {
    if (!row.anchor) return null
    const at = taskLine(after, row.anchor)
    if (at === null) return null

    const line = after.slice(at.from, at.to)
    const edits = writeTask(line, change.task).map((edit) => ({
      from: edit.from + at.from,
      to: edit.to + at.from,
      insert: edit.insert,
    }))
    after = applied(after, edits)
  }

  return after
}

/** Where the task an anchor names is now: the line it was on if its words are still
 *  there, else the nearest line with the same words. Null where no line has them. The
 *  span leaves out a line's `\r`, which belongs to the line break. */
export function taskLine(
  text: string,
  anchor: { line: number; hash: string },
): { from: number; to: number } | null {
  const lines: { from: number; to: number }[] = []
  for (let from = 0; from <= text.length; ) {
    const end = text.indexOf('\n', from)
    const stop = end === -1 ? text.length : end
    lines.push({ from, to: text[stop - 1] === '\r' ? stop - 1 : stop })
    if (end === -1) break
    from = end + 1
  }

  const names = (at: number) => {
    const line = lines[at]
    if (!line) return false
    const fields = readTask(text.slice(line.from, line.to))
    return fields !== null && taskHash(fields.text) === anchor.hash
  }

  for (let distance = 0; distance < lines.length; distance++) {
    if (names(anchor.line - distance)) return lines[anchor.line - distance] ?? null
    if (distance && names(anchor.line + distance)) return lines[anchor.line + distance] ?? null
  }
  return null
}

/** One property's edit: null where the note already says it, undefined for a value no
 *  front matter line can hold (a map). */
function propertyEdit(text: string, key: string, value: Value | null): TextEdit | null | undefined {
  if (Array.isArray(value)) return writeList(text, key, value.map(written))
  if (value !== null && typeof value === 'object' && !('kind' in value)) return undefined
  const [said, kind] = value === null ? [null, 'text' as const] : scalar(value)
  return writeProperty(text, key, said, kind)
}

/** A value as the words and the kind a front matter line writes it with. */
function scalar(value: Exclude<Value, null | Value[]>): [string, PropertyKind] {
  if (typeof value === 'boolean') return [String(value), 'checkbox']
  if (typeof value === 'number') return [String(value), 'number']
  if (typeof value === 'string') return [value, 'text']
  if ('kind' in value && value.kind === 'date') return [written(value), 'date']
  return [written(value), 'text']
}

/** A value as the words a note writes it in: a link as a wikilink, a date as ISO with
 *  its time, a duration in minutes. */
function written(value: Value): string {
  if (value === null) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(written).join(', ')
  if (!('kind' in value)) return ''
  switch (value.kind) {
    case 'link':
      return value.display ? `[[${value.target}|${value.display}]]` : `[[${value.target}]]`
    case 'date':
      return value.time ? `${value.iso}T${value.time}` : value.iso
    case 'duration':
      return `${Math.round(value.ms / 60_000)}m`
    default:
      return ''
  }
}

/** Edits made to a text, given in the coordinates of that text, last first. */
function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((one, other) => other.from - one.from)
    .reduce((now, edit) => now.slice(0, edit.from) + edit.insert + now.slice(edit.to), text)
}
