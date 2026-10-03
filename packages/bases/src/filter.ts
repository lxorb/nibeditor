/** Bases' filters: an expression, or `and`, `or` and `not` of filters to any depth,
 *  compiled to one test per row. `not` is "none of these are true", which is how
 *  Bases' own filter menu reads it. A row whose expression fails (a method on the
 *  wrong kind of value) is left out rather than stopping the view. */

import { compile } from './expr/compile'
import { BasesError } from './errors'
import { type Scope, truthy } from './expr/runtime'
import type { Context, Filter, Row } from './types'
import { scopeFor } from './expr/compile'

export interface CompiledFilter {
  test: (scope: Scope) => boolean
  /** Whether the test reads the row, today, now and `this` alone. */
  local: boolean
  /** Whether it reads the clock, not only the day. */
  clock: boolean
}

const ALWAYS: CompiledFilter = { test: () => true, local: true, clock: false }

function compileOne(filter: Filter): CompiledFilter {
  if (typeof filter === 'string') {
    const expression = compile(filter)
    return {
      local: expression.local,
      clock: expression.clock,
      test: (scope) => {
        try {
          return truthy(expression.run(scope))
        } catch (error) {
          if (error instanceof BasesError) return false
          throw error
        }
      },
    }
  }

  const [kind, members] =
    'and' in filter
      ? (['and', filter.and] as const)
      : 'or' in filter
        ? (['or', filter.or] as const)
        : (['not', filter.not] as const)
  const tests = members.map(compileOne)
  const local = tests.every((one) => one.local)
  const clock = tests.some((one) => one.clock)
  switch (kind) {
    case 'and':
      return { local, clock, test: (scope) => tests.every((one) => one.test(scope)) }
    case 'or':
      return { local, clock, test: (scope) => tests.some((one) => one.test(scope)) }
    case 'not':
      return { local, clock, test: (scope) => !tests.some((one) => one.test(scope)) }
  }
}

/** Several filters that must all hold: the base's and the view's. Throws a
 *  BasesError for an expression that does not parse. */
export function compileFilters(...filters: (Filter | undefined)[]): CompiledFilter {
  const present = filters.filter((one): one is Filter => one !== undefined)
  if (!present.length) return ALWAYS
  if (present.length === 1 && present[0] !== undefined) return compileOne(present[0])
  return compileOne({ and: present })
}

/** A filter as a test of one row, for a caller with a single question. */
export function compileFilter(filter: Filter): (row: Row, context: Context) => boolean {
  const compiled = compileOne(filter)
  return (row, context) => compiled.test(scopeFor(row, context))
}

/** A filter read from YAML, checked: an expression, or one of `and`, `or` and `not`
 *  holding a list of filters. Null for anything else. */
export function readFilter(raw: unknown): Filter | null {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  const [first] = entries
  if (entries.length !== 1 || !first) return null
  const [key, value] = first
  if ((key !== 'and' && key !== 'or' && key !== 'not') || !Array.isArray(value)) return null
  const members: Filter[] = []
  for (const one of value as unknown[]) {
    const read = readFilter(one)
    if (read === null) return null
    members.push(read)
  }
  return key === 'and' ? { and: members } : key === 'or' ? { or: members } : { not: members }
}
