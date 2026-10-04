/** A view's filter as rows to click, and the rows back into Bases' filter: Notion's
 *  filter builder over Obsidian's YAML (docs/tasks.md 4, "filter builder without
 *  typing").
 *
 *  A row is a property, an operator and a value, and becomes one expression. The rows
 *  are joined by the view's `and` or `or`; whatever the builder cannot show as a row
 *  (a formula somebody wrote, a group inside a group) is kept as it was written and
 *  shown as its words, so opening the builder never loses a filter. Pure. */

import type { Filter } from '@nib/bases'

export type Operator =
  '==' | '!=' | '<' | '>' | '<=' | '>=' | 'contains' | 'empty' | 'filled' | 'tag'
export const OPERATORS: readonly Operator[] = [
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  'contains',
  'empty',
  'filled',
  'tag',
]

export type FilterRow =
  | { property: string; op: Operator; value: string }
  /** An expression or a group the builder keeps as written. */
  | { kept: Filter }

export interface FilterRows {
  join: 'and' | 'or'
  rows: FilterRow[]
}

/** Whether an operator takes a value. */
export const takesValue = (op: Operator): boolean => op !== 'empty' && op !== 'filled'

const PROPERTY = /^[A-Za-z_][\w.]*$/

/** A value as the literal an expression writes: a number as itself, `true` and
 *  `false`, a day as `date("…")`, a call (`today()`) as itself, and words quoted. */
export function literal(value: string): string {
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  if (trimmed === 'true' || trimmed === 'false') return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `date(${JSON.stringify(trimmed)})`
  if (/^(today|now)\(\)(\s*[+-]\s*"[^"]*")?$/.test(trimmed)) return trimmed
  return JSON.stringify(value)
}

/** A literal read back into what the field shows. */
function unliteral(written: string): string | null {
  const trimmed = written.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || trimmed === 'true' || trimmed === 'false') return trimmed
  const dated = /^date\(("(?:[^"\\]|\\.)*")\)$/.exec(trimmed)
  if (dated?.[1]) return String(JSON.parse(dated[1]))
  if (/^(today|now)\(\)/.test(trimmed)) return trimmed
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return String(JSON.parse(trimmed))
  return null
}

/** One row as the expression it stands for. */
export function expressionOf(row: { property: string; op: Operator; value: string }): string {
  const { property, op, value } = row
  switch (op) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return `${property} ${op} ${literal(value)}`
    case 'empty':
      return `!${property}`
    case 'filled':
      return property
    case 'contains':
      return `${property}.contains(${literal(value)})`
    case 'tag':
      return property.startsWith('task.')
        ? `task.hasTag(${JSON.stringify(value.replace(/^#/, ''))})`
        : `file.hasTag(${JSON.stringify(value.replace(/^#/, ''))})`
  }
}

/** One expression as a row, where the builder can show it as one. */
export function rowOf(expression: string): FilterRow {
  const text = expression.trim()

  const tag = /^(file|task)\.hasTag\(("(?:[^"\\]|\\.)*")\)$/.exec(text)
  if (tag?.[2]) {
    return { property: `${tag[1] ?? 'file'}.tags`, op: 'tag', value: String(JSON.parse(tag[2])) }
  }

  const contains = /^([A-Za-z_][\w.]*)\.contains\((.+)\)$/.exec(text)
  if (contains?.[1] && contains[2]) {
    const value = unliteral(contains[2])
    if (value !== null) return { property: contains[1], op: 'contains', value }
  }

  const compared = /^([A-Za-z_][\w.]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(text)
  const op = OPERATORS.find((one) => one === compared?.[2])
  if (compared?.[1] && compared[3] && op) {
    const value = unliteral(compared[3])
    if (value !== null) return { property: compared[1], op, value }
  }

  if (text.startsWith('!') && PROPERTY.test(text.slice(1))) {
    return { property: text.slice(1), op: 'empty', value: '' }
  }
  if (PROPERTY.test(text) && text.includes('.')) return { property: text, op: 'filled', value: '' }
  return { kept: expression }
}

/** A view's filter as rows: its top level's `and` or `or`, one row per member. */
export function rowsOf(filter: Filter | undefined): FilterRows {
  if (filter === undefined) return { join: 'and', rows: [] }
  if (typeof filter === 'string') return { join: 'and', rows: [rowOf(filter)] }
  if ('and' in filter) return { join: 'and', rows: filter.and.map(memberRow) }
  if ('or' in filter) return { join: 'or', rows: filter.or.map(memberRow) }
  return { join: 'and', rows: [{ kept: filter }] }
}

const memberRow = (member: Filter): FilterRow =>
  typeof member === 'string' ? rowOf(member) : { kept: member }

/** The rows back as a filter: nothing for no rows, the one for one, else the join. */
export function filterOf(rows: FilterRows): Filter | undefined {
  const members = rows.rows.map((row): Filter => ('kept' in row ? row.kept : expressionOf(row)))
  if (!members.length) return undefined
  if (members.length === 1 && rows.join === 'and') return members[0]
  return rows.join === 'and' ? { and: members } : { or: members }
}
