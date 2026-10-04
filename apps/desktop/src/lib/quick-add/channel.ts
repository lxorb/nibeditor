/** What the global quick add window and the app say to each other, over a broadcast
 *  channel: the two are pages of one origin, so this is the presenter's way of talking
 *  and needs no permission of either window (docs/tasks.md 5.6).
 *
 *  The window asks what it needs to read a line (`hello`): the space's notes for `>`,
 *  the app's language and whether dates are read at all. It hands over a task to write
 *  (`task`). Everything arriving is checked here, once: a message is a value crossing a
 *  boundary. */

import type { Remind } from '@nib/markdown/task-line'
import type { Entry } from './entry'

export const CHANNEL = 'nib-quick-add'

/** Held by the one window of the app that answers: a lock the next window takes over
 *  when that one closes, so a task is written once however many windows are open. */
export const ANSWERING = 'nib-quick-add-answering'

export type Said =
  | { kind: 'hello' }
  | { kind: 'world'; notes: string[]; lang: string; smart: boolean }
  | { kind: 'task'; entry: Entry; open: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const optional = (value: unknown, check: (one: unknown) => boolean) =>
  value === undefined || check(value)

function isRemind(value: unknown): value is Remind {
  if (!isRecord(value)) return false
  if (typeof value.before === 'number') return true
  if (isString(value.at)) return isString(value.time)
  return isString(value.time)
}

function isEntry(value: unknown): value is Entry {
  if (!isRecord(value) || !isString(value.text) || !isRecord(value.fields)) return false
  const { fields } = value
  return (
    strings(fields.tags) &&
    Array.isArray(fields.remind) &&
    fields.remind.every(isRemind) &&
    ['due', 'time', 'recurrence', 'assignee', 'deadline'].every((key) =>
      optional(fields[key], isString),
    ) &&
    optional(fields.priority, (one) => one === 1 || one === 2 || one === 3 || one === 4) &&
    optional(fields.duration, (one) => typeof one === 'number' && one > 0) &&
    ['description', 'note', 'heading'].every((key) => optional(value[key], isString))
  )
}

/** A message as one of ours, or null. */
export function heard(value: unknown): Said | null {
  if (!isRecord(value)) return null
  if (value.kind === 'hello') return { kind: 'hello' }
  if (
    value.kind === 'world' &&
    strings(value.notes) &&
    isString(value.lang) &&
    typeof value.smart === 'boolean'
  ) {
    return { kind: 'world', notes: value.notes, lang: value.lang, smart: value.smart }
  }
  if (value.kind === 'task' && isEntry(value.entry) && typeof value.open === 'boolean') {
    return { kind: 'task', entry: value.entry, open: value.open }
  }
  return null
}
