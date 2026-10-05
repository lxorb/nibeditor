/** A base changed the way a view's head changes it: a layout, a sort, a grouping, a
 *  filter, a column, a view added, renamed or taken away.
 *
 *  Never in place. The engine keeps a compiled view per base object (see `answer` in
 *  @nib/bases), so a base that changed under it would answer with the filter it had
 *  before; every edit here makes a new base, sharing whatever it did not touch, and
 *  the tab answers the new one afresh. Pure, so each is a line of a test. */

import type { Base, Filter, NibBase, NibProperty, NibView, Sort, View } from '@nib/bases'

/** The base with one of its views replaced. A place past the end changes nothing. */
function withView(base: Base, at: number, change: (view: View) => View): Base {
  const view = base.views[at]
  if (!view) return base
  const views = [...base.views]
  views[at] = change(view)
  return { ...base, views }
}

/** The view with some of nib's own keys changed; undefined takes one away. */
function withNib(view: View, change: { [K in keyof NibView]?: NibView[K] | undefined }): View {
  const nib: NibView = { ...view.nib }
  // `Object.entries` widens the keys to string; they are the change's own, which are
  // NibView's by the parameter's type.
  for (const [key, value] of Object.entries(change) as [keyof NibView, unknown][]) {
    if (value === undefined) Reflect.deleteProperty(nib, key)
    else Reflect.set(nib, key, value)
  }
  return { ...view, nib }
}

export const setLayout = (base: Base, at: number, type: string): Base =>
  withView(base, at, (view) => ({ ...view, type }))

export const setSort = (base: Base, at: number, sort: Sort[]): Base =>
  withView(base, at, (view) => ({ ...view, sort }))

/** A view without one of its optional keys. */
function lacking(view: View, key: 'groupBy' | 'filters'): View {
  const out = { ...view }
  Reflect.deleteProperty(out, key)
  return out
}

export const setGroup = (base: Base, at: number, group: Sort | undefined): Base =>
  withView(base, at, (view) => (group ? { ...view, groupBy: group } : lacking(view, 'groupBy')))

export const setSubGroup = (base: Base, at: number, sub: Sort | undefined): Base =>
  withView(base, at, (view) => withNib(view, { subGroupBy: sub }))

export const setFilter = (base: Base, at: number, filters: Filter | undefined): Base =>
  withView(base, at, (view) =>
    filters === undefined ? lacking(view, 'filters') : { ...view, filters },
  )

export const setShowCompleted = (base: Base, at: number, shown: boolean): Base =>
  withView(base, at, (view) => withNib(view, { showCompleted: shown ? true : undefined }))

/** The columns a view shows, in order. */
export const setColumns = (base: Base, at: number, order: string[]): Base =>
  withView(base, at, (view) => ({ ...view, order }))

/** A summary under a column, or none. */
export function setSummary(base: Base, at: number, property: string, name: string | null): Base {
  return withView(base, at, (view) => {
    const summaries = { ...view.summaries }
    if (name === null) Reflect.deleteProperty(summaries, property)
    else summaries[property] = name
    return { ...view, summaries }
  })
}

/** A group kept out of sight, or shown again. */
export function setHidden(base: Base, at: number, group: string, hidden: boolean): Base {
  return withView(base, at, (view) => {
    const was = view.nib.hidden ?? []
    const next = hidden ? [...new Set([...was, group])] : was.filter((one) => one !== group)
    return withNib(view, { hidden: next.length ? next : undefined })
  })
}

/** A group's manual order, as the board keeps it: row ids, first to last. */
export function setManualOrder(base: Base, at: number, group: string, ids: string[]): Base {
  return withView(base, at, (view) => {
    const order = { ...view.nib.order, [group]: ids }
    return withNib(view, { order })
  })
}

/** A key of a layout's own: a calendar's date, a chart's measure. Kept under the
 *  view's `nib:` so Obsidian leaves it alone. */
export function setNibOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    if (key === 'date' || key === 'end') {
      return withNib(view, { [key]: typeof value === 'string' ? value : undefined })
    }
    const kept = { ...view.nib.kept }
    if (value === undefined) Reflect.deleteProperty(kept, key)
    else kept[key] = value
    return withNib(view, { kept })
  })
}

