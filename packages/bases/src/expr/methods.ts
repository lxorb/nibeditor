/** `value.method(...)`: every method of Bases' functions page, by the type of the
 *  value it is called on, and the few a list needs for summaries and rollups
 *  (`sum`, `mean`, `median`, `stddev`, `min`, `max`).
 *
 *  Arguments arrive unevaluated, as thunks, because `filter`, `map` and `reduce`
 *  run theirs once per item with `value`, `index` and `acc` bound. Every other
 *  method evaluates its arguments once, up front. */

import { formatDate, msOf, readDate, relative } from '../dates'
import { BasesError } from '../errors'
import type { DateValue, Row, Value } from '../types'
import {
  equal,
  FileRef,
  fileOf,
  isDate,
  isLink,
  isObject,
  kindName,
  NoteRef,
  plainTarget,
  pointsAt,
  type Scope,
  sortCompare,
  TaskRef,
  text,
  ThisRef,
  truthy,
  type Val,
} from './runtime'

/** An argument not yet evaluated; list methods bind names for each item. */
export type Arg = (locals?: Record<string, Val>) => Val

const evaluated = (args: readonly Arg[]) => args.map((arg) => arg())

const number = (value: Val, method: string): number => {
  if (typeof value !== 'number') throw new BasesError(`${method}() takes a number`)
  return value
}

/** `isTruthy`, `isType` and `toString`, which every value has. */
function anyMethod(receiver: Val, name: string, args: readonly Arg[]): { value: Val } | null {
  switch (name) {
    case 'isTruthy':
      return { value: truthy(receiver) }
    case 'isType': {
      const wanted = text(args[0]?.() ?? null).toLowerCase()
      const kind = kindName(receiver)
      return { value: kind === wanted || (wanted === 'file' && kind === 'file') }
    }
    case 'toString':
      return { value: text(receiver) }
    default:
      return null
  }
}

