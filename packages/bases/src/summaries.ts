/** The summary under a column: Bases' defaults by name (Average, Min, Max, Sum,
 *  Range, Median, Stddev, Earliest, Latest, Checked, Unchecked, Empty, Filled,
 *  Unique), or a base's own formula over `values`. */

import { msOf } from './dates'
import { compile, scopeFor } from './expr/compile'
import { asDate, equal, settled, type Scope, sortCompare, type Val } from './expr/runtime'
import { BasesError } from './errors'
import type { Context, DateValue, Value } from './types'

/** The names Bases ships, which a view's `summaries` refers to by name. */
export const DEFAULT_SUMMARIES = [
  'Average',
  'Min',
  'Max',
  'Sum',
  'Range',
  'Median',
  'Stddev',
  'Earliest',
  'Latest',
  'Checked',
  'Unchecked',
  'Empty',
  'Filled',
  'Unique',
] as const

const isEmptyValue = (value: Val) =>
  value === null || value === '' || (Array.isArray(value) && value.length === 0)

const numbers = (values: readonly Val[]) =>
  values.filter((one): one is number => typeof one === 'number')

function dates(values: readonly Val[]): DateValue[] {
  return values
    .map((one) => (typeof one === 'number' ? null : asDate(one)))
    .filter((one) => one !== null)
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function defaultSummary(name: string, values: readonly Val[], scope: Scope): Value | undefined {
  const all = numbers(values)
  const sum = all.reduce((total, one) => total + one, 0)
  switch (name) {
    case 'Average':
      return all.length ? sum / all.length : null
    case 'Sum':
      return sum
    case 'Min':
      return all.length ? Math.min(...all) : null
    case 'Max':
      return all.length ? Math.max(...all) : null
    case 'Median':
      return median(all)
    case 'Stddev': {
      if (!all.length) return null
      const mean = sum / all.length
      return Math.sqrt(all.reduce((total, one) => total + (one - mean) ** 2, 0) / all.length)
    }
    case 'Range': {
      const days = dates(values)
      if (!all.length && days.length) {
        const sorted = days.map(msOf).sort((a, b) => a - b)
        return { kind: 'duration', ms: (sorted.at(-1) ?? 0) - (sorted[0] ?? 0), months: 0 }
      }
      return all.length ? Math.max(...all) - Math.min(...all) : null
    }
    case 'Earliest':
    case 'Latest': {
      const sorted = dates(values).sort(sortCompare)
      return (name === 'Earliest' ? sorted[0] : sorted.at(-1)) ?? null
    }
    case 'Checked':
      return values.filter((one) => one === true).length
    case 'Unchecked':
      return values.filter((one) => one === false).length
    case 'Empty':
      return values.filter(isEmptyValue).length
    case 'Filled':
      return values.filter((one) => !isEmptyValue(one)).length
    case 'Unique': {
      const seen: Val[] = []
      for (const one of values) if (!seen.some((other) => equal(other, one, scope))) seen.push(one)
      return seen.length
    }
    default:
      return undefined
  }
}

/** A column's summary: a default by name, else the base's own formula of that
 *  name over `values`. Null where the formula fails or the name is nobody's. */
export function summarize(
  name: string,
  values: readonly Val[],
  custom: Record<string, string>,
  context: Context,
): Value {
  const scope = scopeFor(null, context)
  const known = defaultSummary(name, values, scope)
  if (known !== undefined) return known

  const source = custom[name]
  if (source === undefined) return null
  try {
    return settled(compile(source).run({ ...scope, locals: { values: [...values] as Value[] } }))
  } catch (error) {
    if (error instanceof BasesError) return null
    throw error
  }
}
