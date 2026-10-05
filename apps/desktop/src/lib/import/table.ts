/** A table of rows: an Airtable CSV, and every database in a Notion export.
 *
 *  A table is the one import with a real choice in it, because the same file is
 *  honestly two things. A recipe list is a table: forty rows of four columns,
 *  and what somebody wants is to see it. A reading list where every row has a
 *  page of notes behind it is forty notes, and a table of their titles is worse
 *  than useless.
 *
 *  Nothing in the file says which, so the sheet asks, once, with the answer that
 *  is right more often already chosen: a table. The other answer is one note per
 *  row, with the row's columns as its properties, which is the shape a Notion
 *  database row already had - and a `.base` beside their folder showing them as a
 *  table again, so what came in as a database is one (docs/tasks.md 4, "import CSV
 *  as a base"). */

import { key } from '../i18n.svelte'
import { recordsOf } from './csv'
import { type Base, writeBase } from '@nib/bases'
import { dayOf, noteText, type Meta, propertyName } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** What a table becomes. */
export type Rows = 'table' | 'notes'

/** The columns that are a date rather than a word, by the names the two
 *  exporters give them. */
const DATES = /^(created|created time|created at|date|last edited time|last modified|updated)$/i

/** The column a row is named after, when it is not simply the first one. */
const TITLES = /^(name|title|task|subject)$/i

export async function readTable(
  sources: readonly Source[],
  rows: Rows = 'table',
): Promise<ImportPlan> {
  const names = new Names()
  const files: Planned[] = []
  const lost: Lost[] = []

  for (const source of sources) {
    if (!/\.csv$/i.test(source.path)) continue

    const stem = safeName(
      (source.path.split('/').pop() ?? source.path).replace(/\.csv$/i, '').replace(/_all$/i, ''),
    )
    const table = recordsOf(await source.text())
    if (!table.columns.length) continue

    if (rows === 'table') {
      files.push({
        kind: 'note',
        path: names.free(`${stem}.md`),
        text: noteText(stem, tableOf(table.columns, table.rows)),
      })
      continue
    }

    // A folder of the table's name, so forty notes do not land loose in the
    // space and the table itself is still one thing in the file list.
    const folder = names.free(stem)
    for (const row of table.rows) {
      const note = rowNote(table.columns, row)
      files.push({
        kind: 'note',
        path: names.free(`${folder}/${note.name}.md`),
        text: note.text,
      })
    }
    files.push({
      kind: 'note',
      path: names.free(`${stem}.base`),
      text: baseOf(folder, table.columns, table.rows),
    })
  }

  if (!files.length) {
    lost.push({ text: key('There are no rows in this file.') })
  }

  return { format: 'table', files, lost }
}

/** The rows as a markdown table. Wide tables are left wide: a table somebody
 *  exported is the shape they made it, and a note scrolls sideways. */
export function tableOf(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const head = `| ${columns.map(cell).join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((one) => cell(row[one] ?? '')).join(' | ')} |`)

  return [head, rule, ...body].join('\n')
}

/** One cell, safe to put between two pipes: a pipe of its own is escaped, and the
 *  newlines in a paragraph somebody typed into a spreadsheet become spaces,
 *  because a markdown table has no way to hold a line break. */
function cell(value: string): string {
  return value
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/** One row as a note: its columns are its properties, and the column it is named
 *  after is its title. A column holding a paragraph becomes the note's words
 *  instead of a property, since that is what it is. */
export function rowNote(
  columns: readonly string[],
  row: Record<string, string>,
): { name: string; text: string } {
  const titleColumn = columns.find((one) => TITLES.test(one)) ?? columns[0] ?? ''
  const name = safeName(row[titleColumn]?.split('\n')[0] ?? '') || 'Untitled'

  const meta: Meta = {}
  const extra: [string, string][] = []
  const words: string[] = []

  for (const column of columns) {
    const value = (row[column] ?? '').trim()
    if (!value || column === titleColumn) continue

    if (DATES.test(column)) {
      const day = dayOf(value)
      if (day) {
        if (/created|^date$/i.test(column)) meta.date ??= day
        else meta.updated ??= day
        continue
      }
    }

    // Anything with a line in it is prose, and prose in front matter is a
    // property nobody can read.
    if (value.includes('\n')) {
      words.push(`## ${column}\n\n${value}`)
      continue
    }

    extra.push([column, value])
  }

  if (extra.length) meta.extra = extra

  return { name, text: noteText(name, words.join('\n\n'), meta) }
}

/** The base over a folder of row notes: a table of them, the columns in the file's
 *  order under the names the notes write them with. The folder is matched by its name
 *  wherever the import is put, since the plan does not know where that is. */
function baseOf(
  folder: string,
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const title = columns.find((one) => TITLES.test(one)) ?? columns[0] ?? ''
  const order = columns
    .filter((one) => one !== title && !rows.some((row) => (row[one] ?? '').includes('\n')))
    .map((one) =>
      DATES.test(one) ? (/created|^date$/i.test(one) ? 'date' : 'updated') : propertyName(one),
    )
  const base: Base = {
    filters: {
      or: [
        `file.folder == ${JSON.stringify(folder)}`,
        `file.folder.endsWith(${JSON.stringify(`/${folder}`)})`,
      ],
    },
    formulas: {},
    properties: {},
    summaries: {},
    views: [
      {
        type: 'table',
        name: 'Table',
        order: ['file.name', ...new Set(order.map((one) => `note.${one}`))],
        sort: [],
        summaries: {},
        nib: { kept: {} },
        options: {},
      },
    ],
    nib: { properties: {}, kept: {} },
    kept: {},
  }
  return writeBase(base)
}