/** A tag as compared: `#` off, case aside. */
const tagKey = (tag: string) => tag.replace(/^#/, '').toLowerCase()

/** Whether a set of tags holds one of these, nested tags counted: `#work/nib` is
 *  under `work`. */
function hasTag(tags: readonly string[], wanted: readonly Val[]): boolean {
  const keys = tags.map(tagKey)
  return wanted.some((one) => {
    const key = tagKey(text(one))
    return keys.some((tag) => tag === key || tag.startsWith(`${key}/`))
  })
}

/** Whether the row's file links to what `other` stands for. */
function linksTo(row: Row, other: Val, scope: Scope): boolean {
  const target = fileOf(other, scope)
  if (target) return row.file.links.some((link) => pointsAt(link, target.path, row, scope.context))
  if (typeof other === 'string' || isLink(other)) {
    const wanted = plainTarget(typeof other === 'string' ? other : other.target)
    return row.file.links.some((link) => plainTarget(link) === wanted)
  }
  return false
}

function fileMethod(
  row: Row,
  name: string,
  args: readonly Arg[],
  scope: Scope,
): { value: Val } | null {
  switch (name) {
    case 'asLink': {
      const display = args[0]?.()
      return {
        value:
          display === undefined || display === null
            ? { kind: 'link', target: row.file.path }
            : { kind: 'link', target: row.file.path, display: text(display) },
      }
    }
    case 'hasLink':
      return { value: linksTo(row, args[0]?.() ?? null, scope) }
    case 'hasProperty':
      return { value: text(args[0]?.() ?? null) in row.note }
    case 'hasTag':
      return { value: hasTag(row.file.tags, evaluated(args)) }
    case 'inFolder': {
      const folder = text(args[0]?.() ?? null).replace(/^\/+|\/+$/g, '')
      const own = row.file.folder
      return { value: folder === '' || own === folder || own.startsWith(`${folder}/`) }
    }
    default:
      return null
  }
}

function stringMethod(value: string, name: string, args: readonly Arg[]): { value: Val } | null {
  const all = () => evaluated(args).map(text)
  switch (name) {
    case 'contains':
      return { value: value.includes(text(args[0]?.() ?? null)) }
    case 'containsAll':
      return { value: all().every((one) => value.includes(one)) }
    case 'containsAny':
      return { value: all().some((one) => value.includes(one)) }
    case 'startsWith':
      return { value: value.startsWith(text(args[0]?.() ?? null)) }
    case 'endsWith':
      return { value: value.endsWith(text(args[0]?.() ?? null)) }
    case 'isEmpty':
      return { value: value.length === 0 }
    case 'lower':
      return { value: value.toLowerCase() }
    case 'upper':
      return { value: value.toUpperCase() }
    case 'title':
      return {
        value: value.replace(
          /(^|\s)(\p{L})/gu,
          (_, gap: string, letter: string) => gap + letter.toUpperCase(),
        ),
      }
    case 'trim':
      return { value: value.trim() }
    case 'reverse':
      return { value: Array.from(value).reverse().join('') }
    case 'repeat':
      return { value: value.repeat(Math.max(0, number(args[0]?.() ?? null, 'repeat'))) }
    case 'slice': {
      const [start, end] = evaluated(args)
      return {
        value: value.slice(
          number(start ?? 0, 'slice'),
          end == null ? undefined : number(end, 'slice'),
        ),
      }
    }
    case 'replace': {
      const [pattern = null, replacement = null] = evaluated(args)
      const by = text(replacement)
      if (pattern instanceof RegExp)
        return { value: value.replace(new RegExp(pattern.source, pattern.flags), by) }
      return { value: value.replaceAll(text(pattern), () => by) }
    }
    case 'split': {
      const [separator = null, limit] = evaluated(args)
      const parts = value.split(separator instanceof RegExp ? separator : text(separator))
      return { value: limit == null ? parts : parts.slice(0, number(limit, 'split')) }
    }
    default:
      return null
  }
}

function numberMethod(value: number, name: string, args: readonly Arg[]): { value: Val } | null {
  switch (name) {
    case 'abs':
      return { value: Math.abs(value) }
    case 'ceil':
      return { value: Math.ceil(value) }
    case 'floor':
      return { value: Math.floor(value) }
    case 'round': {
      const digits = args[0] ? number(args[0](), 'round') : 0
      const scale = 10 ** digits
      return { value: Math.round(value * scale) / scale }
    }
    case 'toFixed':
      return { value: value.toFixed(number(args[0]?.() ?? 0, 'toFixed')) }
    case 'isEmpty':
      return { value: false }
    default:
      return null
  }
}

/** The numbers of a list, the rest left out. */
const numbersOf = (list: readonly Val[]) =>
  list.filter((one): one is number => typeof one === 'number')

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function listMethod(
  list: readonly Val[],
  name: string,
  args: readonly Arg[],
  scope: Scope,
): { value: Val } | null {
  const has = (wanted: Val) => list.some((one) => equal(one, wanted, scope))
  switch (name) {
    case 'contains':
      return { value: has(args[0]?.() ?? null) }
    case 'containsAll':
      return { value: evaluated(args).every(has) }
    case 'containsAny':
      return { value: evaluated(args).some(has) }
    case 'isEmpty':
      return { value: list.length === 0 }
    case 'filter': {
      const keep = args[0]
      if (!keep) throw new BasesError('filter() takes an expression')
      return { value: list.filter((value, index) => truthy(keep({ value, index }))) as Value[] }
    }
    case 'map': {
      const each = args[0]
      if (!each) throw new BasesError('map() takes an expression')
      return { value: list.map((value, index) => each({ value, index })) as Value[] }
    }
    case 'reduce': {
      const step = args[0]
      if (!step) throw new BasesError('reduce() takes an expression')
      let acc = args[1]?.() ?? null
      list.forEach((value, index) => {
        acc = step({ value, index, acc })
      })
      return { value: acc }
    }
    case 'flat':
      return { value: flattened(list) }
    case 'join':
      return { value: list.map(text).join(text(args[0]?.() ?? ',')) }
    case 'reverse':
      return { value: [...list].reverse() as Value[] }
    case 'sort':
      return { value: [...list].sort(sortCompare) as Value[] }
    case 'unique':
      return {
        value: list.filter(
          (one, at) => list.findIndex((other) => equal(one, other, scope)) === at,
        ) as Value[],
      }
    case 'slice': {
      const [start, end] = evaluated(args)
      return {
        value: list.slice(
          number(start ?? 0, 'slice'),
          end == null ? undefined : number(end, 'slice'),
        ) as Value[],
      }
    }
    case 'sum':
      return { value: numbersOf(list).reduce((sum, one) => sum + one, 0) }
    case 'mean':
    case 'average': {
      const values = numbersOf(list)
      return {
        value: values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : null,
      }
    }
    case 'median':
      return { value: median(numbersOf(list)) }
    case 'stddev': {
      const values = numbersOf(list)
      if (!values.length) return { value: null }
      const mean = values.reduce((sum, one) => sum + one, 0) / values.length
      return {
        value: Math.sqrt(values.reduce((sum, one) => sum + (one - mean) ** 2, 0) / values.length),
      }
    }
    case 'min':
    case 'max': {
      const present = list.filter((one) => one !== null)
      if (!present.length) return { value: null }
      const sorted = [...present].sort(sortCompare)
      return { value: (name === 'min' ? sorted[0] : sorted.at(-1)) ?? null }
    }
    default:
      return null
  }
}

function dateMethod(
  date: DateValue,
  name: string,
  args: readonly Arg[],
  scope: Scope,
): { value: Val } | null {
  switch (name) {
    case 'date':
      return { value: { kind: 'date', iso: date.iso } }
    case 'format':
      return { value: formatDate(date, text(args[0]?.() ?? 'YYYY-MM-DD')) }
    case 'time':
      return { value: formatDate(date, 'HH:mm:ss') }
    case 'relative': {
      const now = readDate(scope.context.now) ?? { kind: 'date', iso: scope.context.today }
      return { value: relative(msOf(date), msOf(now)) }
    }
    case 'isEmpty':
      return { value: false }
    default:
      return null
  }
}

function objectMethod(object: Record<string, Value>, name: string): { value: Val } | null {
  switch (name) {
    case 'isEmpty':
      return { value: Object.keys(object).length === 0 }
    case 'keys':
      return { value: Object.keys(object) }
    case 'values':
      return { value: Object.values(object) }
    default:
      return null
  }
}

/** Calls `name` on `receiver`. Null is forgiving, as a missing property is common:
 *  `isEmpty()` is true of it and every other method answers null. */
export function callMethod(receiver: Val, name: string, args: readonly Arg[], scope: Scope): Val {
  const any = anyMethod(receiver, name, args)
  if (any) return any.value
  if (receiver === null) return name === 'isEmpty' ? true : null

  let found: { value: Val } | null = null
  if (receiver instanceof FileRef || receiver instanceof ThisRef) {
    found = fileMethod(receiver.row, name, args, scope)
  } else if (receiver instanceof TaskRef) {
    found =
      name === 'hasTag' ? { value: hasTag(receiver.row.task?.tags ?? [], evaluated(args)) } : null
  } else if (receiver instanceof NoteRef) {
    found = objectMethod(receiver.row.note, name)
  } else if (receiver instanceof RegExp) {
    if (name === 'matches') {
      const pattern = new RegExp(receiver.source, receiver.flags.replace('g', ''))
      found = { value: pattern.test(text(args[0]?.() ?? null)) }
    }
  } else if (typeof receiver === 'string') {
    found = stringMethod(receiver, name, args)
  } else if (typeof receiver === 'number') {
    found = numberMethod(receiver, name, args)
  } else if (Array.isArray(receiver)) {
    found = listMethod(receiver, name, args, scope)
  } else if (isDate(receiver)) {
    found = dateMethod(receiver, name, args, scope)
  } else if (isLink(receiver)) {
    if (name === 'asFile') {
      const row = fileOf(receiver, scope)
      found = { value: row ? new FileRef(row) : null }
    } else if (name === 'linksTo') {
      const row = fileOf(receiver, scope)
      found = { value: row ? linksTo(row, args[0]?.() ?? null, scope) : false }
    } else {
      found = stringMethod(receiver.target, name, args)
    }
  } else if (isObject(receiver)) {
    found = objectMethod(receiver, name)
  }

  if (!found) throw new BasesError(`${kindName(receiver)} has no ${name}()`)
  return found.value
}

/** A list with every list inside it opened, to any depth. */
function flattened(list: readonly Val[]): Value[] {
  const out: Value[] = []
  for (const one of list) {
    if (Array.isArray(one)) out.push(...flattened(one))
    else out.push(one as Value)
  }
  return out
}
