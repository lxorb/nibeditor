/** A task line changed as the smallest edits that change it.
 *
 *  A date picked on a chip, a box ticked in a view, a priority set by an agent: each
 *  is a change of one field, and each comes out as an edit of the characters that
 *  field is written in. A field that is there has its value rewritten and keeps its
 *  key and its form; a field that goes takes the blank before it with it; a field
 *  that comes is put where nib's order says it belongs, which is the order the Tasks
 *  plugin reads in:
 *
 *    words, nib's bracket fields, tags, then the Tasks plugin's fields in its own
 *    order (id, depends on, priority, repeat, on completion, created, start,
 *    scheduled, due, cancelled, done), then a block id.
 *
 *  The plugin reads its fields from the end of the line and stops at the first
 *  thing it does not know, so nib's brackets stand before its fields and never
 *  after them. A line written in Dataview's format (its Tasks fields in brackets
 *  and none as emoji) gets new Tasks fields in brackets too, so it stays one
 *  format. See task-line.ts for the reading. */

import { appliedEdits, type TextEdit } from './edits'
import {
  DEPENDS_EMOJI,
  EMOJI_BY_DATE,
  EMOJI_BY_PRIORITY,
  type FieldName,
  type FieldToken,
  ID_EMOJI,
  KEY_BY_FIELD,
  NIB_FIELDS,
  NO_PRIORITY,
  ON_COMPLETION_EMOJI,
  type ParsedTask,
  type Priority,
  parseTask,
  RECURRENCE_EMOJI,
  TASKS_FIELDS,
  type TaskFields,
  WORD_BY_PRIORITY,
  writeDuration,
  writeRemind,
} from './task-line'

/** A change to a task: a field given is set, a field given as null goes. */
export type TaskChange = { [K in keyof TaskFields]?: TaskFields[K] | null }

/** Where each kind of field stands on a line, lowest first. */
const RANK: Record<FieldToken['field'], number> = {
  time: 10,
  duration: 11,
  deadline: 12,
  remind: 13,
  assignee: 14,
  other: 19,
  id: 30,
  dependsOn: 31,
  priority: 32,
  recurrence: 33,
  onCompletion: 34,
  created: 35,
  start: 36,
  scheduled: 37,
  due: 38,
  cancelledOn: 39,
  completed: 40,
  block: 50,
  tag: 20,
}

/** The fields the writer sets, in the order a whole line is written. */
const WRITTEN: readonly FieldName[] = [...NIB_FIELDS, ...TASKS_FIELDS, 'block']

/** A field's value as it is written after its key or emoji, or null for a value
 *  that means the field is not there. */
function valueText(
  field: FieldName,
  fields: Partial<TaskFields>,
  form: 'emoji' | 'bracket',
): string | null {
  switch (field) {
    case 'priority': {
      const priority: Priority = fields.priority ?? NO_PRIORITY
      if (priority === NO_PRIORITY) return null
      return form === 'emoji' ? EMOJI_BY_PRIORITY[priority] : WORD_BY_PRIORITY[priority]
    }
    case 'dependsOn':
      return fields.dependsOn?.length ? fields.dependsOn.join(',') : null
    case 'remind':
      return fields.remind?.length ? writeRemind(fields.remind) : null
    case 'duration':
      return fields.duration === undefined ? null : writeDuration(fields.duration)
    case 'time':
      if (fields.time === undefined) return null
      return fields.zone ? `${fields.time} ${fields.zone}` : fields.time
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'completed':
    case 'cancelledOn':
    case 'deadline':
    case 'recurrence':
    case 'onCompletion':
    case 'id':
    case 'assignee':
    case 'block': {
      const value = fields[field]
      return value === undefined || value === '' ? null : value
    }
  }
}

/** The whole field as it is written: `📅 2026-10-06`, `[time:: 16:00]`, `^abc`. */
function fieldText(field: FieldName, value: string, form: 'emoji' | 'bracket'): string {
  if (field === 'block') return `^${value}`
  if (form === 'bracket' || NIB_FIELDS.includes(field)) return `[${KEY_BY_FIELD[field]}:: ${value}]`

  switch (field) {
    case 'priority':
      return value
    case 'recurrence':
      return `${RECURRENCE_EMOJI} ${value}`
    case 'onCompletion':
      return `${ON_COMPLETION_EMOJI} ${value}`
    case 'id':
      return `${ID_EMOJI} ${value}`
    case 'dependsOn':
      return `${DEPENDS_EMOJI} ${value}`
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'completed':
    case 'cancelledOn':
    case 'time':
    case 'duration':
    case 'deadline':
    case 'remind':
    case 'assignee':
      return `${EMOJI_BY_DATE[field] ?? ''} ${value}`
  }
}

