/** The timeline's arithmetic: a bar per row from a start to an end, on a scale of
 *  days, weeks, months or quarters, and what a drag of a bar or one of its edges
 *  writes.
 *
 *  A task's bar runs from its start date (else its scheduled one) to its due date,
 *  and is one day where it has only one; a note's runs between the two properties the
 *  view names (`nib.date`, `nib.end`), Notion's date range. Which field a drag writes
 *  is the field the bar's edge was read from, so moving a bar moves the dates the task
 *  actually has and gives it none it did not. */

import { addDays, dayNumber, type Row, type Value } from '@nib/bases'
import { dayIn } from './values'

export type Scale = 'day' | 'week' | 'month' | 'quarter'
export const SCALES: readonly Scale[] = ['day', 'week', 'month', 'quarter']

/** How wide a day is drawn on each scale. */
export const DAY_WIDTH: Record<Scale, number> = { day: 36, week: 14, month: 4.5, quarter: 1.6 }

export interface Bar {
  row: Row
  start: string
  end: string
  /** The properties the two edges were read from, which a drag writes. */
  from: string
  to: string
}

/** The bar of one row, or null for a row with no date at all. `read` gives a note
 *  property's value; `dates` are the view's own start and end properties. */
export function barOf(
  row: Row,
  dates: { start?: string | undefined; end?: string | undefined },
  read: (row: Row, property: string) => Value,
): Bar | null {
  if (row.task && !dates.start) {
    const task = row.task
    const from = task.start
      ? 'task.start'
      : task.scheduled
        ? 'task.scheduled'
        : task.due
          ? 'task.due'
          : null
    if (from === null) return null
    const start = task.start ?? task.scheduled ?? task.due ?? ''
    const to = task.due && from !== 'task.due' ? 'task.due' : from
    let end = task.due && from !== 'task.due' ? task.due : start
    if (end < start) end = start
    return { row, start, end, from, to }
  }

  const fromProperty = dates.start ?? 'file.ctime'
  const start = dayIn(read(row, fromProperty))
  if (start === null) return null
  const toProperty = dates.end ?? fromProperty
  const endRead = dayIn(read(row, toProperty))
  const end = endRead !== null && endRead >= start ? endRead : start
  return { row, start, end, from: fromProperty, to: toProperty }
}

/** The days the timeline spans: from a little before the first bar to a little after
 *  the last, and never less than a month around today. */
export function spanOf(bars: readonly Bar[], today: string): { first: string; last: string } {
  let first = addDays(today, -7)
  let last = addDays(today, 28)
  for (const bar of bars) {
    if (bar.start < first) first = addDays(bar.start, -3)
    if (bar.end > last) last = addDays(bar.end, 7)
  }
  return { first, last }
}

/** How many days lie from one day to another. */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from)

/** What a drag writes: the bar moved by whole days, or one edge moved, as the
 *  properties and their new days. The edge that would pass the other stops at it. */
export function dragged(
  bar: Bar,
  part: 'move' | 'start' | 'end',
  days: number,
): Record<string, string> {
  if (!days) return {}
  if (part === 'move') {
    const out: Record<string, string> = { [bar.from]: addDays(bar.start, days) }
    if (bar.to !== bar.from) out[bar.to] = addDays(bar.end, days)
    return out
  }
  if (part === 'start') {
    const start = addDays(bar.start, days)
    // A task of one date pulled wider gets a start of its own rather than moving.
    const field =
      bar.from === bar.to && bar.row.task && bar.from === 'task.due' ? 'task.start' : bar.from
    return { [field]: start > bar.end ? bar.end : start }
  }
  const end = addDays(bar.end, days)
  return { [bar.to]: end < bar.start ? bar.start : end }
}

export interface Arrow {
  /** From the end of the bar blocking, to the start of the bar it blocks. */
  from: { bar: Bar; at: number }
  to: { bar: Bar; at: number }
}

/** The dependencies among the bars: a task's `⛔` naming another's `🆔`. */
export function arrowsOf(bars: readonly Bar[]): Arrow[] {
  const byId = new Map<string, { bar: Bar; at: number }>()
  bars.forEach((bar, at) => {
    if (bar.row.task?.id) byId.set(bar.row.task.id, { bar, at })
  })
  const out: Arrow[] = []
  bars.forEach((bar, at) => {
    for (const id of bar.row.task?.dependsOn ?? []) {
      const blocker = byId.get(id)
      if (blocker) out.push({ from: blocker, to: { bar, at } })
    }
  })
  return out
}
