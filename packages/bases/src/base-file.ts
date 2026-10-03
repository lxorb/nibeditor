/** A `.base` file read into a Base, and a Base written back into the file it came
 *  from.
 *
 *  Obsidian's format, whole: `filters`, `formulas`, `properties`, `summaries` and
 *  `views`, each view with its `type`, `name`, `filters`, `order`, `sort`,
 *  `groupBy`, `limit` and `summaries`, and whatever else a layout keeps (`image`,
 *  `cardSize`, `columnSize`, a map's `coordinates`). nib's additions are under one
 *  key, `nib:`, at the top and inside a view, which Obsidian leaves alone.
 *
 *  Writing is a merge into the file as it was, not a new file: the YAML is read as
 *  a document, every value the Base changed is set in place, and every key nobody
 *  changed keeps its order, its quotes and its comments. A Base that says what the
 *  file already says gives the file back byte for byte, so opening a base in nib
 *  and closing it again never shows up as a change in Obsidian or in sync. */

import { isMap, isScalar, isSeq, type Document, parseDocument } from 'yaml'
import { BasesError } from './errors'
import { readFilter } from './filter'
import type {
  Base,
  NibBase,
  NibProperty,
  NibView,
  PropertyConfig,
  RowKinds,
  SelectOption,
  Sort,
  View,
} from './types'

type Plain = Record<string, unknown>

/** A scalar written in YAML as text; a map or a list where a word belongs is nothing. */
const scalar = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''

const isPlain = (value: unknown): value is Plain =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stringsOf = (value: unknown): Record<string, string> =>
  isPlain(value)
    ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, scalar(one)]))
    : {}

/** Everything in an object but the keys named. */
function rest(value: Plain, known: readonly string[]): Plain {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)))
}

function readSort(raw: unknown): Sort | null {
  if (typeof raw === 'string') return { property: raw, direction: 'ASC' }
  if (!isPlain(raw) || typeof raw.property !== 'string') return null
  return {
    property: raw.property,
    direction: String(raw.direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
  }
}

const ROW_KINDS: readonly RowKinds[] = ['notes', 'tasks', 'both']

function readOptions(raw: unknown): SelectOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.flatMap((one): SelectOption[] => {
    if (typeof one === 'string' || typeof one === 'number') return [{ value: String(one) }]
    if (!isPlain(one) || one.value === undefined) return []
    const option: SelectOption = { value: scalar(one.value) }
    if (one.group === 'todo' || one.group === 'doing' || one.group === 'done')
      option.group = one.group
    if (typeof one.tone === 'string' || typeof one.tone === 'number') option.tone = String(one.tone)
    return [option]
  })
}

const NIB_VIEW_KEYS = [
  'rows',
  'subGroupBy',
  'order',
  'date',
  'end',
  'colour',
  'showCompleted',
  'groupOrder',
  'hidden',
  'locked',
]

function readNibView(raw: unknown): NibView {
  const nib: NibView = { kept: {} }
  if (!isPlain(raw)) return nib
  if (ROW_KINDS.includes(raw.rows as RowKinds)) nib.rows = raw.rows as RowKinds
  const sub = readSort(raw.subGroupBy)
  if (sub) nib.subGroupBy = sub
  if (isPlain(raw.order)) {
    nib.order = Object.fromEntries(
      Object.entries(raw.order).map(([key, list]) => [
        key,
        Array.isArray(list) ? list.map(String) : [],
      ]),
    )
  }
  if (typeof raw.date === 'string') nib.date = raw.date
  if (typeof raw.end === 'string') nib.end = raw.end
  if (typeof raw.colour === 'string') nib.colour = raw.colour
  if (typeof raw.showCompleted === 'boolean') nib.showCompleted = raw.showCompleted
  if (raw.groupOrder === 'rows' || raw.groupOrder === 'value') nib.groupOrder = raw.groupOrder
  if (Array.isArray(raw.hidden)) nib.hidden = raw.hidden.map(String)
  if (typeof raw.locked === 'boolean') nib.locked = raw.locked
  nib.kept = rest(raw, NIB_VIEW_KEYS)
  return nib
}

