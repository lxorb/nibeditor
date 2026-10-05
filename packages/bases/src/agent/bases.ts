/** `add_row`, `edit_rows` and `edit_base` in their pure half: a new note made where a
 *  base would show it, front matter written on a note, and a base changed as the YAML
 *  it is written in, every key nobody named kept (docs/tasks.md 5.15).
 *
 *  Obsidian files a new card in the vault's root whatever the base's filter says, which
 *  is the complaint about it (2.3). Here a new row goes where the filter looks: the
 *  folder `file.inFolder()` names, the tags `file.hasTag()` names and the values a
 *  `prop == "value"` names, so the row it makes is a row of the view it was made from. */

import { writeList, writeProperty } from '@nib/markdown/property-edits'
import { readFilter } from '../filter'
import type { Base, Filter, Sort, View } from '../types'
import { AgentError } from './tasks'

type Args = Record<string, unknown>

const isRecord = (value: unknown): value is Args =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The front matter keys a value can be written under. */
const KEY = /^[\w-][\w -]*$/

/** The note's words with each property set, or taken away where it is null. A list is
 *  written as one, a number and a yes or no bare, everything else as words. */
export function withProperties(text: string, properties: Args): string {
  let after = text
  for (const [key, value] of Object.entries(properties)) {
    if (!KEY.test(key)) throw new AgentError('bad_arguments', `${key} is not a property name`)
    const edit = Array.isArray(value)
      ? writeList(
          after,
          key,
          value.map((one) => String(one)),
        )
      : value === null
        ? writeProperty(after, key, null)
        : typeof value === 'boolean'
          ? writeProperty(after, key, String(value), 'checkbox')
          : typeof value === 'number'
            ? writeProperty(after, key, String(value), 'number')
            : typeof value === 'string'
              ? writeProperty(after, key, value)
              : undefined
    if (edit === undefined)
      throw new AgentError(
        'bad_arguments',
        `${key} is words, a number, true or false, a list, or null`,
      )
    if (edit) after = after.slice(0, edit.from) + edit.insert + after.slice(edit.to)
  }
  return after
}

/** The expressions every row of a view must satisfy: the base's and the view's, and
 *  each side of an `and`, never an `or` or a `not`. */
function required(filter: Filter | undefined): string[] {
  if (filter === undefined) return []
  if (typeof filter === 'string') return [filter]
  return 'and' in filter ? filter.and.flatMap(required) : []
}

const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'`
const IN_FOLDER = new RegExp(String.raw`^\s*file\.inFolder\(\s*(?:${QUOTED})\s*\)\s*$`)
const FOLDER_IS = new RegExp(String.raw`^\s*file\.folder\s*==\s*(?:${QUOTED})\s*$`)
const HAS_TAG = new RegExp(String.raw`^\s*file\.hasTag\(\s*(?:${QUOTED})\s*\)\s*$`)
const EQUALS = new RegExp(
  String.raw`^\s*(?:note\.)?([A-Za-z_][\w-]*)\s*==\s*(?:${QUOTED}|(true|false|-?\d+(?:\.\d+)?))\s*$`,
)

/** Where a new row of a base goes and what it says, by its filters: the folder, the
 *  tags and the values a row has to have to be shown. */
