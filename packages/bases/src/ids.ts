/** Unique ids for the rows of a base: `BUG-45`, Notion's ID property, kept in a front
 *  matter key the base names (`nib.id: { property: id, prefix: BUG }`).
 *
 *  The next id is one more than the highest the rows hold, so an id is never handed out
 *  twice while its row exists. Two devices offline can both make 45; whoever looks
 *  first after the second sync renumbers one of them (`idRepairs`), always the younger
 *  row, so both devices pick the same one and the older row keeps the id people may
 *  already have written down. Pure. */

import type { Row, Value } from './types'

/** How a number is written with its prefix. */
export function idText(prefix: string, number: number): string {
  return prefix ? `${prefix}-${number}` : String(number)
}

/** The number an id holds, where it is one of this prefix's. */
export function idNumber(value: Value | undefined, prefix: string): number | null {
  if (typeof value === 'number') return !prefix && Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const pattern = prefix
    ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
    : /^(\d+)$/
  const found = pattern.exec(value.trim())
  return found?.[1] ? Number(found[1]) : null
}

/** The next free id: one past the highest of these rows. */
export function nextId(rows: readonly Row[], property: string, prefix: string): string {
  let highest = 0
  for (const row of rows) {
    if (row.kind !== 'note') continue
    const number = idNumber(row.note[property], prefix)
    if (number !== null && number > highest) highest = number
  }
  return idText(prefix, highest + 1)
}

/** Older first: created earlier, then by path, so every device orders them alike. */
const older = (a: Row, b: Row) => a.file.ctime - b.file.ctime || a.path.localeCompare(b.path)

/** The ids to write so that every row has one and no two share one: a row without
 *  one gets the next, in the order the rows were made, and of two rows sharing one
 *  the younger gets the next. `missing` false leaves rows without one alone, which is
 *  what looking does; turning ids on gives every row one. */
export function idRepairs(
  rows: readonly Row[],
  property: string,
  prefix: string,
  missing = true,
): { row: Row; id: string }[] {
  const notes = rows.filter((row) => row.kind === 'note').sort(older)
  let next = idNumber(nextId(notes, property, prefix), prefix) ?? 1
  const seen = new Set<number>()
  const out: { row: Row; id: string }[] = []
  for (const row of notes) {
    const number = idNumber(row.note[property], prefix)
    if (number !== null && !seen.has(number)) {
      seen.add(number)
      continue
    }
    if (number === null && !missing) continue
    out.push({ row, id: idText(prefix, next++) })
  }
  return out
}
