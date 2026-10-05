/** Which age a thread is filed under in the list, ChatGPT's history: Today, Yesterday,
 *  the last seven days, and then a month at a time, the newest first. Counted in the
 *  reader's own calendar days, so a thread from 23:50 is yesterday at 00:10.
 *
 *  The answer is a key, not words: the list says each one in the reader's language
 *  (Threads.svelte), and two threads of one key sit under one heading. */

export type Age =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'week' }
  /** A month, counted from zero, of a year. */
  | { kind: 'month'; year: number; month: number }

const DAY = 24 * 60 * 60 * 1000

/** Midnight of the day a moment falls on, in local time. */
function dayOf(moment: Date): number {
  return new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime()
}

export function ageOf(stamp: number, now = new Date()): Age {
  const at = new Date(stamp)
  // Rounded, since a day with a clock change in it is 23 or 25 hours long.
  const days = Math.round((dayOf(now) - dayOf(at)) / DAY)
  if (days <= 0) return { kind: 'today' }
  if (days === 1) return { kind: 'yesterday' }
  if (days < 7) return { kind: 'week' }
  return { kind: 'month', year: at.getFullYear(), month: at.getMonth() }
}

/** One string per age, for telling two apart. */
export function ageKey(age: Age): string {
  return age.kind === 'month' ? `${age.year}-${age.month}` : age.kind
}
