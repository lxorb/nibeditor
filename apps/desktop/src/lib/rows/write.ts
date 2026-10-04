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

import type { DateValue, DurationValue, LinkValue, Row, TaskChange, Value } from '@nib/bases'
import { taskHash, tick, todayOf } from '@nib/bases'
import { appliedEdits, oneEdit, type TextEdit } from '@nib/markdown/edits'
import { writeList, writeProperty } from '@nib/markdown/property-edits'
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
    if (edit) after = appliedEdits(after, [edit])
  }

  if (change.task && Object.keys(change.task).length) {
    if (!row.anchor) return null
    const at = taskLine(after, row.anchor)
    if (at === null) return null

    const { done, ...rest } = change.task
    const line = after.slice(at.from, at.to)
    const edits = writeTask(line, rest).map((edit) => ({
      from: edit.from + at.from,
      to: edit.to + at.from,
      insert: edit.insert,
    }))
    after = appliedEdits(after, edits)
    if (done != null) after = ticked(after, at.from, done)
  }

  return after
}

/** The note with the task whose line starts at `from` ticked, or opened again. Ticking
 *  is the engine's (`tick`): the done date, the open sub-tasks under it, and a recurring
 *  task's next occurrence above it, as one write; see occurrence.ts in @nib/bases. A
 *  task already as asked is left as it is. */
function ticked(text: string, from: number, done: boolean): string {
  const end = text.indexOf('\n', from)
  const line = text.slice(from, end === -1 ? text.length : end).replace(/\r$/, '')
  const fields = readTask(line)
  if (!fields || fields.done === done) return text

  const today = todayOf()
  // A cancelled task done after all is ticked where it stands, nothing else moving.
  if (done && fields.cancelled) {
    const edits = writeTask(line, { done: true, completed: today, cancelledOn: null })
    return appliedEdits(
      text,
      edits.map((edit) => ({ ...edit, from: edit.from + from, to: edit.to + from })),
    )
  }
  return appliedEdits(text, tick(text, text.slice(0, from).split('\n').length - 1, today))
}

/** Where the task an anchor names is now: the line it was on if its words are still
 *  there, else the nearest line with the same words. Null where no line has them. The
 *  span leaves out a line's `\r`, which belongs to the line break. */
export function taskLine(
  text: string,
  anchor: { line: number; hash: string },
): { from: number; to: number } | null {
  const lines: { from: number; to: number }[] = []
  for (let from = 0; from <= text.length;) {
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
function propertyEdit(text: string, key: string, value: Value): TextEdit | null | undefined {
  if (value === null) return writeProperty(text, key, null)
  if (Array.isArray(value)) {
    return writeList(
      text,
      key,
      value.map((one) => written(one) ?? ''),
    )
  }
  if (typeof value === 'boolean') return writeProperty(text, key, String(value), 'checkbox')
  if (typeof value === 'number') return writeProperty(text, key, String(value), 'number')
  const said = written(value)
  if (said === null) return undefined
  return writeProperty(text, key, said, hasKind(value, 'date') ? 'date' : 'text')
}

/** Whether a value is one of the shapes that say what they are by `kind`. */
function hasKind<K extends 'date' | 'duration' | 'link'>(
  value: Value,
  kind: K,
): value is Extract<DateValue | DurationValue | LinkValue, { kind: K }> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === kind
}

/** A value as the words a note writes it in: a link as a wikilink, a date as ISO with
 *  its time, a duration in minutes. Null for a map, which a line cannot hold. */
function written(value: Value): string | null {
  if (value === null) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map((one) => written(one) ?? '').join(', ')
  if (hasKind(value, 'link')) {
    return value.display ? `[[${value.target}|${value.display}]]` : `[[${value.target}]]`
  }
  if (hasKind(value, 'date')) return value.time ? `${value.iso}T${value.time}` : value.iso
  if (hasKind(value, 'duration')) return `${Math.round(value.ms / 60_000)}m`
  return null
}
