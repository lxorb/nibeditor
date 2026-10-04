/** The calendar's arithmetic: which days a month, a week, three days or a day show,
 *  where each row sits on them, and the future occurrences of a repeating task, faded,
 *  the way Todoist shows them.
 *
 *  Pure, so the grid is a table of days in a test rather than a picture. Where a row
 *  sits is its date property (a task's due date, else its scheduled one, by default;
 *  a note's from the view's `nib.date`), and a task with a time also sits at its hour,
 *  as tall as its duration. */

import {
  addDays,
  addMonths,
  daysInMonth,
  type Group,
  nextDate,
  parseRule,
  type Row,
} from '@nib/bases'
import { weekStart } from './days'
import { dayIn } from './values'

export type CalendarMode = 'month' | 'week' | 'days3' | 'day'
export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week', 'days3', 'day']

/** The days a mode shows around an anchor day: whole weeks for a month, the anchor's
 *  week, three days from it, or the day. */
export function daysShown(mode: CalendarMode, anchor: string, first: number): string[] {
  if (mode === 'day') return [anchor]
  if (mode === 'days3') return [0, 1, 2].map((step) => addDays(anchor, step))
  if (mode === 'week') {
    const start = weekStart(anchor, first)
    return Array.from({ length: 7 }, (_, step) => addDays(start, step))
  }
  const month = `${anchor.slice(0, 8)}01`
  const start = weekStart(month, first)
  const last = `${anchor.slice(0, 8)}${String(daysInMonth(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)))).padStart(2, '0')}`
  const out: string[] = []
  for (let day = start; day <= last || out.length % 7 !== 0; day = addDays(day, 1)) out.push(day)
  return out
}

/** The anchor a step back or forward lands on. */
export function stepped(mode: CalendarMode, anchor: string, step: number): string {
  if (mode === 'month') return addMonths(anchor, step)
  if (mode === 'week') return addDays(anchor, 7 * step)
  if (mode === 'days3') return addDays(anchor, 3 * step)
  return addDays(anchor, step)
}

/** Where one row sits: its day, and its time and length where it has them. */
export interface Placed {
  row: Row
  day: string
  /** Minutes after midnight. */
  start?: number
  /** Minutes long. */
  minutes?: number
  /** A repeat's future occurrence, drawn faded and not dragged. */
  ghost?: boolean
}

/** Minutes after midnight of `HH:mm`. */
function minutesOf(time: string): number | null {
  const found = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!found) return null
  return Number(found[1]) * 60 + Number(found[2])
}

/** `HH:mm` of minutes after midnight. */
export function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** How long a timed task is drawn when it says no duration. */
const DEFAULT_MINUTES = 30

/** A row placed by a day it is given (the view's date property, read by the caller),
 *  with a task's own time and duration. */
export function place(row: Row, day: string): Placed {
  const time = row.task?.time ? minutesOf(row.task.time) : null
  if (time === null) return { row, day }
  return { row, day, start: time, minutes: row.task?.duration ?? DEFAULT_MINUTES }
}

/** The days a repeating task comes back on within the days shown, after the one it
 *  is on now. Each is the same row placed again, as a ghost. */
export function occurrences(placed: Placed, last: string, most = 62): Placed[] {
  const task = placed.row.task
  if (!task?.recurrence || task.done || task.cancelled) return []
  const rule = parseRule(task.recurrence)
  if (!rule || rule.whenDone) return []
  const out: Placed[] = []
  let after = placed.day
  while (out.length < most) {
    const next = nextDate(rule, placed.day, after)
    if (next === null || next > last) break
    out.push({ ...placed, day: next, ghost: true })
    after = next
  }
  return out
}

/** The rows of each day shown, and the ones with no day, in the order the view
 *  answered them. `dayOf` reads the view's date property of a row. */
export function placedByDay(
  rows: readonly Row[],
  days: readonly string[],
  dayOf: (row: Row) => string | null,
): { byDay: Map<string, Placed[]>; undated: Row[] } {
  const byDay = new Map<string, Placed[]>(days.map((day) => [day, []]))
  const undated: Row[] = []
  const first = days[0] ?? ''
  const last = days.at(-1) ?? ''
  for (const row of rows) {
    const day = dayOf(row)
    if (day === null) {
      undated.push(row)
      continue
    }
    const placed = place(row, day)
    if (day >= first) byDay.get(day)?.push(placed)
    for (const ghost of occurrences(placed, last)) {
      if (ghost.day >= first) byDay.get(ghost.day)?.push(ghost)
    }
  }
  return { byDay, undated }
}

/** The agenda a phone shows for a calendar: the days that have rows, in order, and
 *  the rows with no day at the end. `dayOf` reads the view's date property. */
export function agendaOf(
  rows: readonly Row[],
  dayOf: (row: Row) => string | null,
): { dated: [string, Row[]][]; undated: Row[] } {
  const byDay = new Map<string, Row[]>()
  const undated: Row[] = []
  for (const row of rows) {
    const day = dayOf(row)
    if (day === null) undated.push(row)
    else byDay.set(day, [...(byDay.get(day) ?? []), row])
  }
  return { dated: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)), undated }
}

/** How many rows each day-keyed group holds, by day: Upcoming's strip. */
export function dayCounts(groups: readonly Group[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const group of groups) {
    const day = dayIn(group.key)
    if (day) out.set(day, group.rows.length)
  }
  return out
}
