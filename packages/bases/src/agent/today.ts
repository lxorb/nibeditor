/** Today without the engine: the open tasks due or scheduled on or before today and
 *  started, overdue first, then by priority and time. The built-in Today view's own
 *  question (builtins.ts), answered by hand for the one place that cannot carry the
 *  engine: the glasses' package, held under 8 MiB (docs/even.md). today.test.ts holds
 *  it to the engine's answer for the same rows, so the two cannot drift. */

import type { Row } from '../types'

/** Whether a row is on Today. */
function onToday(row: Row, today: string): boolean {
  const task = row.task
  if (row.kind !== 'task' || !task || task.done || task.cancelled) return false
  if (task.start !== undefined && task.start > today) return false
  return (
    (task.due !== undefined && task.due <= today) ||
    (task.scheduled !== undefined && task.scheduled <= today)
  )
}

const overdue = (row: Row, today: string) =>
  (row.task?.due !== undefined && row.task.due < today) ||
  (row.task?.scheduled !== undefined && row.task.scheduled < today)

/** Today's rows, in Today's order. */
export function todayTasks(rows: readonly Row[], today: string): Row[] {
  return rows
    .filter((row) => onToday(row, today))
    .map((row, at) => ({ row, at, late: overdue(row, today) }))
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        (a.row.task?.priority ?? 4) - (b.row.task?.priority ?? 4) ||
        timeOrder(a.row.task?.time, b.row.task?.time) ||
        a.at - b.at,
    )
    .map((one) => one.row)
}

/** A time before none, as a sort puts empty values last. */
function timeOrder(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a < b ? -1 : 1
}
