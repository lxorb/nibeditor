/** What a task line says beyond its box: the dates, the priority, the rule it
 *  repeats by, and the fields nib adds, read the way the Obsidian Tasks plugin
 *  reads them so a space opened in either app means the same thing.
 *
 *  The Tasks plugin reads a line from its end backwards, taking one field at a time
 *  until it meets something it does not know, and puts tags it passed on the way
 *  back into the words. This does the same, in the same order, with two additions:
 *  Dataview's bracket fields (`[time:: 16:00]`, and the round `(time:: 16:00)`) are
 *  fields too, wherever they stand, and every field remembers where it was written,
 *  so the writer (task-edits.ts) can change one value as one small edit and leave
 *  every other character of the line alone.
 *
 *  Pure, and in this package because the window, the search, the editor's chips and
 *  the rows engine all ask it about the same line. `taskAt` (tasks.ts) still answers
 *  the narrower question of where the box is. */

import { taskAt } from './tasks'
import { TAG_NAME, opensTag } from './tags'

/** p1 to p4 as Todoist numbers them, then the Tasks plugin's two low ones: sorting
 *  ascending puts the most urgent first and the low ones after the ones with none. */
export type Priority = 1 | 2 | 3 | 4 | 5 | 6

/** No priority, Todoist's p4. */
export const NO_PRIORITY: Priority = 4

/** A reminder: some minutes before the task's time, at a time on the task's own
 *  day, or at a moment of its own. */
export type Remind = { before: number } | { time: string } | { at: string; time: string }

export interface TaskFields {
  /** The words, without the fields and without the tags written after them. */
  text: string
  /** The character in the box, as written. */
  status: string
  /** `[x]` or `[X]`. */
  done: boolean
  /** `[-]`. */
  cancelled: boolean
  due?: string
  scheduled?: string
  start?: string
  created?: string
  /** The `✅` date. */
  completed?: string
  /** The `❌` date. */
  cancelledOn?: string
  /** `HH:MM`, the time of the due date, or of the scheduled one where there is no due. */
  time?: string
  /** An IANA zone written after the time; a time without one is floating. */
  zone?: string
  /** Minutes. */
  duration?: number
  deadline?: string
  remind: Remind[]
  priority: Priority
  /** The rule as written, `when done` included: `every week on Monday when done`. */
  recurrence?: string
  /** The Tasks plugin's `🏁 delete` or `🏁 keep`. */
  onCompletion?: string
  /** Every tag on the line, without its `#`. */
  tags: string[]
  assignee?: string
  id?: string
  dependsOn: string[]
  /** A block id, `^abc`, without its caret. */
  block?: string
  /** Inline fields nib has no name for, by key as written, so nothing read is lost. */
  fields: Record<string, string>
}

/** A field a line can carry, by the name TaskFields gives it. */
export type FieldName =
  | 'due'
  | 'scheduled'
  | 'start'
  | 'created'
  | 'completed'
  | 'cancelledOn'
  | 'priority'
  | 'recurrence'
  | 'onCompletion'
  | 'id'
  | 'dependsOn'
  | 'time'
  | 'duration'
  | 'deadline'
  | 'remind'
  | 'assignee'
  | 'block'

/** How a field was written: the Tasks plugin's emoji, Dataview's brackets or
 *  parentheses, a trailing tag, or the block id's caret. */
export type FieldForm = 'emoji' | 'bracket' | 'paren' | 'tag' | 'caret'

/** One field as it stands on the line. Offsets are into the line. `from` is where
 *  the field's first character is, never the blank before it. */
export interface FieldToken {
  /** The field's name, `tag` for a trailing tag, or `other` for a field nib does
   *  not know. */
  field: FieldName | 'tag' | 'other'
  form: FieldForm
  from: number
  to: number
  /** Where the value sits, so a change rewrites the value and keeps the key. */
  valueFrom: number
  valueTo: number
  /** The key as written, for a bracket field. */
  key?: string
  /** Whether it stood among the words rather than in the run of fields at the end. */
  inline: boolean
}