/** Whether the line keeps its Tasks fields in Dataview's brackets. */
function bracketStyle(parsed: ParsedTask): boolean {
  const tasks = parsed.tokens.filter(
    (token) =>
      token.field !== 'tag' && token.field !== 'other' && TASKS_FIELDS.includes(token.field),
  )
  return tasks.length > 0 && tasks.every((token) => token.form !== 'emoji')
}

/** The edit that takes a span out of the line with the blank in front of it, or
 *  the blank after it when it opens the words. */
function removal(line: string, from: number, to: number, wordsFrom: number): TextEdit {
  let start = from
  while (start > wordsFrom && /[ \t]/.test(line.charAt(start - 1))) start--
  if (start > wordsFrom) return { from: start, to, insert: '' }

  let end = to
  while (end < line.length && /[ \t]/.test(line.charAt(end))) end++
  return { from, to: end, insert: '' }
}

/** Two values of a field the same, lists and reminders by what they hold. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** The box's character after the change, or null when it stays. */
function nextStatus(fields: TaskFields, change: TaskChange): string | null {
  let status = fields.status
  if (change.status != null) status = change.status
  else if (change.done === true) status = 'x'
  else if (change.cancelled === true) status = '-'
  else if (change.done === false && fields.done) status = ' '
  else if (change.cancelled === false && fields.cancelled) status = ' '
  return status === fields.status ? null : status
}

/** Whether the change sets the field this token holds. A token among the words
 *  that a change of the words would carry over is put back with its new value
 *  instead. */
function touches(change: TaskChange, token: FieldToken): boolean {
  if (token.field === 'other') return change.fields != null
  if (token.field === 'tag') return false
  return token.field in change || (token.field === 'time' && 'zone' in change)
}

/** A field to put on the line, by its rank. */
interface Arrival {
  rank: number
  text: string
}

/** The edits that turn `line` into the line with `change` made, smallest first,
 *  in line order, never overlapping, offsets into the line. None for a line that is
 *  not a task, or a change that changes nothing. */
export function writeTask(line: string, change: TaskChange): TextEdit[] {
  const parsed = parseTask(line)
  if (!parsed) return []

  const { fields, tokens } = parsed
  const edits: TextEdit[] = []
  const gone = new Set<FieldToken>()
  const arriving: Arrival[] = []
  const form = bracketStyle(parsed) ? 'bracket' : 'emoji'

  const status = nextStatus(fields, change)
  if (status !== null)
    edits.push({ from: parsed.box + 1, to: parsed.box + 1 + fields.status.length, insert: status })

  const textChanges = change.text != null && change.text !== fields.text
  if (textChanges) {
    const inline = tokens.filter((token) => token.inline)
    const kept = inline
      .filter((token) => !touches(change, token))
      .map((token) => line.slice(token.from, token.to))
    edits.push({
      from: parsed.wordsFrom,
      to: parsed.wordsTo,
      insert: [change.text, ...kept].filter((part) => part !== '').join(' '),
    })
    for (const token of inline) gone.add(token)
  }

  if (change.tags != null && !same(change.tags, fields.tags)) {
    const next = change.tags
    for (const tag of fields.tags.filter((one) => !next.includes(one))) {
      const token = tokens.find(
        (one) => one.field === 'tag' && line.slice(one.from + 1, one.to) === tag,
      )
      if (token) {
        gone.add(token)
        edits.push(removal(line, token.from, token.to, parsed.wordsFrom))
      } else if (!textChanges) {
        const at = tagAmongWords(line, tag, parsed.wordsFrom, parsed.wordsTo)
        if (at !== null) edits.push(removal(line, at, at + tag.length + 1, parsed.wordsFrom))
      }
    }
    for (const tag of next.filter((one) => !fields.tags.includes(one))) {
      arriving.push({ rank: RANK.tag, text: `#${tag}` })
    }
  }

  for (const field of WRITTEN) {
    const touched = field in change || (field === 'time' && 'zone' in change)
    if (!touched) continue

    const after: Partial<TaskFields> = { ...fields }
    const given = change[field]
    if (given === null) Reflect.deleteProperty(after, field)
    else if (given !== undefined) Object.assign(after, { [field]: given })
    if (field === 'time' && 'zone' in change) {
      if (change.zone == null) delete after.zone
      else after.zone = change.zone
    }
    if (field === 'priority' && given === null) after.priority = NO_PRIORITY
    if ((field === 'remind' || field === 'dependsOn') && given === null) after[field] = []

    const token = tokens.find((one) => one.field === field && !gone.has(one))
    const was = token
      ? valueText(field, fields, token.form === 'emoji' ? 'emoji' : 'bracket')
      : null
    const tokenForm = token?.form === 'emoji' ? 'emoji' : token ? 'bracket' : form
    const value = valueText(field, after, tokenForm)
    if (value === was || (token === undefined && value === null)) continue

    if (token && value === null) {
      gone.add(token)
      edits.push(removal(line, token.from, token.to, parsed.wordsFrom))
    } else if (token && value !== null) {
      const whole = field === 'priority' && token.form === 'emoji'
      edits.push(
        whole
          ? { from: token.from, to: token.to, insert: value }
          : { from: token.valueFrom, to: token.valueTo, insert: value },
      )
    } else if (value !== null) {
      arriving.push({ rank: RANK[field], text: fieldText(field, value, form) })
    }
  }

  edits.push(...unknownFieldEdits(line, parsed, change, gone, arriving))
  edits.push(...arrivals(line, parsed, gone, arriving))

  return ordered(edits)
}

