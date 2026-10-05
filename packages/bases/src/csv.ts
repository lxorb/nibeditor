/** A view's answer as CSV, the shape every spreadsheet opens (docs/tasks.md 4, "copy as
 *  CSV, save as CSV").
 *
 *  RFC 4180: a cell with a comma, a quote or a line in it is quoted, its quotes
 *  doubled, lines ending in CRLF. Values are written the way a spreadsheet reads
 *  them rather than the way a view says them: a day as `2026-10-06`, not "Tomorrow";
 *  a link as its name; a list as its members with a comma between. Pure. */

import { isDate, isLink, text } from './expr/runtime'
import type { Value } from './types'

/** One value as the words of a cell. */
export function csvValue(value: Value): string {
  if (value === null) return ''
  if (Array.isArray(value)) return value.map(csvValue).filter(Boolean).join(', ')
  if (isLink(value)) {
    return value.display ?? (value.target.split('/').pop() ?? value.target).replace(/\.md$/i, '')
  }
  if (isDate(value)) {
    return value.time ? `${value.iso} ${value.time.slice(0, 5)}` : value.iso
  }
  return text(value)
}

const quoted = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)

/** A header and rows of cells as one CSV file. */
export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((row) => row.map(quoted).join(',')).join('\r\n') + '\r\n'
}