/** A task line taken apart: its fields, and the spans the writer needs. */
export interface ParsedTask {
  fields: TaskFields
  /** Where the box's character is. */
  box: number
  /** Where the words start: after the marker and the box. */
  wordsFrom: number
  /** Where the words end: before the run of fields at the end of the line. */
  wordsTo: number
  /** Every field, in the order they stand on the line. */
  tokens: FieldToken[]
}

/** The priorities by emoji, and back. */
const PRIORITY_BY_EMOJI: Record<string, Priority> = {
  '🔺': 1,
  '⏫': 2,
  '🔼': 3,
  '🔽': 5,
  '⏬': 6,
}

export const EMOJI_BY_PRIORITY: Record<Priority, string> = {
  1: '🔺',
  2: '⏫',
  3: '🔼',
  4: '',
  5: '🔽',
  6: '⏬',
}

/** Dataview's words for a priority, the ones the Tasks plugin writes in that format. */
const PRIORITY_BY_WORD: Record<string, Priority> = {
  highest: 1,
  high: 2,
  medium: 3,
  none: 4,
  normal: 4,
  low: 5,
  lowest: 6,
}

export const WORD_BY_PRIORITY: Record<Priority, string> = {
  1: 'highest',
  2: 'high',
  3: 'medium',
  4: 'none',
  5: 'low',
  6: 'lowest',
}

/** The date fields by their emoji, the alternatives the Tasks plugin also reads
 *  included. */
const DATE_BY_EMOJI: Record<string, FieldName> = {
  '✅': 'completed',
  '❌': 'cancelledOn',
  '📅': 'due',
  '📆': 'due',
  '🗓': 'due',
  '⏳': 'scheduled',
  '⌛': 'scheduled',
  '🛫': 'start',
  '➕': 'created',
}

/** The emoji nib writes for each date field. */
export const EMOJI_BY_DATE: Partial<Record<FieldName, string>> = {
  completed: '✅',
  cancelledOn: '❌',
  due: '📅',
  scheduled: '⏳',
  start: '🛫',
  created: '➕',
}

/** The emoji of the other Tasks fields. */
export const RECURRENCE_EMOJI = '🔁'
export const ON_COMPLETION_EMOJI = '🏁'
export const ID_EMOJI = '🆔'
export const DEPENDS_EMOJI = '⛔'

/** A bracket field's key, read the way Dataview reads it: case and blanks aside. */
const FIELD_BY_KEY: Record<string, FieldName> = {
  due: 'due',
  scheduled: 'scheduled',
  start: 'start',
  created: 'created',
  completion: 'completed',
  cancelled: 'cancelledOn',
  priority: 'priority',
  repeat: 'recurrence',
  oncompletion: 'onCompletion',
  id: 'id',
  dependson: 'dependsOn',
  time: 'time',
  duration: 'duration',
  deadline: 'deadline',
  remind: 'remind',
  assignee: 'assignee',
}

/** The key each field is written under in Dataview's format. */
export const KEY_BY_FIELD: Record<FieldName, string> = {
  due: 'due',
  scheduled: 'scheduled',
  start: 'start',
  created: 'created',
  completed: 'completion',
  cancelledOn: 'cancelled',
  priority: 'priority',
  recurrence: 'repeat',
  onCompletion: 'onCompletion',
  id: 'id',
  dependsOn: 'dependsOn',
  time: 'time',
  duration: 'duration',
  deadline: 'deadline',
  remind: 'remind',
  assignee: 'assignee',
  block: 'block',
}

/** The fields only nib writes, always as brackets: the Tasks plugin has no emoji
 *  for them. */
export const NIB_FIELDS: readonly FieldName[] = [
  'time',
  'duration',
  'deadline',
  'remind',
  'assignee',
]

/** The Tasks plugin's fields. */
export const TASKS_FIELDS: readonly FieldName[] = [
  'id',
  'dependsOn',
  'priority',
  'recurrence',
  'onCompletion',
  'created',
  'start',
  'scheduled',
  'due',
  'cancelledOn',
  'completed',
]

