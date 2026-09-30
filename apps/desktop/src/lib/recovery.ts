/** What the app keeps a note's earlier versions for, and for how long.
 *
 *  A version is kept of the words a sitting began with, before its first write,
 *  and of whatever Ctrl+S was pressed on; on top of that one is kept every few
 *  minutes while a note is being written in, so a bad edit still has something to
 *  go back to. What is kept has to be swept,
 *  or a long note edited all day would leave hundreds of copies of itself on
 *  the disk, so this is the policy: pure, and the same one on both sides of
 *  the app, since the browser keeps its versions in IndexedDB and the desktop
 *  keeps them as files. src-tauri/src/history.rs holds the other half. */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How often a version is taken while a note is being edited, in minutes. Zero
 *  is off: only a sitting's first write and Ctrl+S keep anything. */
export const SNAPSHOT_MINUTES = [0, 1, 5, 15] as const

/** How long a version is kept, in days. */
export const KEEP_DAYS = [1, 7, 30] as const

export const DEFAULT_MINUTES = 5
export const DEFAULT_DAYS = 7

/** Whichever of the choices this is, or the default when it is none of them. */
export function snapshotMinutes(value: unknown): number {
  return SNAPSHOT_MINUTES.find((one) => one === value) ?? DEFAULT_MINUTES
}

export function keepDays(value: unknown): number {
  return KEEP_DAYS.find((one) => one === value) ?? DEFAULT_DAYS
}

/** Which of one note's versions have had their day, given when they were taken
 *  and what time it is now. Answers the moments to drop.
 *
 *  Two rules, and a version has to survive both:
 *
 *  Nothing older than the retention is kept. That is the setting, and it is
 *  what the person asked for.
 *
 *  Past the first day, only the last version of each hour is kept. Today is
 *  when a bad edit is noticed and every step of it is worth having; a week ago,
 *  one version an hour is a history and the other ninety-nine are a disk full.
 *  That is the size cap: a note written in all day leaves twenty-four versions
 *  of that day behind rather than hundreds of them. */
export function staleSnapshots(
  taken: readonly number[],
  now: number,
  days: number = DEFAULT_DAYS,
): number[] {
  const stale: number[] = []
  /** The newest version seen in each hour, past the first day. */
  const newestOfHour = new Map<number, number>()

  // Newest first, so the first version met in an hour is the one that hour
  // keeps and every older one in it goes.
  for (const at of [...taken].sort((a, b) => b - a)) {
    const age = now - at
    if (age > days * DAY) {
      stale.push(at)
      continue
    }
    if (age <= DAY) continue

    const hour = Math.floor(at / HOUR)
    if (newestOfHour.has(hour)) stale.push(at)
    else newestOfHour.set(hour, at)
  }

  return stale
}