/** A name no other view of the base has: the one asked for, or it with a number. */
export function freeViewName(base: Base, wanted: string): string {
  const taken = new Set(base.views.map((view) => view.name))
  if (!taken.has(wanted)) return wanted
  for (let count = 2; ; count++) {
    const name = `${wanted} ${count}`
    if (!taken.has(name)) return name
  }
}

/** Another view after the one at `at`: a copy of it, or a fresh one of a layout. */
export function addView(base: Base, at: number, type?: string): Base {
  const from = base.views[at]
  const name = freeViewName(base, from?.name.trim() ? from.name : 'View')
  const made: View = from
    ? { ...from, name, ...(type ? { type } : {}) }
    : {
        type: type ?? 'table',
        name,
        order: [],
        sort: [],
        summaries: {},
        nib: { kept: {} },
        options: {},
      }
  const views = [...base.views]
  views.splice(at + 1, 0, made)
  return { ...base, views }
}

export function renameView(base: Base, at: number, name: string): Base {
  const trimmed = name.trim()
  if (!trimmed || base.views[at]?.name === trimmed) return base
  return withView(base, at, (view) => ({ ...view, name: freeViewName(base, trimmed) }))
}

/** A view taken away; the last view of a base is never taken. */
export function removeView(base: Base, at: number): Base {
  if (base.views.length < 2 || !base.views[at]) return base
  return { ...base, views: base.views.filter((_, index) => index !== at) }
}

/** A key of the view Obsidian itself writes beside `type` (`columnSize`, `image`,
 *  `cardSize`), set or taken away. */
export function setViewOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    const options = { ...view.options }
    if (value === undefined) Reflect.deleteProperty(options, key)
    else options[key] = value
    return { ...view, options }
  })
}

/** One of nib's own keys of a view (`lines`, `freeze`, `colour`, `template`, `required`,
 *  `locked`), set or, with undefined, taken away. */
export function setViewNib<K extends Exclude<keyof NibView, 'kept'>>(
  base: Base,
  at: number,
  key: K,
  value: NibView[K] | undefined,
): Base {
  return withView(base, at, (view) => withNib(view, { [key]: value }))
}

/** The base's nib keys with one changed: its default template, its ids, its lock. */
export function setBaseNib<K extends 'template' | 'id' | 'locked'>(
  base: Base,
  key: K,
  value: NibBase[K] | undefined,
): Base {
  const nib: NibBase = { ...base.nib }
  if (value === undefined) Reflect.deleteProperty(nib, key)
  else Reflect.set(nib, key, value)
  return { ...base, nib }
}

/** A formula made, changed or (null) taken away. */
export function setFormula(base: Base, name: string, source: string | null): Base {
  const formulas = { ...base.formulas }
  if (source === null) Reflect.deleteProperty(formulas, name)
  else formulas[name] = source
  return { ...base, formulas }
}

/** What nib says about one property (`nib.properties.<key>`): its options, its format. */
export function setProperty(
  base: Base,
  key: string,
  change: { [K in keyof NibProperty]?: NibProperty[K] | undefined },
): Base {
  const next: NibProperty = { ...(base.nib.properties[key] ?? { kept: {} }) }
  for (const [name, value] of Object.entries(change)) {
    if (value === undefined) Reflect.deleteProperty(next, name)
    else Reflect.set(next, name, value)
  }
  const properties = { ...base.nib.properties }
  const empty = Object.keys(next).length === 1 && !Object.keys(next.kept).length
  if (empty) Reflect.deleteProperty(properties, key)
  else properties[key] = next
  return { ...base, nib: { ...base.nib, properties } }
}

/** A name no formula of the base has yet: the one asked for, or it with a number. */
export function freeFormulaName(base: Base, wanted: string): string {
  const name = wanted.trim() || 'Formula'
  if (!(name in base.formulas)) return name
  for (let count = 2; ; count++)
    if (!(`${name} ${count}` in base.formulas)) return `${name} ${count}`
}
