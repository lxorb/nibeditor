/** A property's choices (`nib.properties.<key>.options`), Notion's select and status:
 *  each a value, a tone and, for a status, which of To do, Doing and Done it belongs
 *  to. And the two writes a choice brings about in the notes: a value renamed in every
 *  note that holds it, and a base's ids written again under a new prefix. Pure but for
 *  the rows handed in. */

import { type Base, idNumber, idText, type Row, type SelectOption, type Value } from '@nib/bases'
import type { RowChange } from '../rows/write'
import { bare } from './columns'

/** The words a value holds, a list member by member. */
function wordsIn(value: Value | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(wordsIn)
  return []
}

/** The values a property holds across these rows, in the order they first appear: the
 *  choices a text column turned into a select starts with. */
export function valuesOf(rows: readonly Row[], property: string, most = 50): string[] {
  const key = bare(property)
  const seen: string[] = []
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const one of wordsIn(row.note[key])) {
      if (!seen.includes(one)) seen.push(one)
      if (seen.length >= most) return seen
    }
  }
  return seen
}

/** The six tones in the order a new choice takes them. */
const TONES = ['1', '2', '3', '4', '5', '6']

/** Choices for these values, each in the next tone. */
export function optionsFor(values: readonly string[]): SelectOption[] {
  return values.map((value, at) => ({ value, tone: TONES[at % TONES.length] ?? '1' }))
}

/** The options a base gives a property. */
export function optionsAt(base: Base, property: string): SelectOption[] {
  return base.nib.properties[bare(property)]?.options ?? []
}

/** The change that renames one value in a row, a list's member where it is a list;
 *  null where the row does not hold it. */
export function renamedIn(row: Row, property: string, from: string, to: string): RowChange | null {
  const key = bare(property)
  const value = row.note[key]
  if (Array.isArray(value)) {
    if (!value.some((one) => wordsIn(one).includes(from))) return null
    return { note: { [key]: value.map((one) => (wordsIn(one).includes(from) ? to : one)) } }
  }
  return wordsIn(value).includes(from) ? { note: { [key]: to } } : null
}

/** The changes that write a base's ids again under a new prefix. */
export function reprefixed(
  rows: readonly Row[],
  property: string,
  from: string,
  to: string,
): { row: Row; change: RowChange }[] {
  return rows.flatMap((row) => {
    const number = idNumber(row.note[property], from)
    return number === null ? [] : [{ row, change: { note: { [property]: idText(to, number) } } }]
  })
}
