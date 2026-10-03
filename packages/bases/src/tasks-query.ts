/** A ` ```tasks ` fence, the Tasks plugin's query block, read as a view.
 *
 *  Obsidian users keep their lists in these: `not done`, `due before tomorrow`,
 *  `path includes Work`, `group by heading`, `sort by priority`, `limit 10`. Each
 *  line becomes a filter, a grouping, a sort or a limit of one list view of task
 *  rows, so the block is drawn as a live list in nib instead of as code. A line
 *  this cannot read is answered back rather than guessed at, and the block keeps
 *  its source either way. */

import { dateWords } from './date-words'
import type { Base, Filter, Sort, View } from './types'

export interface TasksQuery {
  base: Base
  /** The lines nib does not read, as written. */
  unsupported: string[]
}

const quote = (text: string) => JSON.stringify(text)

/** The plugin's date fields, by the word its queries use. */
const DATE_FIELDS: Record<string, string> = {
  due: 'task.due',
  scheduled: 'task.scheduled',
  starts: 'task.start',
  start: 'task.start',
  done: 'task.completed',
  created: 'task.created',
  cancelled: 'task.cancelledOn',
}

const PRIORITIES: Record<string, number> = {
  highest: 1,
  high: 2,
  medium: 3,
  none: 4,
  normal: 4,
  low: 5,
  lowest: 6,
}

/** The start of this week, Monday, as an expression. */
const MONDAY = 'today() - duration((number(today().format("E")) - 1) + "d")'