const VARIANT = '️?'
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`

/** The fields the Tasks plugin takes off the end of a line, each anchored there.
 *  The patterns are the plugin's own (DefaultTaskSerializer.ts). */
const AT_END = {
  block: /(?<=\s)\^([A-Za-z0-9-]+)$/u,
  priority: new RegExp(`(🔺|⏫|🔼|🔽|⏬)${VARIANT}$`, 'u'),
  date: new RegExp(`(✅|❌|📅|📆|🗓|⏳|⌛|🛫|➕)${VARIANT} *${DATE}$`, 'u'),
  recurrence: new RegExp(`🔁${VARIANT} *([a-zA-Z0-9, !]+)$`, 'u'),
  onCompletion: new RegExp(`🏁${VARIANT} *([a-zA-Z]+)$`, 'u'),
  tag: /(?<=^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/u,
  id: new RegExp(`🆔${VARIANT} *([a-zA-Z0-9-_]+)$`, 'u'),
  dependsOn: new RegExp(`⛔${VARIANT} *([a-zA-Z0-9-_]+(?: *, *[a-zA-Z0-9-_]+ *)*)$`, 'u'),
  bracket: /\[([^[\]:]+?)::[ \t]*([^\]]*?)[ \t]*\]$/u,
  paren: /\(([^():]+?)::[ \t]*([^)]*?)[ \t]*\)$/u,
}

/** A bracket or round field anywhere among the words. */
const INLINE_FIELD = /\[([^[\]:]+?)::[ \t]*([^\]]*?)[ \t]*\]|\(([^():]+?)::[ \t]*([^)]*?)[ \t]*\)/gu

/** A tag anywhere, nib's grammar (tags.ts). */
const TAG = new RegExp(`#(${TAG_NAME})`, 'gu')

/** The Tasks plugin gives up after this many fields; so does this. */
const MOST_FIELDS = 40

/** A key the way Dataview compares keys. */
function keyOf(written: string): string {
  return written
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

/** `16:00`, `9:05`, `16:00 Europe/Zurich`. */
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+([A-Za-z_]+(?:\/[A-Za-z_+-]+)*))?$/

export function readTime(value: string): { time: string; zone?: string } | null {
  const found = TIME.exec(value.trim())
  if (!found) return null
  const hours = Number(found[1])
  const minutes = Number(found[2])
  if (hours > 23 || minutes > 59) return null
  const time = `${String(hours).padStart(2, '0')}:${found[2] ?? '00'}`
  return found[3] ? { time, zone: found[3] } : { time }
}

/** `45m`, `2h`, `1h30m`, `1h 30m`, `1.5h`, `90 min`, `90`: minutes, or null. */
export function readDuration(value: string): number | null {
  const written = value.trim().toLowerCase()
  if (/^\d+$/.test(written)) return Number(written)

  const found =
    /^(?:(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|std)\.?)?\s*(?:(\d+)\s*(?:m|min|mins|minutes?)\.?)?$/u.exec(
      written,
    )
  if (!found || (found[1] === undefined && found[2] === undefined)) return null

  const hours = Number((found[1] ?? '0').replace(',', '.'))
  return Math.round(hours * 60) + Number(found[2] ?? '0')
}

/** Minutes as nib writes them: `45m`, `2h`, `1h30m`. */
export function writeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}

/** A span of time before, written `15m`, `1h`, `1d`, `1h30m`: minutes, or null. */
function readBefore(value: string): number | null {
  const found = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(value.trim().toLowerCase())
  if (!found || (found[1] === undefined && found[2] === undefined && found[3] === undefined)) {
    return null
  }
  return Number(found[1] ?? 0) * 1440 + Number(found[2] ?? 0) * 60 + Number(found[3] ?? 0)
}

