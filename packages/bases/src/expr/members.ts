/** `.name` and `[index]`: what a file, a note, a task, a date, a list or an object
 *  answers when it is asked for a part of itself.
 *
 *  `file.*` is Bases' list (name, basename, path, folder, ext, size, ctime, mtime,
 *  properties, tags, links, embeds, backlinks, file) and two of nib's (space,
 *  shared). `task.*` is nib's: a task row's fields, and the few answers views ask
 *  of every task (`open`, `date`, `at`, `started`, `subtask`). */

import { writeRemind } from '@nib/markdown/task-line'
import { dateAt, wallClock } from '../dates'
import type { DateValue, Row, Value } from '../types'
import {
  FileRef,
  isDate,
  isDuration,
  isLink,
  isObject,
  fieldOf,
  NoteRef,
  type Scope,
  TaskRef,
  ThisRef,
  type Val,
} from './runtime'

const DAY = 86_400_000

const dateValue = (iso: string | undefined): DateValue | null =>
  iso ? { kind: 'date', iso } : null

/** A file's own fields. */
export function fileField(row: Row, name: string, scope: Scope): Val {
  const file = row.file
  switch (name) {
    case 'name':
      return file.name
    case 'basename':
      return file.basename
    case 'path':
      return file.path
    case 'folder':
      return file.folder
    case 'ext':
      return file.ext
    case 'size':
      return file.size
    case 'ctime':
      return dateAt(wallClock(file.ctime))
    case 'mtime':
      return dateAt(wallClock(file.mtime))
    case 'properties':
      return new NoteRef(row)
    case 'tags':
      return [...file.tags]
    case 'links':
      return file.links.map((target): Value => ({ kind: 'link', target }))
    case 'embeds':
      return file.embeds.map((target): Value => ({ kind: 'link', target }))
    case 'backlinks':
      return (scope.context.backlinks?.(row) ?? []).map((target): Value => ({
        kind: 'link',
        target,
      }))
    case 'file':
      return new FileRef(row)
    case 'space':
      return row.space
    case 'shared':
      return file.shared ?? false
    default:
      return null
  }
}

/** A task's fields, and what views ask of every task. Null on a note row. */
export function taskField(row: Row, name: string, scope: Scope): Val {
  const task = row.task
  if (!task) return null
  switch (name) {
    case 'text':
      return task.text
    case 'status':
      return task.status
    case 'done':
      return task.done
    case 'cancelled':
      return task.cancelled
    case 'open':
      return !task.done && !task.cancelled
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'completed':
    case 'cancelledOn':
    case 'deadline':
      return dateValue(task[name])
    case 'date':
      return dateValue(task.due ?? task.scheduled)
    case 'at': {
      const day = task.due ?? task.scheduled
      if (!day) return null
      return task.time
        ? { kind: 'date', iso: day, time: `${task.time}:00` }
        : { kind: 'date', iso: day }
    }
    case 'started':
      return !task.start || task.start <= scope.context.today
    case 'time':
      return task.time ?? null
    case 'zone':
      return task.zone ?? null
    case 'duration':
      return task.duration === undefined
        ? null
        : { kind: 'duration', ms: task.duration * 60_000, months: 0 }
    case 'remind':
      return task.remind.map((one) => writeRemind([one]))
    case 'priority':
      return task.priority
    case 'recurrence':
      return task.recurrence ?? null
    case 'recurring':
      return task.recurrence !== undefined
    case 'tags':
      return [...task.tags]
    case 'assignee':
      return task.assignee ?? null
    case 'mine':
      return task.assignee !== undefined && task.assignee === scope.context.me
    case 'id':
      return task.id ?? null
    case 'dependsOn':
      return [...task.dependsOn]
    case 'section':
      return task.section.at(-1) ?? null
    case 'headings':
      return [...task.section]
    case 'parent':
      return task.parent ?? null
    case 'subtask':
      return task.parent !== undefined
    case 'indent':
      return task.indent
    case 'line':
      return row.anchor?.line ?? null
    case 'note':
      return new NoteRef(row)
    default:
      return task.fields[name] ?? null
  }
}

/** A date's fields, Bases' table. */
function dateField(date: DateValue, name: string): Val {
  const [hours = 0, minutes = 0, seconds = 0] = (date.time ?? '')
    .split(':')
    .map((part) => Number.parseFloat(part) || 0)
  switch (name) {
    case 'year':
      return Number(date.iso.slice(0, 4))
    case 'month':
      return Number(date.iso.slice(5, 7))
    case 'day':
      return Number(date.iso.slice(8, 10))
    case 'hour':
      return hours
    case 'minute':
      return minutes
    case 'second':
      return Math.floor(seconds)
    case 'millisecond':
      return Math.round((seconds % 1) * 1000)
    default:
      return null
  }
}

/** A duration's size in each unit, whole units toward zero: `(now() - file.ctime).days`. */
function durationField(ms: number, months: number, name: string): Val {
  const whole = (value: number) => Math.trunc(value)
  const total = ms + months * 30 * DAY
  switch (name) {
    case 'years':
      return whole(months / 12 + ms / (365.25 * DAY))
    case 'months':
      return whole(months + ms / (30 * DAY))
    case 'weeks':
      return whole(total / (7 * DAY))
    case 'days':
      return whole(total / DAY)
    case 'hours':
      return whole(total / 3_600_000)
    case 'minutes':
      return whole(total / 60_000)
    case 'seconds':
      return whole(total / 1000)
    case 'milliseconds':
      return total
    default:
      return null
  }
}

/** `value.name`. */
export function member(object: Val, name: string, scope: Scope): Val {
  if (object === null) return null
  if (object instanceof FileRef) return fileField(object.row, name, scope)
  if (object instanceof ThisRef) {
    if (name === 'file') return new FileRef(object.row)
    if (name === 'note') return new NoteRef(object.row)
    return object.row.note[name] ?? null
  }
  if (object instanceof NoteRef) return object.row.note[name] ?? null
  if (object instanceof TaskRef) return taskField(object.row, name, scope)
  if (typeof object === 'string' || Array.isArray(object))
    return name === 'length' ? object.length : null
  if (isDate(object)) return dateField(object, name)
  if (isDuration(object)) return durationField(object.ms, object.months, name)
  if (isLink(object))
    return name === 'target' ? object.target : name === 'display' ? (object.display ?? null) : null
  if (isObject(object)) return fieldOf(object, name)
  return null
}

/** `value[index]`. */
export function indexed(object: Val, index: Val, scope: Scope): Val {
  if (object === null || index === null) return null
  if (typeof index === 'number') {
    if (Array.isArray(object)) return object[index < 0 ? object.length + index : index] ?? null
    if (typeof object === 'string') return object.charAt(index) || null
    return null
  }
  if (typeof index === 'string') return member(object, index, scope)
  return null
}
