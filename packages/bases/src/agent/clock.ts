/** What the reader's clock says, as the engine reads it. */

import type { Context } from '../types'

/** Today and now, off the local clock or a zone's where one is named. */
export function clockOf(now: Date, zone?: string): Pick<Context, 'today' | 'now'> {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      ...(zone ? { timeZone: zone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  const today = `${parts.year}-${parts.month}-${parts.day}`
  return { today, now: `${today}T${parts.hour}:${parts.minute}:${parts.second}` }
}
