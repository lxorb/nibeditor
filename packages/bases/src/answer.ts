/** A view of a base answered over a set of rows: which rows, in what order, in
 *  which groups, with which summaries.
 *
 *  In the order Bases applies them: the base's filters and the view's, the view's
 *  own search, the sort, the limit, the grouping and a second grouping under it,
 *  then the summaries of each group and of all of it. Groups come in the order the
 *  property's options give (empty ones included, so a board keeps a column for a
 *  status nothing has yet), then by value, and the group of rows with no value
 *  last.
 *
 *  Answering again is cheap. A compiled view keeps, per row object, whether the
 *  row passed and its sort and group keys, for as long as the context's day,
 *  clock, `this` and search stay the same. The rows store replaces a row object
 *  only when its file changed, so a second answer after one save evaluates the
 *  rows of that file and reuses every other row's work. A view whose expressions
 *  read other files (`asFile()`, backlinks) cannot keep anything and is evaluated
 *  whole, which is still a loop over closures. */

import { compile, formulaReader } from './expr/compile'
import { type Scope, settled, sortCompare, text, type Val } from './expr/runtime'
import { compileFilters } from './filter'
import { summarize } from './summaries'
import type { Answer, Base, Context, Group, Row, Sort, Value, View } from './types'
import { BasesError } from './errors'

/** What a view keeps about one row while the context stays the same. */
interface RowFacts {
  pass: boolean
  sort: Val[]
  group: Val
  sub: Val
  /** The words the view's search looks through, read the first time a search asks. */
  words: string | null
}

/** A property of a view, as a function of the row. */
interface Getter {
  run: (scope: Scope) => Val
  local: boolean
  clock: boolean
}

function getter(property: string): Getter {
  try {
    const compiled = compile(property)
    return {
      local: compiled.local,
      clock: compiled.clock,
      run: (scope) => {
        try {
          return compiled.run(scope)
        } catch (error) {
          if (error instanceof BasesError) return null
          throw error
        }
      },
    }
  } catch (error) {
    if (!(error instanceof BasesError)) throw error
    // A property name an expression cannot spell, `note.my prop`, read as it is; a
    // formula named so, `formula.My tasks`, read as that formula (a reverse column is
    // named after a folder, which may have a space in it).
    if (property.startsWith('formula.')) {
      const formula = property.slice(8)
      return {
        local: false,
        clock: true,
        run: (scope) => {
          try {
            return scope.row ? scope.formula(formula, scope.row) : null
          } catch (error) {
            if (error instanceof BasesError) return null
            throw error
          }
        },
      }
    }
    const name = property.replace(/^note\./, '')
    return { local: true, clock: false, run: (scope) => scope.row?.note[name] ?? null }
  }
}

const NONE: Getter = { local: true, clock: false, run: () => null }

/** The view a name or a place in the list stands for: the first when it names none. */
export function viewOf(base: Base, view: string | number | undefined): View | undefined {
  if (typeof view === 'number') return base.views[view]
  return base.views.find((one) => one.name === view) ?? base.views[0]
}

/** A group key as text, for the map that collects groups and for the manual order
 *  and hidden groups the view keeps. */
export function groupName(key: Value): string {
  return key === null ? '' : text(key)
}

/** The options a property's groups come in, nib's select options. */
function optionOrder(base: Base, property: string | undefined): string[] {
  if (!property) return []
  const key = property.replace(/^note\./, '')
  return base.nib.properties[key]?.options?.map((option) => option.value) ?? []
}

export interface CompiledView {
  view: View
  answer: (rows: readonly Row[], context: Context) => Answer
}

const DEFAULT_VIEW: View = {
  type: 'table',
  name: '',
  order: [],
  sort: [],
  summaries: {},
  nib: { kept: {} },
  options: {},
}

/** A view compiled once for many answers. Throws a BasesError for a filter or a
 *  formula that does not parse. */