function writeBefore(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}d`
  return writeDuration(minutes)
}

/** `15m, 2026-10-06 09:00, 9:00`, or null when any of it is not a reminder. */
export function readRemind(value: string): Remind[] | null {
  const out: Remind[] = []
  for (const part of value.split(',')) {
    const one = part.trim()
    if (one === '') continue
    const at = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(one)
    const time = readTime(one)
    const before = readBefore(one)
    if (at?.[1] && at[2]) {
      const read = readTime(at[2])
      if (!read) return null
      out.push({ at: at[1], time: read.time })
    } else if (time && !time.zone) {
      out.push({ time: time.time })
    } else if (before !== null) {
      out.push({ before })
    } else {
      return null
    }
  }
  return out
}

export function writeRemind(remind: readonly Remind[]): string {
  return remind
    .map((one) => {
      if ('before' in one) return writeBefore(one.before)
      if ('at' in one) return `${one.at} ${one.time}`
      return one.time
    })
    .join(', ')
}

/** An ISO date, and only a real one. */
export function isDate(value: string): boolean {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!found) return false
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** The fields of a line with nothing set. */
function emptyFields(status: string): TaskFields {
  return {
    text: '',
    status,
    done: status === 'x' || status === 'X',
    cancelled: status === '-',
    remind: [],
    priority: NO_PRIORITY,
    tags: [],
    dependsOn: [],
    fields: {},
  }
}

/** Puts a value read under a field's name into the fields. False when the value is
 *  not one that field can hold, which keeps it as an unknown field instead. */
function setField(fields: TaskFields, field: FieldName, value: string): boolean {
  switch (field) {
    case 'due':
    case 'scheduled':
    case 'start':
    case 'created':
    case 'completed':
    case 'cancelledOn':
    case 'deadline': {
      const date = value.trim().slice(0, 10)
      if (!isDate(date)) return false
      fields[field] = date
      return true
    }
    case 'priority': {
      const priority = PRIORITY_BY_EMOJI[value] ?? PRIORITY_BY_WORD[value.trim().toLowerCase()]
      if (priority === undefined) return false
      fields.priority = priority
      return true
    }
    case 'recurrence':
    case 'onCompletion':
    case 'id':
    case 'assignee':
    case 'block': {
      const one = value.trim()
      if (one === '') return false
      fields[field] = one
      return true
    }
    case 'dependsOn':
      fields.dependsOn = value
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '')
      return true
    case 'time': {
      const read = readTime(value)
      if (!read) return false
      fields.time = read.time
      if (read.zone) fields.zone = read.zone
      return true
    }
    case 'duration': {
      const minutes = readDuration(value)
      if (minutes === null) return false
      fields.duration = minutes
      return true
    }
    case 'remind': {
      const remind = readRemind(value)
      if (!remind) return false
      fields.remind = remind
      return true
    }
  }
}

/** The run of fields at the end of the line, read backwards as the Tasks plugin
 *  reads them. Answers the tokens in line order and where the words end. */
function trailingTokens(
  line: string,
  from: number,
  fields: TaskFields,
): { tokens: FieldToken[]; end: number } {
  const tokens: FieldToken[] = []
  let end = line.trimEnd().length
  const seen = new Set<FieldName>()

  /** Takes the match off the end, as a token of this field. */
  const take = (
    found: RegExpExecArray,
    field: FieldToken['field'],
    form: FieldForm,
    value: number,
    key?: string,
  ) => {
    const start = from + found.index
    const valueText = found[value] ?? ''
    const valueFrom =
      valueText === '' && (form === 'bracket' || form === 'paren')
        ? start + found[0].length - 1
        : start + found[0].lastIndexOf(valueText)
    const token: FieldToken = {
      field,
      form,
      from: start,
      to: start + found[0].length,
      valueFrom,
      valueTo: valueFrom + valueText.length,
      inline: false,
    }
    if (key !== undefined) token.key = key
    tokens.unshift(token)
    end = line.slice(0, start).trimEnd().length
  }

  /** Reads a value into a field the first time the field is met: the Tasks plugin
   *  keeps the last one written, which is the first one read from the end. */
  const read = (field: FieldName, value: string) => {
    if (seen.has(field)) return true
    seen.add(field)
    return setField(fields, field, value)
  }

  const block = AT_END.block.exec(line.slice(from, end))
  if (block) {
    take(block, 'block', 'caret', 1)
    fields.block = block[1] ?? ''
  }

  for (let runs = 0; runs < MOST_FIELDS && end > from; runs++) {
    const head = line.slice(from, end)
    let found: RegExpExecArray | null

    if ((found = AT_END.priority.exec(head))) {
      read('priority', found[1] ?? '')
      take(found, 'priority', 'emoji', 1)
    } else if ((found = AT_END.date.exec(head))) {
      const field = DATE_BY_EMOJI[found[1] ?? ''] ?? 'due'
      read(field, found[2] ?? '')
      take(found, field, 'emoji', 2)
    } else if ((found = AT_END.recurrence.exec(head))) {
      read('recurrence', found[1] ?? '')
      take(found, 'recurrence', 'emoji', 1)
    } else if ((found = AT_END.onCompletion.exec(head))) {
      read('onCompletion', found[1] ?? '')
      take(found, 'onCompletion', 'emoji', 1)
    } else if ((found = AT_END.tag.exec(head))) {
      take(found, 'tag', 'tag', 0)
    } else if ((found = AT_END.id.exec(head))) {
      read('id', found[1] ?? '')
      take(found, 'id', 'emoji', 1)
    } else if ((found = AT_END.dependsOn.exec(head))) {
      read('dependsOn', found[1] ?? '')
      take(found, 'dependsOn', 'emoji', 1)
    } else if ((found = AT_END.bracket.exec(head) ?? AT_END.paren.exec(head))) {
      const form: FieldForm = found[0].startsWith('[') ? 'bracket' : 'paren'
      const key = found[1] ?? ''
      const field = FIELD_BY_KEY[keyOf(key)]
      const known = field !== undefined && read(field, found[2] ?? '')
      if (!known) fields.fields[key.trim()] = (found[2] ?? '').trim()
      take(found, known ? field : 'other', form, 2, key)
    } else {
      break
    }
  }

  return { tokens, end: Math.max(end, from) }
}

/** The bracket fields among the words: Dataview reads a field wherever it stands. */
function inlineTokens(line: string, from: number, to: number, fields: TaskFields): FieldToken[] {
  const tokens: FieldToken[] = []
  const words = line.slice(from, to)

  for (const found of words.matchAll(INLINE_FIELD)) {
    const bracket = found[1] !== undefined
    const key = (bracket ? found[1] : found[3]) ?? ''
    const value = (bracket ? found[2] : found[4]) ?? ''
    const field = FIELD_BY_KEY[keyOf(key)]
    const start = from + found.index
    const known =
      field !== undefined && fields[field] === undefined && setField(fields, field, value)
    if (!known) fields.fields[key.trim()] = value.trim()
    const valueFrom =
      value === '' ? start + found[0].length - 1 : start + found[0].lastIndexOf(value)
    tokens.push({
      field: known ? field : 'other',
      form: bracket ? 'bracket' : 'paren',
      from: start,
      to: start + found[0].length,
      valueFrom,
      valueTo: value === '' ? valueFrom : valueFrom + value.length,
      key,
      inline: true,
    })
  }
  return tokens
}

/** Every tag in a run of text, without its `#`, in the order written. */
export function tagsIn(text: string): string[] {
  const out: string[] = []
  for (const found of text.matchAll(TAG)) {
    if (!opensTag(text.charAt(found.index - 1))) continue
    const name = found[1] ?? ''
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** The line taken apart, or null for a line that is not a task. */
export function parseTask(line: string): ParsedTask | null {
  const item = taskAt(line)
  if (!item) return null

  const fields = emptyFields(item.mark)
  const { tokens: trailing, end } = trailingTokens(line, item.marker, fields)
  const inline = inlineTokens(line, item.marker, end, fields)

  let text = line.slice(item.marker, end)
  for (const token of [...inline].reverse()) {
    const before = text.slice(0, token.from - item.marker).trimEnd()
    const after = text.slice(token.to - item.marker).trimStart()
    text = before === '' || after === '' ? before + after : `${before} ${after}`
  }
  fields.text = text.trim()

  const trailingTags = trailing.filter((token) => token.field === 'tag')
  fields.tags = tagsIn(
    [
      line.slice(item.marker, end),
      ...trailingTags.map((token) => line.slice(token.from, token.to)),
    ].join(' '),
  )

  return {
    fields,
    box: item.box,
    wordsFrom: item.marker,
    wordsTo: end,
    tokens: [...inline, ...trailing],
  }
}

/** The fields of a task line, or null for a line that is not one. */
export function readTask(line: string): TaskFields | null {
  return parseTask(line)?.fields ?? null
}
