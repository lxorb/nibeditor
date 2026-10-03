/** The global functions of Bases' functions page: `if`, `now`, `today`, `date`,
 *  `duration`, `number`, `list`, `link`, `file`, `image`, `icon`, `html`,
 *  `escapeHTML`, `max`, `min`, `random`. */

import { msOf, readDate } from '../dates'
import { BasesError } from '../errors'
import type { Value } from '../types'
import type { Arg } from './methods'
import {
  FileRef,
  fileOf,
  isDate,
  isDuration,
  isLink,
  readDuration,
  Rendered,
  type Scope,
  sortCompare,
  text,
  ThisRef,
  truthy,
  type Val,
} from './runtime'

const ESCAPED: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** `[[target|display]]` or a path, as a link's target. */
function linkTarget(value: Val): string {
  if (value instanceof FileRef || value instanceof ThisRef) return value.row.file.path
  if (isLink(value)) return value.target
  return text(value)
    .replace(/^!?\[\[|\]\]$/g, '')
    .replace(/\|.*$/, '')
}

/** Whether a global of this name exists, so `file` alone is the row's file and
 *  `file(...)` is the function. */
export const GLOBALS = new Set([
  'if',
  'now',
  'today',
  'date',
  'duration',
  'number',
  'list',
  'link',
  'file',
  'image',
  'icon',
  'html',
  'escapeHTML',
  'max',
  'min',
  'random',
])

export function callGlobal(name: string, args: readonly Arg[], scope: Scope): Val {
  const first = () => args[0]?.() ?? null
  switch (name) {
    case 'if':
      return truthy(first()) ? (args[1]?.() ?? null) : (args[2]?.() ?? null)
    case 'now':
      return readDate(scope.context.now) ?? { kind: 'date', iso: scope.context.today }
    case 'today':
      return { kind: 'date', iso: scope.context.today }
    case 'date': {
      const value = first()
      if (value === null || isDate(value)) return value
      return readDate(text(value).trim())
    }
    case 'duration': {
      const value = first()
      if (isDuration(value)) return value
      const read = readDuration(text(value))
      if (!read) throw new BasesError(`"${text(value)}" is not a duration`)
      return read
    }
    case 'number': {
      const value = first()
      if (typeof value === 'number') return value
      if (typeof value === 'boolean') return value ? 1 : 0
      if (isDate(value)) return msOf(value)
      if (isDuration(value)) return value.ms
      const read = Number(text(value).trim())
      if (text(value).trim() === '' || Number.isNaN(read)) {
        throw new BasesError(`"${text(value)}" is not a number`)
      }
      return read
    }
    case 'list': {
      const value = first()
      if (Array.isArray(value)) return value
      return value === null ? [] : ([value] as Value[])
    }
    case 'link': {
      const target = linkTarget(first())
      const display = args[1]?.()
      return display === undefined || display === null
        ? { kind: 'link', target }
        : { kind: 'link', target, display: text(display) }
    }
    case 'file': {
      const value = first()
      if (value instanceof FileRef) return value
      const row = fileOf(isLink(value) ? value : linkTarget(value), scope)
      return row ? new FileRef(row) : null
    }
    case 'image':
      return new Rendered({ kind: 'image', src: linkTarget(first()) })
    case 'icon':
      return new Rendered({ kind: 'icon', name: text(first()) })
    case 'html':
      return new Rendered({ kind: 'html', html: text(first()) })
    case 'escapeHTML':
      return text(first()).replace(/[&<>"']/g, (char) => ESCAPED[char] ?? char)
    case 'max':
    case 'min': {
      const values = args.map((arg) => arg()).filter((one) => one !== null)
      if (!values.length) return null
      const sorted = values.sort(sortCompare)
      return (name === 'min' ? sorted[0] : sorted.at(-1)) ?? null
    }
    case 'random':
      return (scope.context.random ?? Math.random)()
    default:
      throw new BasesError(`There is no function ${name}()`)
  }
}
