/** A task as an agent reads it and changes it: the half of `list_tasks`, `add_task` and
 *  `update_task` that both servers share, `nib mcp`'s window verbs and the account
 *  connector on the Worker (docs/tasks.md 5.15).
 *
 *  A task row goes out as the few fields it has, so a list of fifty costs a model what
 *  fifty lines would, with `at` the anchor it hands back to change one. Arguments come
 *  in from another program, so every one is read here once and refused in a sentence
 *  the model can act on. Pure: the servers read and write the notes. */

import type { TaskChange } from '@nib/markdown/task-edits'
import {
  isDate,
  NO_PRIORITY,
  type Priority,
  readDuration,
  readRemind,
  readTask,
  readTime,
  type TaskFields,
} from '@nib/markdown/task-line'
import { parseRule } from '../recurrence'
import type { Row } from '../types'

/** What an agent said that cannot be done, and which way to put it right. */
export class AgentError extends Error {
  constructor(
    readonly code: 'bad_arguments' | 'not_found',
    message: string,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/** A task as an agent is shown it. Everything a task does not have is left out. */
export interface TaskOut {
  /** `path#line:hash`: what `update_task` takes back. */
  at: string
  space: string
  text: string
  /** The box, where it is not open: `x`, `/`, `-`... */
  status?: string
  due?: string
  scheduled?: string
  start?: string
  time?: string
  deadline?: string
  /** Minutes. */
  duration?: number
  /** 1 to 3, Todoist's p1 to p3; none is p4. */
  priority?: number
  recurrence?: string
  remind?: string
  tags?: string[]
  assignee?: string
  /** The nearest heading above it. */
  section?: string
  done?: string
  /** The line of the task it is under, where it is a sub-task. */
  parent?: number
}

/** A row's anchor as one string: the note, the line, and the hash of its words. */
export function atOf(row: Pick<Row, 'path' | 'anchor'>): string {
  return `${row.path}#${row.anchor?.line ?? 0}:${row.anchor?.hash ?? ''}`
}

/** An anchor string read back. The path is everything before the last `#`, so a note
 *  with a `#` in its name is still found. */
export function readAt(at: unknown): { path: string; line: number; hash: string } {
  const found = typeof at === 'string' ? /^(.+)#(\d+):([0-9a-z]+)$/.exec(at.trim()) : null
  if (!found?.[1] || found[2] === undefined || !found[3]) {
    throw new AgentError('bad_arguments', 'at is a task\'s "at" from list_tasks or add_task')
  }
  return { path: found[1], line: Number(found[2]), hash: found[3] }
}

const priorityOut = (priority: Priority) => (priority < NO_PRIORITY ? priority : undefined)

/** A task row as the agent reads it. */
export function taskOut(row: Row): TaskOut {
  const task = row.task
  const out: TaskOut = { at: atOf(row), space: row.space, text: task?.text ?? '' }
  if (!task) return out
  if (task.status !== ' ') out.status = task.status
  const priority = priorityOut(task.priority)
  const remind = task.remind.map((one) =>
    'before' in one ? `${one.before}m` : 'at' in one ? `${one.at} ${one.time}` : one.time,
  )
  const extra: Record<string, unknown> = {
    due: task.due,
    scheduled: task.scheduled,
    start: task.start,
    time: task.zone && task.time ? `${task.time} ${task.zone}` : task.time,
    deadline: task.deadline,
    duration: task.duration,
    priority,
    recurrence: task.recurrence,
    remind: remind.length ? remind.join(', ') : undefined,
    tags: task.tags.length ? [...task.tags] : undefined,
    assignee: task.assignee,
    section: task.section.at(-1),
    done: task.completed ?? task.cancelledOn,
    parent: task.parent,
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) Object.assign(out, { [key]: value })
  }
  return out
}

/** The task an anchor names among a note's rows as they are now: the one on its line
 *  with its words, else the nearest one with the same words. Null where none has them. */
export function findTask(rows: readonly Row[], anchor: { line: number; hash: string }): Row | null {
  let best: Row | null = null
  for (const row of rows) {
    if (row.kind !== 'task' || row.anchor?.hash !== anchor.hash) continue
    const distance = Math.abs(row.anchor.line - anchor.line)
    if (!best?.anchor || distance < Math.abs(best.anchor.line - anchor.line)) best = row
  }
  return best
}

// ---- the arguments -----------------------------------------------------------------

type Args = Record<string, unknown>

const has = (args: Args, name: string) => name in args && args[name] !== undefined

/** A value as the words it says: words and numbers as written, anything else nothing. */
const words = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

/** A date argument: `YYYY-MM-DD`, or null to take it off. */
function dateArg(args: Args, name: string): string | null {
  const value = args[name]
  if (value === null || value === '') return null
  if (typeof value === 'string' && isDate(value.trim())) return value.trim()
  throw new AgentError('bad_arguments', `${name} is a date, YYYY-MM-DD, or null`)
}

/** `p1`, `1`, `"p1"`: 1 to 4, Todoist's numbers. */
function priorityArg(value: unknown): Priority {
  if (value === null) return NO_PRIORITY
  const number = typeof value === 'string' ? Number(value.trim().replace(/^p/i, '')) : value
  if (number === 1 || number === 2 || number === 3 || number === 4) return number
  throw new AgentError('bad_arguments', 'priority is 1 to 4, as Todoist numbers them (p1 is 1)')
}

function textArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value.trim())) {
    throw new AgentError('bad_arguments', `${name} is one line of words`)
  }
  return value.trim()
}