const VIEW_KEYS = [
  'type',
  'name',
  'filters',
  'order',
  'sort',
  'groupBy',
  'limit',
  'summaries',
  'nib',
]

function readView(raw: unknown, at: number): View {
  const plain = isPlain(raw) ? raw : {}
  const view: View = {
    type: typeof plain.type === 'string' ? plain.type : 'table',
    name: scalar(plain.name) || `View ${at + 1}`,
    order: Array.isArray(plain.order) ? plain.order.map(String) : [],
    sort: Array.isArray(plain.sort) ? plain.sort.map(readSort).filter((one) => one !== null) : [],
    summaries: stringsOf(plain.summaries),
    nib: readNibView(plain.nib),
    options: rest(plain, VIEW_KEYS),
  }
  const filters = readFilter(plain.filters)
  if (filters !== null) view.filters = filters
  const groupBy = readSort(plain.groupBy)
  if (groupBy) view.groupBy = groupBy
  if (typeof plain.limit === 'number' && plain.limit > 0) view.limit = plain.limit
  return view
}

function readNibProperty(raw: unknown): NibProperty {
  const plain = isPlain(raw) ? raw : {}
  const property: NibProperty = { kept: rest(plain, ['options', 'format', 'one']) }
  const options = readOptions(plain.options)
  if (options) property.options = options
  if (typeof plain.format === 'string') property.format = plain.format
  if (typeof plain.one === 'boolean') property.one = plain.one
  return property
}

function readNibBase(raw: unknown): NibBase {
  const plain = isPlain(raw) ? raw : {}
  const nib: NibBase = {
    properties: isPlain(plain.properties)
      ? Object.fromEntries(
          Object.entries(plain.properties).map(([key, one]) => [key, readNibProperty(one)]),
        )
      : {},
    kept: rest(plain, ['template', 'id', 'properties', 'locked']),
  }
  if (typeof plain.template === 'string') nib.template = plain.template
  if (isPlain(plain.id) && typeof plain.id.property === 'string') {
    nib.id = {
      property: plain.id.property,
      prefix: scalar(plain.id.prefix),
    }
  }
  if (typeof plain.locked === 'boolean') nib.locked = plain.locked
  return nib
}

const BASE_KEYS = ['filters', 'formulas', 'properties', 'summaries', 'views', 'nib']

/** The YAML a document holds, or a BasesError naming the first thing wrong. */
function documentOf(yaml: string): Document {
  const document = parseDocument(yaml)
  const [error] = document.errors
  if (error) throw new BasesError(error.message, error.pos[0])
  return document
}

/** A `.base` file, or the inside of a ` ```base ` fence, as a Base. */
export function readBase(yaml: string): Base {
  const read: unknown = yaml.trim() === '' ? {} : documentOf(yaml).toJS()
  const plain = isPlain(read) ? read : {}

  const base: Base = {
    formulas: stringsOf(plain.formulas),
    properties: isPlain(plain.properties)
      ? Object.fromEntries(
          Object.entries(plain.properties).map(([key, one]): [string, PropertyConfig] => {
            const config = isPlain(one) ? one : {}
            const property: PropertyConfig = { kept: rest(config, ['displayName']) }
            if (config.displayName != null) property.displayName = scalar(config.displayName)
            return [key, property]
          }),
        )
      : {},
    summaries: stringsOf(plain.summaries),
    views: Array.isArray(plain.views) ? plain.views.map(readView) : [],
    nib: readNibBase(plain.nib),
    kept: rest(plain, BASE_KEYS),
  }
  const filters = readFilter(plain.filters)
  if (filters !== null) base.filters = filters
  else if (plain.filters !== undefined) base.kept.filters = plain.filters
  return base
}

/** An object without the keys whose value says nothing. */
function present(entries: [string, unknown][]): Plain {
  return Object.fromEntries(
    entries.filter(([, value]) => {
      if (value === undefined) return false
      if (isPlain(value)) return Object.keys(value).length > 0
      if (Array.isArray(value)) return value.length > 0
      return true
    }),
  )
}

