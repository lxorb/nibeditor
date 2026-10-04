/** A press on a reminder, answered: Done ticks the task, a press on the notification
 *  opens its note at it (docs/tasks.md 5.10).
 *
 *  The task is found again by its space, its note and its words' hash, the way every
 *  write finds a row (rows/write.ts), so a task that moved lines since the reminder was
 *  planned is still the one ticked, and one edited or deleted since is left alone. Done
 *  is the same write a box ticked in a view is: the done date, the open sub-tasks, and a
 *  recurring task's next line, as one edit. */

import type { Row } from '@nib/bases'

export interface Pressed {
  act: 'done' | 'open'
  space: string
  path: string
  hash: string
  line: number
}

export interface Host {
  /** A space's root, by its name. */
  rootOf(space: string): string | null
  /** The rows of one note, by its path on this disk. */
  rowsAt(path: string): readonly Row[]
  /** Settles once every space has been read. */
  ready(): Promise<void>
  /** Ticks a task through the one write path. */
  tick(row: Row): Promise<boolean>
  /** Opens a note, in its space, at a line. */
  open(root: string, path: string, line: number): Promise<void>
  /** Where a note of a space is on this disk. */
  inside(root: string, path: string): string
}

/** Answers one press. Answers whether anything was done. */
export async function respond(press: Pressed, host: Host): Promise<boolean> {
  const root = host.rootOf(press.space)
  if (root === null) return false

  await host.ready()
  const full = host.inside(root, press.path)
  const row = host
    .rowsAt(full)
    .find((one) => one.kind === 'task' && one.anchor?.hash === press.hash)

  if (press.act === 'open') {
    await host.open(root, full, row?.anchor?.line ?? press.line)
    return true
  }
  if (!row?.task || row.task.done || row.task.cancelled) return false
  return host.tick(row)
}

/** A press as the crate or the activity hands it over, or null for anything else. */
export function pressOf(value: unknown): Pressed | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const { act, space, path, hash, line } = one
  if (act !== 'done' && act !== 'open') return null
  if (typeof space !== 'string' || typeof path !== 'string' || typeof hash !== 'string') {
    return null
  }
  return { act, space, path, hash, line: typeof line === 'number' ? line : 0 }
}
