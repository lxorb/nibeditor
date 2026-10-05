/** What a base does by itself when one of its rows changes (docs/tasks.md 5.12, 5.13):
 *  its automations, and its ids - the next one for a row just made without one, and a
 *  fresh one for the younger of two rows two devices numbered alike while offline.
 *
 *  Pure: handed the bases of the space, the one note's rows before and after, every row
 *  of the space and the clock, it answers what to write, what to move and what to say.
 *  Every set for one row is one change, so the runner writes it as one edit and joins it
 *  to the undo of the edit that caused it (runner.svelte.ts). */

import {
  type Base,
  type Context,
  fired,
  type Filling,
  idNumber,
  idRepairs,
  inBase,
  nextId,
  readAutomations,
  type Row,
  type Value,
} from '@nib/bases'
import type { RowChange } from '../rows/write'

/** A base file the runner holds: its name, its space, and what it says. */
export interface HeldBase {
  name: string
  space: string
  base: Base
}

export interface Planned {
  writes: { row: Row; change: RowChange }[]
  moves: { row: Row; folder: string }[]
  notices: { row: Row; base: string; words: string }[]
}

const EMPTY: Planned = { writes: [], moves: [], notices: [] }

/** The rows of one base, made once per plan. */
function ownRows(base: Base, all: readonly Row[], context: Context): Row[] {
  return all.filter((row) => row.kind === 'note' && inBase(base, row, context))
}

/** Everything the space's bases do because the note whose rows were `removed` now has
 *  the rows `added`. */
export function planned(
  bases: readonly HeldBase[],
  removed: readonly Row[],
  added: readonly Row[],
  all: readonly Row[],
  context: Context,
  filling: Omit<Filling, 'title'>,
): Planned {
  const after = added.find((row) => row.kind === 'note')
  if (!after) return EMPTY
  const before = removed.find((row) => row.kind === 'note')

  const sets = new Map<Row, Record<string, Value | null>>()
  const set = (row: Row, values: Record<string, Value | null>) =>
    sets.set(row, { ...sets.get(row), ...values })
  const out: Planned = { writes: [], moves: [], notices: [] }

  for (const held of bases) {
    if (held.space !== after.space || !inBase(held.base, after, context)) continue

    const effect = fired(readAutomations(held.base), before, after, filling)
    if (effect) {
      if (Object.keys(effect.set).length) set(after, effect.set)
      if (effect.move !== undefined) out.moves.push({ row: after, folder: effect.move })
      for (const words of effect.notify) out.notices.push({ row: after, base: held.name, words })
    }

    const id = held.base.nib.id
    if (!id) continue
    const own = ownRows(held.base, all, context)
    if (before === undefined && idNumber(after.note[id.property], id.prefix) === null) {
      set(after, { [id.property]: nextId(own, id.property, id.prefix) })
    }
    for (const { row, id: next } of idRepairs(own, id.property, id.prefix, false)) {
      set(row, { [id.property]: next })
    }
  }

  out.writes = [...sets].map(([row, note]) => ({ row, change: { note } }))
  return out
}