/** The edits for Dataview fields nib has no name for. */
function unknownFieldEdits(
  line: string,
  parsed: ParsedTask,
  change: TaskChange,
  gone: Set<FieldToken>,
  arriving: Arrival[],
): TextEdit[] {
  if (change.fields == null) return []
  const edits: TextEdit[] = []
  const next = change.fields
  const before = parsed.fields.fields

  for (const token of parsed.tokens) {
    if (token.field !== 'other' || token.key === undefined) continue
    const key = token.key.trim()
    if (gone.has(token)) {
      const value = next[key]
      if (value !== undefined) arriving.push({ rank: RANK.other, text: `[${key}:: ${value}]` })
      continue
    }
    if (!(key in next)) {
      gone.add(token)
      edits.push(removal(line, token.from, token.to, parsed.wordsFrom))
    } else if (next[key] !== before[key]) {
      edits.push({ from: token.valueFrom, to: token.valueTo, insert: next[key] ?? '' })
    }
  }
  for (const [key, value] of Object.entries(next)) {
    if (!(key in before)) arriving.push({ rank: RANK.other, text: `[${key}:: ${value}]` })
  }
  return edits
}

/** Where a tag written among the words starts, or null. */
function tagAmongWords(line: string, tag: string, from: number, to: number): number | null {
  const words = line.slice(from, to)
  let at = words.indexOf(`#${tag}`)
  while (at !== -1) {
    const before = words.charAt(at - 1)
    const after = words.charAt(at + tag.length + 1)
    if ((before === '' || /\s|\(/.test(before)) && !/[\p{L}\p{N}\-_/]/u.test(after))
      return from + at
    at = words.indexOf(`#${tag}`, at + 1)
  }
  return null
}

/** The insertions for the fields that arrive: each before the first field that
 *  ranks after it, or after the last field when none does. */
function arrivals(
  line: string,
  parsed: ParsedTask,
  gone: Set<FieldToken>,
  arriving: Arrival[],
): TextEdit[] {
  const staying = parsed.tokens.filter((token) => !token.inline && !gone.has(token))
  const before = new Map<number, Arrival[]>()
  const after: Arrival[] = []

  for (const arrival of arriving) {
    const next = staying.find((token) => RANK[token.field] > arrival.rank)
    if (next) before.set(next.from, [...(before.get(next.from) ?? []), arrival])
    else after.push(arrival)
  }

  const byRank = (list: Arrival[]) =>
    [...list]
      .sort((a, b) => a.rank - b.rank)
      .map((one) => one.text)
      .join(' ')

  const edits: TextEdit[] = [...before].map(([at, list]) => ({
    from: at,
    to: at,
    insert: `${byRank(list)} `,
  }))
  if (after.length) {
    const end = staying.at(-1)?.to ?? parsed.wordsTo
    const blank = /\s/.test(line.charAt(end - 1)) || end === 0 ? '' : ' '
    edits.push({ from: end, to: end, insert: blank + byRank(after) })
  }
  return edits
}

/** Edits in line order, an insertion before a removal at the same place. */
function ordered(edits: TextEdit[]): TextEdit[] {
  return edits.sort((a, b) => a.from - b.from || a.to - a.from - (b.to - b.from))
}

/** The line with the change made. */
export function changedTask(line: string, change: TaskChange): string {
  return appliedEdits(line, writeTask(line, change))
}

/** A whole task line, written in nib's order: the shape a new line takes. */
export function taskLine(fields: TaskFields, prefix = '- '): string {
  const parts = [fields.text]
  for (const field of NIB_FIELDS) {
    const value = valueText(field, fields, 'bracket')
    if (value !== null) parts.push(fieldText(field, value, 'bracket'))
  }
  for (const [key, value] of Object.entries(fields.fields)) parts.push(`[${key}:: ${value}]`)

  const inText = new Set(tagsWritten(fields.text))
  for (const tag of fields.tags) if (!inText.has(tag)) parts.push(`#${tag}`)

  for (const field of [...TASKS_FIELDS, 'block'] as const) {
    const value = valueText(field, fields, 'emoji')
    if (value !== null) parts.push(fieldText(field, value, 'emoji'))
  }

  return `${prefix}[${fields.status}] ${parts.filter((part) => part !== '').join(' ')}`
}

/** The tags the words already carry. */
function tagsWritten(text: string): string[] {
  return parseTask(`- [ ] ${text}`)?.fields.tags ?? []
}
