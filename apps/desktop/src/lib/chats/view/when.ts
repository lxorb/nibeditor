/** The times a chat says, in the reader's language and on their calendar: a message's
 *  time, and the line for each new day (docs/chats.md 4.15). Words only where a date
 *  would be harder to read: Today and Yesterday. */

import { i18n, t } from '../../i18n.svelte'

/** The reader's own calendar day of a time, `YYYY-MM-DD`. */
export function dayOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A message's time: `16:40`, or the reader's own shape of it. */
export function timeOf(at: number): string {
  return i18n.when(at, { hour: 'numeric', minute: '2-digit' })
}

/** The day line's words: Today, Yesterday, a weekday this week, a date before that. */
export function dayLine(at: number, now = Date.now()): string {
  const day = dayOf(at)
  if (day === dayOf(now)) return t('Today')
  if (day === dayOf(now - 24 * 60 * 60 * 1000)) return t('Yesterday')
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return i18n.when(at, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** When Send later offers to send: in an hour, tomorrow at nine, and next Monday at nine,
 *  on the reader's clock. */
export function laterTimes(now: number): number[] {
  const at = (days: number, hour: number) => {
    const when = new Date(now)
    when.setDate(when.getDate() + days)
    when.setHours(hour, 0, 0, 0)
    return when.getTime()
  }
  const monday = (8 - new Date(now).getDay()) % 7 || 7
  return [now + 60 * 60 * 1000, at(1, 9), at(monday, 9)]
}

/** A stretch of time in the reader's language, `1 hour`, `3 days`, with no catalogue
 *  row: what a poll's end and a mute are offered as. */
export function stretch(count: number, unit: 'hour' | 'day' | 'week'): string {
  try {
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit,
      unitDisplay: 'long',
    }).format(count)
  } catch {
    return new Intl.NumberFormat('en', { style: 'unit', unit, unitDisplay: 'long' }).format(count)
  }
}

/** A time in full, for the hover on a message's time: the day and the minute. */
export function fullTime(at: number): string {
  return i18n.when(at, { dateStyle: 'full', timeStyle: 'short' })
}