export function compileView(base: Base, which?: string | number): CompiledView {
  const view = viewOf(base, which) ?? DEFAULT_VIEW
  const filter = compileFilters(base.filters, view.filters)
  const sorts = view.sort.map((sort) => ({
    get: getter(sort.property),
    descending: sort.direction === 'DESC',
  }))
  const group = view.groupBy ? getter(view.groupBy.property) : NONE
  const sub = view.nib.subGroupBy ? getter(view.nib.subGroupBy.property) : NONE
  const shown = view.order.map(getter)
  const formulas = Object.values(base.formulas).flatMap((source) => {
    try {
      return [compile(source)]
    } catch {
      // A formula that does not parse answers nothing, which keeps nothing stale.
      return []
    }
  })
  const getters = [group, sub, ...sorts.map((one) => one.get), ...shown]
  const local = filter.local && [...formulas, ...getters].every((one) => one.local)
  const clock = filter.clock || [...formulas, ...getters].some((one) => one.clock)

  const kinds = view.nib.rows ?? 'notes'
  const showCompleted = view.nib.showCompleted ?? false
  let facts = new WeakMap<Row, RowFacts>()
  let factsFor = ''

  const answer = (rows: readonly Row[], context: Context): Answer => {
    const key = [
      context.today,
      clock ? context.now : '',
      context.this?.path ?? '',
      context.this?.space ?? '',
      context.me ?? '',
    ].join('\n')
    if (!local || key !== factsFor) {
      facts = new WeakMap()
      factsFor = key
    }
    const read = formulaReader(base.formulas)
    const scope: Scope = {
      row: null,
      context,
      locals: null,
      formula: (name, row) => read(name, row, scope),
    }
    const words = (context.search ?? '').toLowerCase().split(/\s+/).filter(Boolean)

    const factsOf = (row: Row): RowFacts => {
      const known = facts.get(row)
      if (known) return known
      scope.row = row
      const pass = filter.test(scope)
      const made: RowFacts = pass
        ? {
            pass,
            sort: sorts.map((one) => one.get.run(scope)),
            group: group.run(scope),
            sub: sub.run(scope),
            words: null,
          }
        : { pass, sort: [], group: null, sub: null, words: null }
      facts.set(row, made)
      return made
    }

    const wordsOf = (row: Row, one: RowFacts): string => {
      if (one.words === null) {
        scope.row = row
        one.words = [
          row.file.basename,
          row.task?.text ?? '',
          ...shown.map((get) => text(get.run(scope))),
        ]
          .join('\n')
          .toLowerCase()
      }
      return one.words
    }

    const kept: { row: Row; facts: RowFacts; at: number }[] = []
    rows.forEach((row, at) => {
      if (kinds === 'notes' && row.kind !== 'note') return
      if (kinds === 'tasks' && row.kind !== 'task') return
      if (!showCompleted && row.task && (row.task.done || row.task.cancelled)) return
      const one = factsOf(row)
      if (!one.pass) return
      if (words.length && !words.every((word) => wordsOf(row, one).includes(word))) return
      kept.push({ row, facts: one, at })
    })

    kept.sort((a, b) => {
      for (let index = 0; index < sorts.length; index++) {
        const order = sortCompare(a.facts.sort[index] ?? null, b.facts.sort[index] ?? null)
        if (order !== 0) {
          const nullLast = a.facts.sort[index] === null || b.facts.sort[index] === null
          return sorts[index]?.descending && !nullLast ? -order : order
        }
      }
      return a.at - b.at
    })
    const limited = view.limit ? kept.slice(0, view.limit) : kept

    const summaries = (members: readonly { row: Row; facts: RowFacts }[]) => {
      const out: Record<string, Value> = {}
      for (const [property, name] of Object.entries(view.summaries)) {
        const get = getter(property)
        const values = members.map((one) => {
          scope.row = one.row
          return settled(get.run(scope))
        })
        out[property] = summarize(name, values, base.summaries, context)
      }
      return out
    }

    const grouped = (
      members: { row: Row; facts: RowFacts }[],
      keyOf: (one: RowFacts) => Val,
      by: Sort | undefined,
      inner?: (members: { row: Row; facts: RowFacts }[]) => Group[],
    ): Group[] => {
      if (!by)
        return [
          {
            key: null,
            rows: ordered(members, '').map((one) => one.row),
            summaries: summaries(members),
          },
        ]
      const options = optionOrder(base, by.property)
      const groups = new Map<string, { key: Value; members: { row: Row; facts: RowFacts }[] }>()
      for (const option of options) groups.set(option, { key: option, members: [] })
      for (const one of members) {
        const key = settled(keyOf(one.facts))
        const name = groupName(key)
        const found = groups.get(name)
        if (found) found.members.push(one)
        else groups.set(name, { key, members: [one] })
      }
      const keys = [...groups.values()]
      if (view.nib.groupOrder !== 'rows')
        keys.sort((a, b) => {
          if (a.key === null || b.key === null) return a.key === b.key ? 0 : a.key === null ? 1 : -1
          const optionA = options.indexOf(groupName(a.key))
          const optionB = options.indexOf(groupName(b.key))
          if (optionA !== -1 || optionB !== -1) {
            return (
              (optionA === -1 ? options.length : optionA) -
              (optionB === -1 ? options.length : optionB)
            )
          }
          const order = sortCompare(a.key, b.key)
          return by.direction === 'DESC' ? -order : order
        })
      return keys.map(({ key, members: inGroup }) => {
        const out: Group = {
          key,
          rows: ordered(inGroup, groupName(key)).map((one) => one.row),
          summaries: summaries(inGroup),
        }
        if (inner) out.sub = inner(inGroup)
        return out
      })
    }

    /** The view's manual order of a group first, in that order, the rest after. */
    const ordered = <T extends { row: Row }>(members: T[], name: string): T[] => {
      const manual = view.nib.order?.[name]
      if (!manual?.length) return members
      const place = new Map(manual.map((id, at) => [id, at]))
      const rank = (one: T) => place.get(rowId(one.row)) ?? manual.length
      return [...members].sort((a, b) => rank(a) - rank(b))
    }

    const subBy = view.nib.subGroupBy
    const groups = grouped(
      limited,
      (one) => one.group,
      view.groupBy,
      subBy ? (members) => grouped(members, (one) => one.sub, subBy) : undefined,
    )
    return { groups, total: limited.length, summaries: summaries(limited) }
  }

  return { view, answer }
}

/** How a manual order names a row: its path, and a task's line after a `#`. */
export function rowId(row: Row): string {
  return row.anchor ? `${row.path}#${row.anchor.line}` : row.path
}

const compiledViews = new WeakMap<Base, Map<string | number, CompiledView>>()

/** The answer of one view of a base over these rows. The view is compiled the
 *  first time a base object is asked about it and kept with that object, so a base
 *  is never changed in place: an edit makes a new one (readBase of what was
 *  written, or a copy), which is compiled afresh. */
export function answer(
  base: Base,
  view: string | number | undefined,
  rows: readonly Row[],
  context: Context,
): Answer {
  const views = compiledViews.get(base) ?? new Map<string | number, CompiledView>()
  compiledViews.set(base, views)
  const key = view ?? 0
  let compiled = views.get(key)
  if (!compiled) {
    compiled = compileView(base, view)
    views.set(key, compiled)
  }
  return compiled.answer(rows, context)
}

/** One property of one row as the view would show it: a cell. */
export function cellValue(base: Base, property: string, row: Row, context: Context): Value {
  const read = formulaReader(base.formulas)
  const scope: Scope = { row, context, locals: null, formula: (name, at) => read(name, at, scope) }
  return settled(getter(property).run(scope))
}
