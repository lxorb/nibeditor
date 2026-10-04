/** A list view's answer as the rows it draws, one row tall each: a group's head, its
 *  tasks with their sub-tasks under them, and the add row at the end of a group.
 *
 *  A sub-task sits under its parent wherever both are in the group, indented a level,
 *  and a parent wears a twist that folds them (docs/tasks.md 3, row 97). One flat list
 *  of same-height rows is what the window arithmetic needs (row-window.ts), so a
 *  Logbook of ten thousand done lines mounts the thirty on screen. Pure. */

import { type Group, groupName, type Row, rowId } from '@nib/bases'

export type Item =
  | { kind: 'head'; id: string; group: Group; count: number; folded: boolean }
  | {
      kind: 'row'
      id: string
      row: Row
      group: Group
      depth: number
      twist: 'open' | 'shut' | null
    }
  | { kind: 'add'; id: string; group: Group | null }

export interface ListOptions {
  /** Whether the view groups at all: an ungrouped view draws no heads. */
  grouped: boolean
  /** Groups folded, by name. */
  folded: ReadonlySet<string>
  /** Parents whose sub-tasks are folded, by row id. */
  shut: ReadonlySet<string>
  /** Groups the view keeps out of sight, by name. */
  hidden?: readonly string[]
  /** Whether each group ends in an add row. */
  adding: boolean
}

/** A group's rows in tree order, each with its depth. */
function tree(
  rows: readonly Row[],
  shut: ReadonlySet<string>,
): { row: Row; depth: number; parent: boolean }[] {
  const present = new Set(rows.map(rowId))
  const children = new Map<string, Row[]>()
  const roots: Row[] = []
  for (const row of rows) {
    const parent = row.task?.parent
    const parentId = parent === undefined ? null : `${row.path}#${parent}`
    if (parentId !== null && present.has(parentId)) {
      children.set(parentId, [...(children.get(parentId) ?? []), row])
    } else roots.push(row)
  }

  const out: { row: Row; depth: number; parent: boolean }[] = []
  const walk = (row: Row, depth: number) => {
    const id = rowId(row)
    const under = children.get(id) ?? []
    out.push({ row, depth, parent: under.length > 0 })
    if (shut.has(id)) return
    for (const child of under) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return out
}

/** The items a list draws for an answer's groups. */
export function listItems(groups: readonly Group[], options: ListOptions): Item[] {
  const out: Item[] = []
  for (const group of groups) {
    const name = groupName(group.key)
    if (options.hidden?.includes(name)) continue
    const folded = options.folded.has(name)
    if (options.grouped) {
      out.push({ kind: 'head', id: `head:${name}`, group, count: group.rows.length, folded })
      if (folded) continue
    }
    for (const one of tree(group.rows, options.shut)) {
      const id = rowId(one.row)
      out.push({
        kind: 'row',
        id: `row:${one.row.space}:${id}`,
        row: one.row,
        group,
        depth: one.depth,
        twist: one.parent ? (options.shut.has(id) ? 'shut' : 'open') : null,
      })
    }
    if (options.adding)
      out.push({ kind: 'add', id: `add:${name}`, group: options.grouped ? group : null })
  }
  return out
}

/** A set with a key put in, or taken out where it was there: a fold toggled. */
export function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** A board's swimlanes: every key the columns' sub-groups have, in the order they first
 *  come. */
export function laneKeys(groups: readonly Group[]): Group['key'][] {
  const seen = new Map<string, Group['key']>()
  for (const group of groups)
    for (const one of group.sub ?? []) seen.set(groupName(one.key), one.key)
  return [...seen.values()]
}

/** No keys: nothing folded yet. */
export const EMPTY: ReadonlySet<string> = new Set()
