/** Days as the views count them: the reader's wall clock, as `YYYY-MM-DD`.
 *
 *  A task's date is floating (docs/tasks.md 5.1): Friday is Friday wherever the reader
 *  is, so a day is read off the local calendar and never off UTC, which would move
 *  every date a day for half the world. The arithmetic between days is the engine's
 *  (`addDays`, `weekday`), so the views and the filters cannot disagree about when
 *  next Monday is. */

import { addDays, weekday } from '@nib/bases'

const two = (value: number) => String(value).padStart(2, '0')

/** The day a moment falls on, here. */
export function dayOf(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

/** The moment as the engine's `now`: `YYYY-MM-DDTHH:mm:ss`, here. */
export function nowOf(at: Date): string {
  return `${dayOf(at)}T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

/** The Monday after a day, never the day itself: Todoist's "next week". */
export function nextMonday(day: string): string {
  const offset = (8 - weekday(day)) % 7 || 7
  return addDays(day, offset)
}

/** The first day of the week a day is in; `first` is 0 for Sunday, 1 for Monday. */
export function weekStart(day: string, first: number): string {
  return addDays(day, -((weekday(day) - first + 7) % 7))
}

/** Today, here, now. */
export const todayHere = (): string => dayOf(new Date())

/** The moment, here, as the engine reads `now()`. */
export const nowHere = (): string => nowOf(new Date())

/** How long until today changes, from now. */
export const untilMidnightHere = (): number => untilMidnight(new Date())

/** Milliseconds from a moment to the next midnight here, when today changes. */
function untilMidnight(at: Date): number {
  const next = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)
  return next.getTime() - at.getTime()
}

/** A day as a local Date at noon, which no daylight saving change can push into
 *  another day, for `Intl` to name. */
export function dateAt(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}