export function rowPlace(base: Base, view?: string): { folder?: string; properties: Args } {
  const chosen = view === undefined ? base.views[0] : base.views.find((one) => one.name === view)
  const properties: Args = {}
  const tags: string[] = []
  let folder: string | undefined

  for (const expression of [...required(base.filters), ...required(chosen?.filters)]) {
    const inFolder = IN_FOLDER.exec(expression) ?? FOLDER_IS.exec(expression)
    if (inFolder) {
      folder = (inFolder[1] ?? inFolder[2] ?? '').replace(/^\/+|\/+$/g, '')
      continue
    }
    const tag = HAS_TAG.exec(expression)
    if (tag) {
      tags.push((tag[1] ?? tag[2] ?? '').replace(/^#/, ''))
      continue
    }
    const equal = EQUALS.exec(expression)
    if (equal?.[1] && !equal[1].startsWith('file') && !equal[1].startsWith('task')) {
      const literal = equal[4]
      properties[equal[1]] =
        literal === undefined
          ? (equal[2] ?? equal[3] ?? '')
          : literal === 'true' || literal === 'false'
            ? literal === 'true'
            : Number(literal)
    }
  }
  if (tags.length) properties.tags = tags
  return { ...(folder === undefined ? {} : { folder }), properties }
}

/** A note's name out of a title: what a file name may hold, at most 120 characters. */
export function noteName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return name.replace(/\.+$/, '') || 'Untitled'
}

// ---- edit_base -------------------------------------------------------------------------

function words(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new AgentError('bad_arguments', `say ${name}`)
  return value.trim()
}

function sortsOf(value: unknown): Sort[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.map((one) => {
    if (typeof one === 'string') return { property: one, direction: 'ASC' }
    if (!isRecord(one) || typeof one.property !== 'string') {
      throw new AgentError('bad_arguments', 'a sort is {property, direction: ASC or DESC}')
    }
    return {
      property: one.property,
      direction: String(one.direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
    }
  })
}

function filterOf(value: unknown): Filter {
  const filter = readFilter(value)
  if (filter === null)
    throw new AgentError('bad_arguments', 'a filter is an expression, or {and|or|not: [filters]}')
  return filter
}

/** A view's keys as an op says them, onto a view. */
function viewWith(view: View, said: Args): View {
  const next: View = { ...view, nib: { ...view.nib } }
  if (said.type !== undefined) next.type = words(said.type, 'type')
  if (said.name !== undefined) next.name = words(said.name, 'name')
  if (said.filters !== undefined) {
    if (said.filters === null) delete next.filters
    else next.filters = filterOf(said.filters)
  }
  if (said.order !== undefined) {
    if (!Array.isArray(said.order) || !said.order.every((one) => typeof one === 'string')) {
      throw new AgentError('bad_arguments', 'order is a list of properties')
    }
    next.order = said.order
  }
  if (said.sort !== undefined) next.sort = sortsOf(said.sort)
  if (said.groupBy !== undefined) {
    if (said.groupBy === null) delete next.groupBy
    else {
      const [group] = sortsOf(said.groupBy)
      if (group) next.groupBy = group
    }
  }
  if (said.limit !== undefined) {
    if (said.limit === null) delete next.limit
    else if (typeof said.limit === 'number' && said.limit > 0) next.limit = Math.floor(said.limit)
    else throw new AgentError('bad_arguments', 'limit is a number')
  }
  if (said.rows !== undefined) {
    if (said.rows !== 'notes' && said.rows !== 'tasks' && said.rows !== 'both') {
      throw new AgentError('bad_arguments', 'rows is notes, tasks or both')
    }
    next.nib.rows = said.rows
  }
  return next
}

/** The view an op names, by name, or the first where it names none. */
function named(base: Base, said: Args): number {
  if (said.view === undefined && said.name === undefined) return 0
  const name = typeof said.view === 'string' ? said.view : said.name
  const at = base.views.findIndex((one) => one.name === name)
  if (at === -1) throw new AgentError('not_found', `there is no view called ${String(name)}`)
  return at
}

/** The base with each op made, in order. Answers a new Base, never the one handed in. */
export function editedBase(base: Base, ops: unknown): Base {
  if (!Array.isArray(ops) || !ops.length)
    throw new AgentError('bad_arguments', 'ops is a list of edits')
  let next: Base = {
    ...base,
    views: [...base.views],
    formulas: { ...base.formulas },
    properties: { ...base.properties },
  }

  for (const raw of ops) {
    if (!isRecord(raw)) throw new AgentError('bad_arguments', 'an op is an object with op')
    switch (raw.op) {
      case 'add_view': {
        const blank: View = {
          type: 'table',
          name: '',
          order: [],
          sort: [],
          summaries: {},
          nib: { kept: {} },
          options: {},
        }
        const view = viewWith(blank, raw)
        if (!view.name) throw new AgentError('bad_arguments', "say the new view's name")
        if (next.views.some((one) => one.name === view.name)) {
          throw new AgentError('bad_arguments', `there is a view called ${view.name} already`)
        }
        next.views.push(view)
        break
      }
      case 'edit_view': {
        const at = named(next, { view: raw.view ?? raw.name })
        const view = next.views[at]
        if (view)
          next.views[at] = viewWith(view, {
            ...raw,
            name: raw.view === undefined ? undefined : raw.name,
          })
        break
      }
      case 'remove_view': {
        const at = named(next, raw)
        next.views.splice(at, 1)
        break
      }
      case 'set_filter': {
        if (raw.view === undefined) {
          next = { ...next }
          if (raw.filter === null) delete next.filters
          else next.filters = filterOf(raw.filter)
        } else {
          const at = named(next, raw)
          const view = next.views[at]
          if (view) next.views[at] = viewWith(view, { filters: raw.filter })
        }
        break
      }
      case 'add_formula':
        next.formulas[words(raw.name, 'name')] = words(raw.formula, 'formula')
        break
      case 'add_property': {
        const name = words(raw.name, 'name')
        const displayName = typeof raw.displayName === 'string' ? raw.displayName : undefined
        next.properties[name] = {
          ...(next.properties[name] ?? { kept: {} }),
          ...(displayName ? { displayName } : {}),
        }
        break
      }
      default:
        throw new AgentError(
          'bad_arguments',
          'op is add_view, edit_view, remove_view, set_filter, add_formula or add_property',
        )
    }
  }
  return next
}
