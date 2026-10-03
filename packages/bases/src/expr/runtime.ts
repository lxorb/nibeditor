/** What an expression works with while it runs, and the rules every operator and
 *  method shares: what is true, what is equal, what comes first, what a value says
 *  as words.
 *
 *  Beyond the values a property can hold (types.ts), an expression meets a file
 *  (`file`, `this`, `link.asFile()`), the note's properties as a whole (`note`),
 *  a task (`task`), a regular expression, and the things a view draws rather than
 *  reads (`image()`, `icon()`, `html()`). Those are classes here, so a check of
 *  which one a value is cannot be fooled by a property that happens to hold an
 *  object with the same keys. */

import { addMonths, dateAt, dayNumber, msOf, readDate } from '../dates'
import { BasesError } from '../errors'
import type {
  Context,
  DateValue,
  DurationValue,
  LinkValue,
  RenderedValue,
  Row,
  Value,
  ValueRecord,
} from '../types'

/** A file an expression holds: `file`, `this.file`, `link.asFile()`. */
export class FileRef {
  constructor(readonly row: Row) {}
}

/** `note`: the front matter of the row, readable by `note.key` and `note["a key"]`. */
export class NoteRef {
  constructor(readonly row: Row) {}
}

/** `this`: the embedding note. Its `file` is a file, anything else a property. */
export class ThisRef {
  constructor(readonly row: Row) {}
}

/** `task`: a task row's fields. */
export class TaskRef {
  constructor(readonly row: Row) {}
}

/** `image()`, `icon()`, `html()`: values a view draws. */
export class Rendered {
  constructor(readonly value: RenderedValue) {}
}

export type Val = Value | FileRef | NoteRef | ThisRef | TaskRef | Rendered | RegExp

/** Where an expression runs: the row, the context, and the names a list method
 *  binds (`value`, `index`, `acc`) or a summary does (`values`). */
export interface Scope {
  row: Row | null
  context: Context
  locals: Record<string, Val> | null
  /** The formula of this name on this row, evaluated once. */
  formula: (name: string, row: Row) => Val
}

export function isDate(value: Val): value is DateValue {
  return isRecordLike(value) && value.kind === 'date' && typeof value.iso === 'string'
}

export function isDuration(value: Val): value is DurationValue {
  return isRecordLike(value) && value.kind === 'duration' && typeof value.ms === 'number'
}

export function isLink(value: Val): value is LinkValue {
  return isRecordLike(value) && value.kind === 'link' && typeof value.target === 'string'
}

