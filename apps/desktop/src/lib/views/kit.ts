/** What every layout of a view can do, in one place: open a row's note at its line,
 *  tick a task, write a cell, drop a row into a group, add to a group, and change the
 *  view itself. A layout draws the engine's answer and calls these; it never filters,
 *  sorts or writes a file of its own (docs/tasks.md 5.9). */

import { addDays, type Base, type Row, type Value } from '@nib/bases'
import type { RowChange } from '../rows/write'
import { insideSpace } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { dropRow, indentRow, moveRow, tickRow, writeRow } from './act'
import { addNote, openQuickAdd, type Prefill, prefillOf } from './add'
import { dropInto } from './drop'
import { nextMonday } from './days'
import type { LiveView } from './live.svelte'
import type { RowKey } from './row-keys'
import type { ViewSpec } from './spec'

export interface Kit {
  live: LiveView
  spec: ViewSpec
  /** The base file the view is of, on this disk, or null. */
  file: string | null
  /** A fence or an embed: a smaller head, and no layouts that need a tab's room. */
  compact: boolean
  /** Opens the row's note at its line: beside the view, or in a tab of its own. */
  open(row: Row, how?: 'aside' | 'tab'): void
  tick(row: Row): void
  write(row: Row, change: RowChange): void
  /** A row dropped into the group keyed `key` of the view's grouping (or of
   *  `property` where a layout groups by one of its own, a calendar's day). */
  drop(row: Row, key: Value, property?: string): void
  /** Adds to the view, in a group where one is named. Answers the prefill where the
   *  view's own add row should take the words (no quick add yet), else null. */
  add(group?: { property: string; key: Value }): Prefill | null
  /** Changes the view: a new base made from the one showing. */
  change(edit: (base: Base, at: number) => Base): void
}

/** Where a row's note is on this disk. */
export function notePath(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

export function kitFor(live: LiveView, spec: ViewSpec, file: string | null, compact: boolean): Kit {
  return {
    live,
    spec,
    file,
    compact,
    open(row, how = 'aside') {
      const path = notePath(row)
      if (path === null) return
      const line = row.anchor?.line ?? 0
      void (how === 'aside' ? workspace.openAside(path) : workspace.open(path)).then(() => {
        workspace.goto = { path, line }
      })
    },
    tick(row) {
      void tickRow(row, live.today)
    },
    write(row, change) {
      void writeRow(row, change)
    },
    drop(row, key, property) {
      const by = property ?? live.view?.groupBy?.property
      if (by === undefined) return
      const drop = dropInto(by, key, row, live.today)
      if (drop) void dropRow(row, drop)
    },
    add(group) {
      const base = live.base
      const kinds = live.view?.nib.rows ?? 'notes'
      if (base && kinds === 'notes') {
        void addNote(base, live.at, file, group)
        return null
      }
      const prefill = prefillOf(spec, live.today, group)
      return openQuickAdd(prefill) ? null : prefill
    },
    change(edit) {
      const base = live.base
      if (base) void live.change(edit(base, live.at))
    },
  }
}

/** A key pressed on a row, done (row-keys.ts). Answers whether it was one of a row's
 *  own, so the layout keeps the key from going further; stepping and adding are the
 *  layout's, which knows what is above and below. */
export function runKey(kit: Kit, row: Row, key: RowKey): boolean {
  switch (key.kind) {
    case 'open':
      kit.open(row, key.tab ? 'tab' : 'aside')
      return true
    case 'tick':
      if (row.task) kit.tick(row)
      return row.task !== undefined
    case 'due': {
      if (!row.task) return false
      const today = kit.live.today
      const due =
        key.when === 'today'
          ? today
          : key.when === 'tomorrow'
            ? addDays(today, 1)
            : nextMonday(today)
      kit.write(row, { task: { due } })
      return true
    }
    case 'priority':
      if (row.task) kit.write(row, { task: { priority: key.priority } })
      return row.task !== undefined
    case 'move':
      if (row.task) void moveRow(row, key.up)
      return row.task !== undefined
    case 'indent':
      if (row.task) void indentRow(row, key.deeper)
      return row.task !== undefined
    case 'step':
    case 'add':
      return false
  }
}