const sortPlain = (sort: Sort): Plain => ({ property: sort.property, direction: sort.direction })

function nibViewPlain(nib: NibView): Plain {
  return present([
    ['rows', nib.rows],
    ['subGroupBy', nib.subGroupBy && sortPlain(nib.subGroupBy)],
    ['order', nib.order],
    ['date', nib.date],
    ['end', nib.end],
    ['colour', nib.colour],
    ['showCompleted', nib.showCompleted],
    ['groupOrder', nib.groupOrder],
    ['hidden', nib.hidden],
    ['locked', nib.locked],
    ...Object.entries(nib.kept),
  ])
}

function viewPlain(view: View): Plain {
  return present([
    ['type', view.type],
    ['name', view.name],
    ['filters', view.filters],
    ['order', view.order],
    ['sort', view.sort.map(sortPlain)],
    ['groupBy', view.groupBy && sortPlain(view.groupBy)],
    ['limit', view.limit],
    ['summaries', view.summaries],
    ...Object.entries(view.options),
    ['nib', nibViewPlain(view.nib)],
  ])
}

function nibBasePlain(nib: NibBase): Plain {
  return present([
    ['template', nib.template],
    ['id', nib.id && { property: nib.id.property, prefix: nib.id.prefix }],
    [
      'properties',
      Object.fromEntries(
        Object.entries(nib.properties).map(([key, one]) => [
          key,
          present([
            ['options', one.options?.map((option) => present(Object.entries(option)))],
            ['format', one.format],
            ['one', one.one],
            ...Object.entries(one.kept),
          ]),
        ]),
      ),
    ],
    ['locked', nib.locked],
    ...Object.entries(nib.kept),
  ])
}

/** A Base as the plain object its YAML says, keys in Obsidian's order. */
function basePlain(base: Base): Plain {
  return present([
    ['filters', base.filters],
    ['formulas', base.formulas],
    [
      'properties',
      Object.fromEntries(
        Object.entries(base.properties).map(([key, one]) => [
          key,
          present([['displayName', one.displayName], ...Object.entries(one.kept)]),
        ]),
      ),
    ],
    ['summaries', base.summaries],
    ['views', base.views.map(viewPlain)],
    ...Object.entries(base.kept),
    ['nib', nibBasePlain(base.nib)],
  ])
}

/** A key of a pair, as text. */
function keyText(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key)
}

/** A value set into the document where a node was: the node kept and changed in
 *  place where it can be, so its quotes, its comments and its order stay. */
function merged(document: Document, node: unknown, value: unknown): unknown {
  if (isPlain(value) && isMap(node)) {
    for (const [key, one] of Object.entries(value)) {
      const pair = node.items.find((item) => keyText(item.key) === key)
      if (pair) pair.value = merged(document, pair.value, one)
      else node.items.push(document.createPair(key, one))
    }
    node.items = node.items.filter((pair) => keyText(pair.key) in value)
    return node
  }
  if (Array.isArray(value) && isSeq(node)) {
    value.forEach((one, at) => {
      node.items[at] =
        at < node.items.length ? merged(document, node.items[at], one) : document.createNode(one)
    })
    node.items.length = value.length
    return node
  }
  if (isScalar(node) && !isPlain(value) && !Array.isArray(value)) {
    if (node.value !== value) node.value = value
    return node
  }
  return document.createNode(value)
}

const OUTPUT = { lineWidth: 0, singleQuote: true } as const

/** The Base written into the file it was read from, every key it does not know and
 *  every key it did not change kept as written. With nothing before, a new file. */
export function writeBase(base: Base, before = ''): string {
  const plain = basePlain(base)
  let document: Document
  try {
    document = documentOf(before)
  } catch {
    // A file that is not YAML has nothing to keep; it is written anew.
    document = parseDocument('')
  }

  if (before.trim() !== '' && isMap(document.contents)) {
    if (JSON.stringify(basePlain(readBase(before))) === JSON.stringify(plain)) return before
    merged(document, document.contents, plain)
    return document.toString(OUTPUT)
  }

  document.contents = document.createNode(plain)
  return document.toString(OUTPUT)
}