function isRecordLike(value: Val): value is ValueRecord {
  // A value a property holds is a plain object; every class an expression makes
  // (a file, a pattern, a list) has a prototype of its own. One check, asked of
  // every date in every comparison of every row.
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** A plain object property, the dates, durations and links that are objects too
 *  aside. */
export function isObject(value: Val): value is ValueRecord {
  return isRecordLike(value) && !isDate(value) && !isDuration(value) && !isLink(value)
}

/** The file a value stands for: a file, `this`, or a link that resolves to one. */
export function fileOf(value: Val, scope: Scope): Row | null {
  if (value instanceof FileRef || value instanceof ThisRef) return value.row
  if (isLink(value) || typeof value === 'string') {
    const target = typeof value === 'string' ? value : value.target
    const from = scope.row ?? scope.context.this
    if (!from) return null
    const path = scope.context.resolve?.(target, from)
    return path ? (scope.context.row?.(path, from.space) ?? null) : null
  }
  return null
}

/** A link target or a path, as two of them are compared when nothing resolves
 *  them: case aside, `.md` aside, `[[` and `]]` aside. */
export function plainTarget(target: string): string {
  return target
    .replace(/^!?\[\[|\]\]$/g, '')
    .replace(/[|#].*$/, '')
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase()
}

/** Whether a link target written in `from` points at the file at `path`. */
export function pointsAt(
  target: string,
  path: string,
  from: Row | null,
  context: Context,
): boolean {
  if (from && context.resolve) {
    const resolved = context.resolve(target, from)
    if (resolved !== null) return resolved === path
  }
  const wanted = plainTarget(target)
  const have = plainTarget(path)
  if (wanted === have) return true
  return !wanted.includes('/') && have.slice(have.lastIndexOf('/') + 1) === wanted
}

/** Bases' truth: nothing, false, zero, an empty string and an empty list are false. */
export function truthy(value: Val): boolean {
  if (value === null || value === false || value === 0 || value === '') return false
  if (typeof value === 'number') return !Number.isNaN(value)
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** The path a file-like value is at, for comparing it with a link. */
function pathOf(value: Val): string | null {
  return value instanceof FileRef || value instanceof ThisRef ? value.row.path : null
}

/** `==`: the same value, dates by their moment, links by the file they point at. */
export function equal(a: Val, b: Val, scope: Scope): boolean {
  if (a === b) return true
  if (a === null || b === null) return false

  const pathA = pathOf(a)
  const pathB = pathOf(b)
  if (pathA !== null && pathB !== null) return pathA === pathB
  if (pathA !== null && (isLink(b) || typeof b === 'string')) {
    return pointsAt(typeof b === 'string' ? b : b.target, pathA, scope.row, scope.context)
  }
  if (pathB !== null) return equal(b, a, scope)

  if (isLink(a) || isLink(b)) {
    const textA = isLink(a) ? a.target : typeof a === 'string' ? a : null
    const textB = isLink(b) ? b.target : typeof b === 'string' ? b : null
    if (textA === null || textB === null) return false
    if (isLink(a) && isLink(b) && scope.row && scope.context.resolve) {
      const resolvedA = scope.context.resolve(textA, scope.row)
      const resolvedB = scope.context.resolve(textB, scope.row)
      if (resolvedA !== null && resolvedB !== null) return resolvedA === resolvedB
    }
    return plainTarget(textA) === plainTarget(textB)
  }

  const dateA = asDate(a)
  const dateB = asDate(b)
  if (dateA && dateB && (isDate(a) || isDate(b))) return msOf(dateA) === msOf(dateB)
  if (isDuration(a) && isDuration(b)) return a.ms === b.ms && a.months === b.months
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((one, at) => equal(one, b[at] ?? null, scope))
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => equal(fieldOf(a, key), fieldOf(b, key), scope))
    )
  }
  if (a instanceof RegExp && b instanceof RegExp)
    return a.source === b.source && a.flags === b.flags
  return false
}

/** A date, or a string that reads as one. */
export function asDate(value: Val): DateValue | null {
  if (isDate(value)) return value
  if (typeof value === 'string') return readDate(value)
  return null
}

/** `<` and the rest: numbers, strings, dates, durations; null for two values that
 *  do not compare, which makes every comparison false, as in Bases. */
export function compare(a: Val, b: Val): number | null {
  if (a === null || b === null) return null
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (isDate(a) || isDate(b)) {
    const dateA = asDate(a)
    const dateB = asDate(b)
    if (dateA && dateB) return msOf(dateA) - msOf(dateB)
    if (typeof a === 'number' && dateB) return a - msOf(dateB)
    if (dateA && typeof b === 'number') return msOf(dateA) - b
    return null
  }
  if (isDuration(a) || isDuration(b)) {
    const msA = durationMs(a)
    const msB = durationMs(b)
    return msA === null || msB === null ? null : msA - msB
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (isLink(a) && isLink(b)) return compare(text(a), text(b))
  return null
}

/** A duration, or a number of milliseconds, as milliseconds; months counted as
 *  thirty days, which is only ever asked when comparing. */
function durationMs(value: Val): number | null {
  if (typeof value === 'number') return value
  if (isDuration(value)) return value.ms + value.months * 30 * 86_400_000
  return null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The rank of each kind of value in a sort, so a column of mixed values still
 *  sorts the same way every time. Nothing sorts last. */
function sortRank(value: Val): number {
  if (typeof value === 'boolean') return 0
  if (typeof value === 'number') return 1
  if (isDate(value)) return 2
  if (isDuration(value)) return 3
  if (typeof value === 'string' || isLink(value)) return 4
  return 5
}

/** A total order for sorting: kinds apart, then by value, words as people read
 *  them (`file 2` before `file 10`), nothing at the end either way round. */
export function sortCompare(a: Val, b: Val): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const rankA = sortRank(a)
  const rankB = sortRank(b)
  if (rankA !== rankB) return rankA - rankB
  if (rankA === 4) return collator.compare(text(a), text(b))
  if (rankA === 5) return collator.compare(text(a), text(b))
  return compare(a, b) ?? 0
}

/** A value as words: what a cell shows, what `+` joins to a string, `toString()`. */
export function text(value: Val): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.map(text).join(', ')
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`
  if (value instanceof FileRef || value instanceof ThisRef) return value.row.file.path
  if (value instanceof NoteRef || value instanceof TaskRef) return ''
  if (value instanceof Rendered) {
    const shown = value.value
    return shown.kind === 'image' ? shown.src : shown.kind === 'icon' ? shown.name : shown.html
  }
  if (isDate(value)) return value.time ? `${value.iso} ${value.time}` : value.iso
  if (isDuration(value)) return durationText(value)
  if (isLink(value)) return value.display ?? value.target
  return JSON.stringify(value)
}

function durationText(value: DurationValue): string {
  const parts: string[] = []
  if (value.months)
    parts.push(value.months % 12 === 0 ? `${value.months / 12}y` : `${value.months}M`)
  let rest = Math.abs(value.ms)
  const sign = value.ms < 0 ? '-' : ''
  for (const [unit, size] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ] as const) {
    const count = Math.floor(rest / size)
    if (count) parts.push(`${sign}${count}${unit}`)
    rest -= count * size
  }
  return parts.length ? parts.join(' ') : '0s'
}

/** The units a duration is written in, Bases' table: `y`, `M`, `w`, `d`, `h`, `m`,
 *  `s`, and their words. One letter is case-sensitive (`M` months, `m` minutes);
 *  a word is not. */
const UNITS: Record<string, { ms: number; months: number }> = {
  y: { ms: 0, months: 12 },
  year: { ms: 0, months: 12 },
  years: { ms: 0, months: 12 },
  M: { ms: 0, months: 1 },
  month: { ms: 0, months: 1 },
  months: { ms: 0, months: 1 },
  w: { ms: 604_800_000, months: 0 },
  week: { ms: 604_800_000, months: 0 },
  weeks: { ms: 604_800_000, months: 0 },
  d: { ms: 86_400_000, months: 0 },
  day: { ms: 86_400_000, months: 0 },
  days: { ms: 86_400_000, months: 0 },
  h: { ms: 3_600_000, months: 0 },
  hour: { ms: 3_600_000, months: 0 },
  hours: { ms: 3_600_000, months: 0 },
  m: { ms: 60_000, months: 0 },
  minute: { ms: 60_000, months: 0 },
  minutes: { ms: 60_000, months: 0 },
  s: { ms: 1000, months: 0 },
  second: { ms: 1000, months: 0 },
  seconds: { ms: 1000, months: 0 },
  ms: { ms: 1, months: 0 },
}

/** `"1d"`, `"2 weeks"`, `"1M 4h"`, `"-3d"`: a duration, or null for words that are
 *  not one. */
export function readDuration(written: string): DurationValue | null {
  const source = written.trim()
  if (source === '') return null
  const sign = source.startsWith('-') ? -1 : 1
  const body = source.replace(/^[+-]\s*/, '')
  const pattern = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*,?\s*/y
  let ms = 0
  let months = 0
  let at = 0
  while (at < body.length) {
    pattern.lastIndex = at
    const found = pattern.exec(body)
    if (!found) return null
    const word = found[2] ?? ''
    const unit = UNITS[word] ?? (word.length > 1 ? UNITS[word.toLowerCase()] : undefined)
    if (!unit) return null
    const count = Number(found[1])
    ms += count * unit.ms
    months += count * unit.months
    at = pattern.lastIndex
  }
  return { kind: 'duration', ms: sign * ms, months: sign * months }
}

/** A duration, or words that are one. */
function asDuration(value: Val): DurationValue | null {
  if (isDuration(value)) return value
  if (typeof value === 'string') return readDuration(value)
  return null
}

/** A date moved by a duration: the months first, the way Moment adds them, then
 *  the rest. A date with no time stays one when the rest is whole days. */
function shifted(date: DateValue, by: DurationValue, sign: 1 | -1): DateValue {
  const moved: DateValue = {
    ...date,
    iso: by.months ? addMonths(date.iso, sign * by.months) : date.iso,
  }
  if (by.ms === 0) return moved
  const wholeDays = by.ms % 86_400_000 === 0
  if (!date.time && wholeDays) {
    return {
      kind: 'date',
      iso: dateAt((dayNumber(moved.iso) + (sign * by.ms) / 86_400_000) * 86_400_000, true).iso,
    }
  }
  const result = dateAt(msOf(moved) + sign * by.ms)
  return date.zone ? { ...result, zone: date.zone } : result
}

/** `+`. */
export function add(a: Val, b: Val): Val {
  if (typeof a === 'number' && typeof b === 'number') return a + b
  if (isDate(a)) {
    const by = asDuration(b)
    if (by) return shifted(a, by, 1)
  }
  if (isDate(b) && isDuration(a)) return shifted(b, a, 1)
  if (isDuration(a) && isDuration(b))
    return { kind: 'duration', ms: a.ms + b.ms, months: a.months + b.months }
  if (typeof a === 'string' || typeof b === 'string') return text(a) + text(b)
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b] as Value[]
  if (a === null || b === null) return null
  throw new BasesError(`Cannot add ${kindName(b)} to ${kindName(a)}`)
}

/** `-`. Two dates apart are a duration. */
export function subtract(a: Val, b: Val): Val {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (isDate(a)) {
    const other = asDate(b)
    if (other && (isDate(b) || !asDuration(b))) {
      return { kind: 'duration', ms: msOf(a) - msOf(other), months: 0 }
    }
    const by = asDuration(b)
    if (by) return shifted(a, by, -1)
    if (typeof b === 'number') return dateAt(msOf(a) - b)
  }
  if (isDuration(a) && isDuration(b))
    return { kind: 'duration', ms: a.ms - b.ms, months: a.months - b.months }
  if (a === null || b === null) return null
  throw new BasesError(`Cannot subtract ${kindName(b)} from ${kindName(a)}`)
}

/** `*`, `/` and `%`. A duration may be on the left of a number, as Bases says. */
export function arithmetic(op: '*' | '/' | '%', a: Val, b: Val): Val {
  if (a === null || b === null) return null
  if (typeof a === 'number' && typeof b === 'number') {
    return op === '*' ? a * b : op === '/' ? a / b : a % b
  }
  if (isDuration(a) && typeof b === 'number' && op !== '%') {
    const scale = op === '*' ? b : 1 / b
    return { kind: 'duration', ms: a.ms * scale, months: Math.round(a.months * scale) }
  }
  if (isDuration(a) && isDuration(b) && op === '/') {
    return (durationMs(a) ?? 0) / (durationMs(b) ?? 1)
  }
  throw new BasesError(`Cannot use ${op} on ${kindName(a)} and ${kindName(b)}`)
}

/** What kind a value is, in the words `isType()` takes. */
export function kindName(value: Val): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'list'
  if (value instanceof RegExp) return 'regexp'
  if (value instanceof FileRef || value instanceof ThisRef) return 'file'
  if (value instanceof NoteRef || value instanceof TaskRef) return 'object'
  if (value instanceof Rendered) return value.value.kind
  if (isDate(value)) return 'date'
  if (isDuration(value)) return 'duration'
  if (isLink(value)) return 'link'
  return 'object'
}

/** A value an expression made, as a value a cell holds: files become links to
 *  themselves, the drawn ones their own kind, a note's properties an object. */
export function settled(value: Val): Value {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(settled)
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`
  if (value instanceof FileRef || value instanceof ThisRef)
    return { kind: 'link', target: value.row.path }
  if (value instanceof NoteRef) return value.row.note
  if (value instanceof TaskRef) return value.row.task ? { text: value.row.task.text } : null
  if (value instanceof Rendered) return value.value
  return value
}

/** A field of a plain object property. `isObject` has already told an object from
 *  the drawn values, which TypeScript narrows in alongside it because their shapes
 *  fit an index signature too. */
export function fieldOf(object: ValueRecord | RenderedValue, name: string): Val {
  return Object.hasOwn(object, name) ? ((object as ValueRecord)[name] ?? null) : null
}
