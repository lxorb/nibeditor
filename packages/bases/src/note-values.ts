/** A note's front matter as values, and a task's words as the hash its anchor
 *  carries: the two things the rows store asks of the engine for every file it
 *  reads.
 *
 *  The front matter is read the cheap way first, by the properties reader the
 *  Properties panel already uses (`@nib/markdown/properties`), which is a regex
 *  per line. Only a block that reader will not draw (a comment in it, a nested
 *  list, a shape it cannot name) is handed to a real YAML parser, so five thousand
 *  ordinary notes cost five thousand small regex passes and the odd note still
 *  gets its values. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { type Property, readProperties } from '@nib/markdown/properties'
import { parse } from 'yaml'
import type { Value } from './types'

/** `[[target]]`, `[[target|display]]`, `![[target]]`, as a property holds one. */
const WIKILINK = /^!?\[\[([^\]|#]*(?:#[^\]|]*)?)(?:\|([^\]]*))?\]\]$/

/** A date, a date with a time, as YAML and Obsidian write them. */
const DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** A scalar written in front matter, as the value it means. */
export function scalarValue(written: string): Value {
  const text = written.trim()
  if (text === '' || text === 'null' || text === '~') return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)

  const link = WIKILINK.exec(text)
  if (link) {
    const target = (link[1] ?? '').trim()
    return link[2] === undefined
      ? { kind: 'link', target }
      : { kind: 'link', target, display: link[2] }
  }

  const date = DATE.exec(text)
  if (date?.[1]) {
    const value: Value = { kind: 'date', iso: date[1] }
    if (date[2]) value.time = date[2]
    if (date[3]) value.zone = date[3] === 'Z' ? 'UTC' : date[3]
    return value
  }
  return text
}

/** A row of the properties reader as a value. */
function propertyValue(property: Property): Value {
  switch (property.kind) {
    case 'list':
      return property.items.map(scalarValue)
    case 'map':
      return Object.fromEntries(
        property.items.map((item) => {
          const at = item.indexOf(':')
          return [item.slice(0, at).trim(), scalarValue(item.slice(at + 1))]
        }),
      )
    case 'text':
    case 'number':
    case 'date':
    case 'checkbox':
      return scalarValue(property.value)
  }
}

/** What a YAML parser answered, as values: strings read the way a scalar is, so a
 *  link and a date mean the same whichever reader met them. */
function fromYaml(read: unknown): Value {
  if (read === null || read === undefined) return null
  if (typeof read === 'string') return scalarValue(read)
  if (typeof read === 'number' || typeof read === 'boolean') return read
  if (Array.isArray(read)) return read.map(fromYaml)
  if (typeof read === 'object') {
    return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
  }
  return null
}

/** A note's front matter as values by key, or nothing for a note without any or
 *  with a block that is not YAML. Takes the note, or the block's lines alone
 *  without their fences, which is what the scan carries. */
export function noteValues(text: string): Record<string, Value> {
  const source = text.startsWith('---')
    ? text
    : `---\n${text}${text.endsWith('\n') ? '' : '\n'}---\n`
  const rows = readProperties(source)
  if (rows) return Object.fromEntries(rows.map((row) => [row.key, propertyValue(row)]))

  const block = frontMatterBlock(source)
  if (!block) return {}
  try {
    // The core schema reads a timestamp as the string it is written as, which the
    // scalar reader then takes for a date the way the fast path does.
    const read: unknown = parse(source.slice(block.body.from, block.body.to), { schema: 'core' })
    if (read === null || typeof read !== 'object' || Array.isArray(read)) return {}
    return Object.fromEntries(Object.entries(read).map(([key, value]) => [key, fromYaml(value)]))
  } catch {
    // A block that is not YAML holds no values; the note is still a row.
    return {}
  }
}

export { taskHash } from './task-hash'
