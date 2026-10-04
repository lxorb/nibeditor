/** Ticking a task, as one set of edits to its note: the box, the done date, the
 *  open sub-tasks under it, and for a recurring task its next occurrence.
 *
 *  What the Tasks plugin does, so both apps agree on the file: the next occurrence
 *  is a new open line written above the ticked one (the plugin's default), every
 *  date moved by the same number of days so the gaps between them stay; the ticked
 *  line keeps its place and gets `✅` and today, and is the history. `when done`
 *  (Todoist's `every!`) counts from today. Unlike the plugin, past occurrences are
 *  skipped as Todoist skips them, so a daily task a week overdue comes back
 *  tomorrow rather than six days ago; `skipPast: false` gives the plugin's date.
 *
 *  Every answer here is a list of edits with offsets into the note as it was, in
 *  order and never overlapping, so the caller applies them as one transaction and
 *  one undo takes them all back. */

import type { TextEdit } from '@nib/markdown/edits'
import { changedTask, type TaskChange, writeTask } from '@nib/markdown/task-edits'
import { parseTask, readTask, type TaskFields } from '@nib/markdown/task-line'
import { addDays, dayNumber, todayOf } from './dates'
import { nextDate, parseRule } from './recurrence'

export interface OccurrenceOptions {
  /** Skip occurrences already past, as Todoist does. On by default. */
  skipPast?: boolean
  /** Write a `➕` created date on the new line, the plugin's setting. */
  created?: boolean
}

/** The date a rule counts from: due, else scheduled, else start, the plugin's order. */
function referenceOf(task: TaskFields): string | undefined {
  return task.due ?? task.scheduled ?? task.start
}

const later = (a: string, b: string) => (a > b ? a : b)

/** The task's next occurrence: open, its dates moved together. Null for a task
 *  that does not repeat, a rule that cannot be read, or one past its `until`. */
export function nextOccurrence(
  task: TaskFields,
  today: string,
  options: OccurrenceOptions = {},
): TaskFields | null {
  if (!task.recurrence) return null
  const rule = parseRule(task.recurrence)
  if (!rule) return null

  const reference = referenceOf(task)
  const next: TaskFields = { ...task, status: ' ', done: false, cancelled: false }
  delete next.completed
  delete next.cancelledOn
  if (options.created) next.created = today

  if (rule.whenDone || !reference) {
    const date = nextDate(rule, today, today)
    if (!date) return null
    if (!reference) return next
    return shiftedBy(next, dayNumber(date) - dayNumber(reference))
  }

  const after = options.skipPast === false ? reference : later(reference, today)
  const date = nextDate(rule, reference, after)
  if (!date) return null
  return shiftedBy(next, dayNumber(date) - dayNumber(reference))
}

/** Every date of a task moved by a number of days. */
function shiftedBy(task: TaskFields, days: number): TaskFields {
  const moved = { ...task }
  for (const field of ['due', 'scheduled', 'start', 'deadline'] as const) {
    const date = task[field]
    if (date) moved[field] = addDays(date, days)
  }
  moved.remind = task.remind.map((one) =>
    'at' in one ? { ...one, at: addDays(one.at, days) } : one,
  )
  return moved
}

/** The change that turns one set of fields into another. */
function changeBetween(before: TaskFields, after: TaskFields): TaskChange {
  const change: TaskChange = {}
  const fields = [
    'status',
    'due',
    'scheduled',
    'start',
    'deadline',
    'created',
    'completed',
    'cancelledOn',
    'remind',
  ] as const
  for (const field of fields) {
    const was = JSON.stringify(before[field] ?? null)
    const now = JSON.stringify(after[field] ?? null)
    if (was !== now) Object.assign(change, { [field]: after[field] ?? null })
  }
  return change
}

/** A note's lines with where each starts. */
function linesOf(note: string): { text: string; from: number }[] {
  const out: { text: string; from: number }[] = []
  let from = 0
  for (const text of note.split('\n')) {
    out.push({ text: text.replace(/\r$/, ''), from })
    from += text.length + 1
  }
  return out
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0].length ?? 0