function tagsArg(value: unknown): string[] {
  const list = typeof value === 'string' ? value.split(/[\s,]+/) : value
  if (!Array.isArray(list) || !list.every((one) => typeof one === 'string')) {
    throw new AgentError('bad_arguments', 'tags is a list of tags')
  }
  return [...new Set(list.map((one: string) => one.trim().replace(/^#/, '')).filter(Boolean))]
}

/** What `update_task` changes, read off its arguments. `done` is the caller's: ticking
 *  is an edit of the note, not of the line. */
export function taskChange(args: Args): TaskChange {
  const change: TaskChange = {}
  for (const name of ['due', 'scheduled', 'start', 'deadline'] as const) {
    if (has(args, name)) change[name] = dateArg(args, name)
  }
  if (has(args, 'text')) change.text = textArg(args.text, 'text')
  if (has(args, 'status')) {
    const status = args.status
    if (typeof status !== 'string' || Array.from(status).length !== 1 || status === ']') {
      throw new AgentError('bad_arguments', 'status is the one character in the box')
    }
    change.status = status
    change.done = status === 'x' || status === 'X'
    change.cancelled = status === '-'
  }
  if (has(args, 'time')) {
    const time = args.time === null || args.time === '' ? null : readTime(words(args.time))
    if (time === null && args.time !== null && args.time !== '') {
      throw new AgentError('bad_arguments', 'time is HH:MM, with a zone after it if you like')
    }
    change.time = time?.time ?? null
    change.zone = time?.zone ?? null
  }
  if (has(args, 'priority')) change.priority = priorityArg(args.priority)
  if (has(args, 'recurrence')) {
    const rule = args.recurrence
    if (rule === null || rule === '') change.recurrence = null
    else if (typeof rule === 'string' && parseRule(rule)) change.recurrence = rule.trim()
    else
      throw new AgentError('bad_arguments', 'recurrence is a rule such as "every week on Monday"')
  }
  if (has(args, 'remind')) {
    const said = args.remind
    const remind =
      said === null || said === ''
        ? []
        : readRemind(Array.isArray(said) ? said.map(words).join(',') : words(said))
    if (remind === null) {
      throw new AgentError(
        'bad_arguments',
        'remind is "15m", "09:00" or "2026-10-06 09:00", or several',
      )
    }
    change.remind = remind
  }
  if (has(args, 'duration')) {
    const said = args.duration
    const minutes = said === null || said === '' ? null : readDuration(words(said))
    if (minutes === null && said !== null && said !== '') {
      throw new AgentError('bad_arguments', 'duration is minutes, or "1h30m"')
    }
    change.duration = minutes
  }
  if (has(args, 'assignee')) {
    change.assignee =
      args.assignee === null || args.assignee === '' ? null : textArg(args.assignee, 'assignee')
  }
  if (has(args, 'tags')) change.tags = tagsArg(args.tags)
  return change
}

/** A new open task with nothing on it but its words. */
function bare(text: string): TaskFields {
  return {
    text,
    status: ' ',
    done: false,
    cancelled: false,
    remind: [],
    priority: NO_PRIORITY,
    tags: [],
    dependsOn: [],
    fields: {},
  }
}

/** Reads a line of words into a task's fields. The Tasks plugin's own marks and nib's
 *  bracket fields are read as they are written (`Call 📅 2026-10-06 ⏫ #admin`); quick
 *  add's grammar reads the rest when it is handed in. */
export type ReadWords = (text: string) => Read

/** A line of words, read: the task's fields, and where the words said it goes. */
export interface Read {
  fields: TaskFields
  /** `>Note`, as written. */
  note?: string
  /** `/Heading`. */
  heading?: string
}

/** The fields written in the words themselves, and nothing guessed. */
export const writtenFields: ReadWords = (text) => ({
  fields: readTask(`- [ ] ${text}`) ?? bare(text),
})

/** The task `add_task` writes: its words read by `read`, then every field said on its
 *  own on top of them. */
export function newTask(args: Args, read: ReadWords = writtenFields): Read {
  const fields =
    args.fields !== null && typeof args.fields === 'object' ? (args.fields as Args) : {}
  const said = { ...fields, ...args }
  const text = textArg(said.text, 'text')
  const words = read(text)
  const task: TaskFields = { ...words.fields }
  if (!task.text) throw new AgentError('bad_arguments', 'text needs words besides its fields')

  const change = taskChange(
    Object.fromEntries(Object.entries(said).filter(([key]) => key !== 'text')),
  )
  for (const [key, value] of Object.entries(change)) {
    if (value === null) Reflect.deleteProperty(task, key)
    else Object.assign(task, { [key]: value })
  }
  return { ...words, fields: task }
}

// ---- the lines -----------------------------------------------------------------------

/** The lines a task takes with it when it moves: its own, and every line indented
 *  under it (its description, comments and sub-tasks). Offsets into the note, the
 *  line break after the last one included. */
export function taskBlock(
  text: string,
  line: number,
): { from: number; to: number; lines: string[] } {
  const all = text.split('\n')
  const first = all[line] ?? ''
  const indent = first.length - first.trimStart().length
  let last = line
  for (let at = line + 1; at < all.length; at++) {
    const one = all[at] ?? ''
    if (one.trim() === '') {
      const next = all.slice(at + 1).find((rest) => rest.trim() !== '')
      if (next === undefined || next.length - next.trimStart().length <= indent) break
      continue
    }
    if (one.length - one.trimStart().length <= indent) break
    last = at
  }
  const from = all.slice(0, line).join('\n').length + (line ? 1 : 0)
  const to = Math.min(text.length, all.slice(0, last + 1).join('\n').length + 1)
  const lines = all.slice(line, last + 1).map((one) => one.replace(/\r$/, '').slice(indent))
  return { from, to, lines }
}
