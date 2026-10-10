/** A Notion database, as a base over its rows.
 *
 *  Notion's own table is a view over pages, each row a page with its properties
 *  on it. nib's is the same thing: a base whose rows are notes and whose columns
 *  are their front matter (docs/tasks.md 2.3). So the CSV Notion wrote is read for
 *  two things only - the order the columns stood in, and what each column held -
 *  and the table itself is a ` ```base ` fence in the database's folder note, over
 *  the notes in the folder beside it. A row edited in nib is the note edited, and
 *  the table follows, which a markdown table in the folder note never would.
 *
 *  What a column held is not in the export: Notion writes every value out as
 *  words. It is judged from every row of the column at once, because one row's
 *  `12` is a number or a code, and forty rows of numbers are numbers. */

import { type Base, type PropertyConfig, writeBase } from '@nib/bases'
import { recordsOf } from './csv'
import type { Property } from './meta'
import { safeName, withoutNotionId } from './names'

/** What a column holds, as far as its words say. */
export type Kind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'pages'

export interface Database {
  columns: string[]
  rows: Record<string, string>[]
  /** What each column holds, judged from all of its rows. */
  kinds: Map<string, Kind>
}

/** A plain number the way Notion writes one with no format on it. A leading zero
 *  is a code, a phone number or a postcode, and stays words. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

const CHECKBOX = /^(yes|no)$/i

/** `October 10, 2026`, with `3:00 PM` or `15:00` after it when the date has a
 *  time, and the zone it was set in after that when it has one of its own. */
const NOTION_DATE =
  /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2})(?: ?([AP]M))?)?(?: \(GMT[+-]\d{1,2}(?::\d{2})?\))?$/i

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** A relation: `Plan (Projects%20abc/Plan%20def.md)`, one per page, after a
 *  comma. The path is written escaped, so it holds no spaces and no brackets. */
const PAGE = / \(([^()\s]+\.md)\)(?:, |$)/g

/** A label of a multi-select: short, and not a sentence. */
const LABEL = /^[^.!?\n]{1,40}$/

export function databaseOf(text: string): Database {
  const { columns, rows } = recordsOf(text)
  const kinds = new Map<string, Kind>()
  for (const column of columns.slice(1)) {
    kinds.set(column, kindOf(rows.map((row) => row[column] ?? '')))
  }

  return { columns, rows, kinds }
}

/** What a column holds: the one kind every value in it can be read as. A list
 *  is the last guess and the most careful one, because a comma is also in half
 *  the sentences anybody types: it takes a label that comes back in another row,
 *  which is what an option of a multi-select does. */
export function kindOf(values: readonly string[]): Kind {
  const said = values.map((one) => one.trim()).filter(Boolean)
  if (!said.length) return 'text'

  if (said.every((one) => CHECKBOX.test(one))) return 'checkbox'
  if (said.every((one) => NUMBER.test(one))) return 'number'
  if (said.every((one) => notionDate(one) !== null)) return 'date'
  if (said.every((one) => pagesIn(one) !== null)) return 'pages'

  const labels = said.map((one) => one.split(',').map((label) => label.trim()))
  const listed =
    said.some((one) => one.includes(',')) &&
    labels.every((one) => one.every((label) => LABEL.test(label)))
  if (listed) {
    const seen = new Set<string>()
    for (const label of labels.flatMap((one) => [...new Set(one)])) {
      if (seen.has(label)) return 'list'
      seen.add(label)
    }
  }

  return 'text'
}

/** A value as what its column holds. Words that do not read as that after all
 *  stay the words they were, so nothing in a row is lost to a guess. */
export function valueAs(kind: Kind, value: string): Property {
  switch (kind) {
    case 'checkbox':
      return CHECKBOX.test(value) ? /^yes$/i.test(value) : value
    case 'number':
      return NUMBER.test(value) ? Number(value) : value
    case 'date':
      return notionDate(value) ?? value
    case 'pages':
      return pagesIn(value)?.map((name) => `[[${name}]]`) ?? value
    case 'list':
      return value
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
    case 'text':
      return value
  }
}

/** The day, or the day and the minute, a Notion date says, in ISO. Null for a
 *  range and for anything that is not a date. */
export function notionDate(value: string): string | null {
  if (ISO_DATE.test(value)) return value

  const found = NOTION_DATE.exec(value)
  if (!found) return null

  const month = MONTHS.indexOf((found[1] ?? '').toLowerCase()) + 1
  const day = Number(found[2])
  const year = Number(found[3])
  if (!month || day < 1 || day > 31) return null

  const date = `${year}-${two(month)}-${two(day)}`
  if (found[4] === undefined) return date

  let hour = Number(found[4])
  const half = found[6]?.toUpperCase()
  if (half === 'PM' && hour < 12) hour += 12
  if (half === 'AM' && hour === 12) hour = 0
  if (hour > 23) return null

  return `${date}T${two(hour)}:${found[5] ?? '00'}`
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** The names of the pages a relation points at, as their notes are named once
 *  the ids are off. Null for anything that is not a relation. */
export function pagesIn(value: string): string[] | null {
  const names: string[] = []
  let at = 0

  for (const found of value.matchAll(PAGE)) {
    // Every relation is a title and a path, one after another, and nothing else
    // in between: anything left over is words that happen to hold brackets.
    const title = value.slice(at, found.index)
    if (!title.trim()) return null
    names.push(nameOf(found[1] ?? ''))
    at = found.index + found[0].length
  }

  return names.length && at === value.length ? names : null
}

/** A page's note name, out of the path Notion linked it by. */
function nameOf(path: string): string {
  const last = path.split('/').pop() ?? path
  let name = last
  try {
    name = decodeURIComponent(last)
  } catch {
    // A stray percent sign is a character of the name.
  }
  return safeName(withoutNotionId(name).replace(/\.md$/i, ''))
}

/** The folder note's words: the table, as a base over the notes in the folder of
 *  the same name. `this` is the note the fence stands in (docs/tasks.md 5.11), so
 *  the base keeps pointing at its rows when the database is renamed or moved, and
 *  Obsidian reads it the same way.
 *
 *  The columns stand in the order Notion had them, under Notion's names, with the
 *  key `keyOf` gives each in a row's front matter. */
export function baseBlock(database: Database, keyOf: (column: string) => string): string {
  const [title, ...rest] = database.columns
  const keys: string[] = []
  const properties: Record<string, PropertyConfig> = {}

  if (title && title !== 'Name') properties['file.name'] = { displayName: title, kept: {} }

  for (const column of rest) {
    const key = keyOf(column)
    if (!key || keys.includes(key)) continue
    keys.push(key)
    if (key !== column) properties[`note.${key}`] = { displayName: column, kept: {} }
  }

  const base: Base = {
    filters: { and: ['file.folder + ".md" == this.file.path'] },
    formulas: {},
    properties,
    summaries: {},
    views: [
      {
        type: 'table',
        name: 'Table',
        order: ['file.name', ...keys.map((one) => `note.${one}`)],
        sort: [],
        summaries: {},
        nib: { kept: {} },
        options: {},
      },
    ],
    nib: { properties: {}, kept: {} },
    kept: {},
  }

  return `\`\`\`base\n${writeBase(base).trimEnd()}\n\`\`\``
}