/** A date or a span of dates in the plugin's words: `[from, to]`, both inclusive. */
function span(words: string): [string, string] | null {
  const text = words.trim().toLowerCase()
  const weeks: Record<string, number> = { 'this week': 0, 'next week': 1, 'last week': -1 }
  const shift = weeks[text]
  if (shift !== undefined) {
    const start = shift === 0 ? MONDAY : `${MONDAY} ${shift > 0 ? '+' : '-'} "7d"`
    return [start, `${start} + "6d"`]
  }
  const range = /^(\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/.exec(text)
  if (range) return [`date(${quote(range[1] ?? '')})`, `date(${quote(range[2] ?? '')})`]
  const one = dateWords(text, {})
  return one && !one.clock ? [one.expression, one.expression] : null
}

/** One date line: `due before tomorrow`, `happens on 2026-10-06`, `starts after today`. */
function dateLine(field: string, op: string, words: string): string | null {
  const dates = span(words)
  if (!dates) return null
  const [from, to] = dates
  const test = (value: string) => {
    switch (op) {
      case 'before':
        return `${value} < ${from}`
      case 'after':
        return `${value} > ${to}`
      case 'on or before':
        return `${value} <= ${to}`
      case 'on or after':
        return `${value} >= ${from}`
      default:
        return from === to ? `${value} == ${from}` : `${value} >= ${from} && ${value} <= ${to}`
    }
  }
  if (field === 'happens')
    return ['task.due', 'task.scheduled', 'task.start'].map((one) => `(${test(one)})`).join(' || ')
  const value = DATE_FIELDS[field]
  if (!value) return null
  // A task with no start date has started, so `starts before` keeps it, as in the plugin.
  return field === 'starts' || field === 'start' ? `!${value} || (${test(value)})` : test(value)
}

/** A text field matched the plugin's way: `includes` ignores case. */
function textLine(value: string, op: string, words: string): string | null {
  const wanted = words.trim()
  switch (op) {
    case 'includes':
    case 'include':
      return `${value}.lower().contains(${quote(wanted.toLowerCase())})`
    case 'does not include':
    case 'do not include':
      return `!${value}.lower().contains(${quote(wanted.toLowerCase())})`
    case 'regex matches':
      return `${wanted}.matches(${value})`
    case 'regex does not match':
      return `!${wanted}.matches(${value})`
    default:
      return null
  }
}

const TEXT_FIELDS: Record<string, string> = {
  path: 'file.path',
  filename: 'file.name',
  folder: 'file.folder',
  description: 'task.text',
  heading: 'task.section',
  root: 'file.path',
}

/** One filter line as an expression, or null for one this does not read. */
function filterLine(line: string): string | null {
  const text = line.trim().toLowerCase()
  switch (text) {
    case 'done':
      return 'task.done'
    case 'not done':
      return '!task.done && !task.cancelled'
    case 'is recurring':
      return 'task.recurring'
    case 'is not recurring':
      return '!task.recurring'
    case 'is blocked':
      return 'task.dependsOn.length > 0'
    case 'is not blocked':
      return 'task.dependsOn.isEmpty()'
    case 'exclude sub-items':
      return '!task.subtask'
  }

  const presence = /^(no|has) (due|scheduled|start|created|done|cancelled|happens) date$/.exec(text)
  if (presence) {
    const field = presence[2] ?? ''
    const value =
      field === 'happens'
        ? '(task.due || task.scheduled || task.start)'
        : (DATE_FIELDS[field] ?? 'task.due')
    return presence[1] === 'no' ? `!${value}` : value
  }

  const date =
    /^(due|scheduled|starts|start|happens|done|created|cancelled)(?: (on or before|on or after|before|after|on|in))? (.+)$/.exec(
      text,
    )
  if (date) return dateLine(date[1] ?? '', date[2] ?? 'on', date[3] ?? '')

  const priority =
    /^priority is(?: (above|below|not))? (highest|high|medium|none|normal|low|lowest)$/.exec(text)
  if (priority) {
    const level = PRIORITIES[priority[2] ?? 'none'] ?? 4
    const op =
      priority[1] === 'above'
        ? '<'
        : priority[1] === 'below'
          ? '>'
          : priority[1] === 'not'
            ? '!='
            : '=='
    return `task.priority ${op} ${level}`
  }

  const status = /^status\.type is( not)? (todo|done|in_progress|cancelled|non_task)$/.exec(text)
  if (status) {
    const is = {
      todo: 'task.status == " "',
      done: 'task.done',
      in_progress: 'task.status == "/"',
      cancelled: 'task.cancelled',
      non_task: 'false',
    }[status[2] as 'todo' | 'done' | 'in_progress' | 'cancelled' | 'non_task']
    return status[1] ? `!(${is})` : is
  }

  const tags =
    /^(tags?) (include|includes|do not include|does not include|regex matches|regex does not match) (.+)$/.exec(
      line.trim(),
    )
  if (tags) {
    const op = (tags[2] ?? '').toLowerCase()
    const wanted = (tags[3] ?? '').trim().replace(/^#/, '')
    if (op.startsWith('regex')) {
      const found = `task.tags.filter(${wanted}.matches(value)).length > 0`
      return op.includes('not') ? `!(${found})` : found
    }
    const found = `task.tags.filter(value.lower().contains(${quote(wanted.toLowerCase())})).length > 0`
    return op.includes('not') ? `!(${found})` : found
  }

  const field =
    /^(path|filename|folder|description|heading|root) (includes|does not include|regex matches|regex does not match) (.+)$/.exec(
      line.trim(),
    )
  if (field) {
    const value = TEXT_FIELDS[(field[1] ?? '').toLowerCase()]
    return value ? textLine(value, (field[2] ?? '').toLowerCase(), field[3] ?? '') : null
  }
  return null
}

/** `(A) AND (B)`, `(A) OR NOT (B)`, `NOT (A)`: the plugin's boolean lines, read
 *  with the filter lines inside them. */
function booleanLine(line: string): Filter | null {
  const text = line.trim()
  if (!text.startsWith('(') && !/^not\s*\(/i.test(text)) return null

  let at = 0
  const skip = () => {
    while (/\s/.test(text.charAt(at))) at++
  }
  const word = (wanted: string) => {
    skip()
    if (
      text.slice(at, at + wanted.length).toUpperCase() === wanted &&
      /[\s(]/.test(text.charAt(at + wanted.length))
    ) {
      at += wanted.length
      return true
    }
    return false
  }
  const group = (): Filter | null => {
    skip()
    if (word('NOT')) {
      const inner = group()
      return inner === null ? null : { not: [inner] }
    }
    if (text.charAt(at) !== '(') return null
    let depth = 0
    const start = at
    for (; at < text.length; at++) {
      if (text.charAt(at) === '(') depth++
      if (text.charAt(at) === ')') depth--
      if (depth === 0) break
    }
    const inside = text.slice(start + 1, at)
    at++
    return booleanLine(inside) ?? filterLine(inside)
  }

  const first = group()
  if (first === null) return null
  let result: Filter = first
  for (;;) {
    skip()
    if (at >= text.length) return result
    const op = word('AND') ? 'and' : word('OR') ? 'or' : word('XOR') ? 'xor' : null
    if (!op) return null
    const next = group()
    if (next === null) return null
    if (op === 'and') result = { and: [result, next] }
    else if (op === 'or') result = { or: [result, next] }
    else result = { or: [{ and: [result, { not: [next] }] }, { and: [next, { not: [result] }] }] }
  }
}

/** The plugin's grouping and sorting words, as properties. */
const PROPERTIES: Record<string, string> = {
  due: 'task.due',
  scheduled: 'task.scheduled',
  start: 'task.start',
  starts: 'task.start',
  happens: 'task.date',
  done: 'task.completed',
  created: 'task.created',
  cancelled: 'task.cancelledOn',
  priority: 'task.priority',
  filename: 'file.basename',
  folder: 'file.folder',
  path: 'file.path',
  heading: 'task.section',
  status: 'task.status',
  'status.type': 'task.status',
  tags: 'task.tags',
  tag: 'task.tags',
  recurring: 'task.recurring',
  recurrence: 'task.recurrence',
  description: 'task.text',
  urgency: 'task.priority',
}

/** Lines that only change how the plugin draws a list, which nib draws its own way. */
const DRAWING = /^(hide|show|short mode|full mode|short|full|explain|ignore global query|layout)\b/i

/** A ` ```tasks ` fence's lines as a list view of task rows. */
export function readTasksQuery(source: string): TasksQuery {
  const filters: Filter[] = []
  const sort: Sort[] = []
  const groups: Sort[] = []
  const unsupported: string[] = []
  let limit: number | undefined

  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || DRAWING.test(line)) continue

    const sorted = /^(sort|group) by ([\w.]+)( reverse)?$/i.exec(line)
    if (sorted) {
      const property = PROPERTIES[(sorted[2] ?? '').toLowerCase()]
      if (!property) {
        unsupported.push(raw)
        continue
      }
      const one: Sort = { property, direction: sorted[3] ? 'DESC' : 'ASC' }
      if ((sorted[1] ?? '').toLowerCase() === 'sort') sort.push(one)
      else groups.push(one)
      continue
    }

    const limited = /^limit(?: to)? (\d+)(?: tasks?)?$/i.exec(line)
    if (limited) {
      limit = Number(limited[1])
      continue
    }

    const filter = booleanLine(line) ?? filterLine(line)
    if (filter === null) unsupported.push(raw)
    else filters.push(filter)
  }

  const view: View = {
    type: 'list',
    name: 'Tasks',
    order: [],
    sort,
    summaries: {},
    nib: { rows: 'tasks', showCompleted: true, kept: {} },
    options: {},
  }
  if (filters.length === 1 && filters[0] !== undefined) view.filters = filters[0]
  else if (filters.length) view.filters = { and: filters }
  if (groups[0]) view.groupBy = groups[0]
  if (groups[1]) view.nib.subGroupBy = groups[1]
  if (limit) view.limit = limit

  return {
    base: {
      formulas: {},
      properties: {},
      summaries: {},
      views: [view],
      nib: { properties: {}, kept: {} },
      kept: {},
    },
    unsupported,
  }
}