/** The lines under a task: everything after it indented deeper, blank lines
 *  inside included, up to the first line that is not. */
function childrenOf(lines: readonly { text: string }[], at: number): number[] {
  const own = indentOf(lines[at]?.text ?? '')
  const out: number[] = []
  for (let index = at + 1; index < lines.length; index++) {
    const text = lines[index]?.text ?? ''
    if (text.trim() === '') {
      const next = lines.slice(index + 1).find((one) => one.text.trim() !== '')
      if (!next || indentOf(next.text) <= own) break
      out.push(index)
      continue
    }
    if (indentOf(text) <= own) break
    out.push(index)
  }
  return out
}

/** Edits of one line, moved to where the line starts in the note. */
const placed = (edits: readonly TextEdit[], from: number): TextEdit[] =>
  edits.map((edit) => ({ from: edit.from + from, to: edit.to + from, insert: edit.insert }))

/** The edits that tick the task on line `line` of the note, or open it again when
 *  it is done or cancelled. None for a line that is not a task. */
export function tick(
  note: string,
  line: number,
  today: string,
  options: OccurrenceOptions = {},
): TextEdit[] {
  const lines = linesOf(note)
  const target = lines[line]
  if (!target) return []
  const task = readTask(target.text)
  if (!task) return []

  if (task.done || task.cancelled) {
    return placed(
      writeTask(target.text, { status: ' ', completed: null, cancelledOn: null }),
      target.from,
    )
  }

  const children = childrenOf(lines, line)
  const edits: TextEdit[] = []
  const next = nextOccurrence(task, today, options)

  if (next) {
    const nextLine = changedTask(target.text, changeBetween(task, next))
    const block = [nextLine, ...repeatedChildren(lines, children)]
    if (task.onCompletion === 'delete') {
      edits.push({ from: target.from, to: target.from + target.text.length, insert: nextLine })
      return edits
    }
    edits.push({ from: target.from, to: target.from, insert: `${block.join('\n')}\n` })
  } else if (task.onCompletion === 'delete') {
    const end = target.from + target.text.length + (line < lines.length - 1 ? 1 : 0)
    return [{ from: target.from, to: end, insert: '' }]
  }

  edits.push(...placed(writeTask(target.text, { done: true, completed: today }), target.from))
  for (const index of children) {
    const child = lines[index]
    const fields = child ? readTask(child.text) : null
    if (!child || !fields || fields.done || fields.cancelled) continue
    edits.push(...placed(writeTask(child.text, { done: true, completed: today }), child.from))
  }
  return edits
}

/** What a recurring task's next occurrence takes from under it: the description
 *  (the lines before its first sub-task) and its sub-tasks, open again. Comments
 *  after that stay with the occurrence they were written on. */
function repeatedChildren(
  lines: readonly { text: string }[],
  children: readonly number[],
): string[] {
  const out: string[] = []
  let seenTask = false
  for (const index of children) {
    const text = lines[index]?.text ?? ''
    const parsed = parseTask(text)
    if (parsed) {
      seenTask = true
      out.push(changedTask(text, { status: ' ', completed: null, cancelledOn: null }))
    } else if (!seenTask) {
      out.push(text)
    }
  }
  while (out.length && out.at(-1)?.trim() === '') out.pop()
  return out
}

/** Skip: the dates move to the next occurrence and nothing is ticked. */
export function skip(line: string, today: string, options: OccurrenceOptions = {}): TextEdit[] {
  const task = readTask(line)
  if (!task) return []
  const next = nextOccurrence(task, today, { ...options, created: false })
  return next ? writeTask(line, changeBetween(task, { ...next, status: task.status })) : []
}

/** Complete forever: ticked, and the rule taken off, in one edit. */
export function finish(line: string, today: string): TextEdit[] {
  return writeTask(line, { done: true, completed: today, recurrence: null })
}

/** Today on this machine's wall clock, the day a box ticked now is done on; here as
 *  well as at the package's root, for a caller that wants the tick and nothing else. */
export { todayOf }
