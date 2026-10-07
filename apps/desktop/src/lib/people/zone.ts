/** Whether somebody's clock is far enough from the reader's to be worth showing: an hour
 *  or more apart, the one case where the time where they are changes whether to write
 *  now. Read off `Intl` in both zones, so a zone this engine does not know is no answer
 *  rather than a wrong one. Pure, with the moment handed in. */

/** Minutes a zone's wall clock is ahead of UTC at `at`, or null for a zone this engine
 *  does not know. */
export function zoneOffset(zone: string, at: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((one) => one.type === type)?.value ?? 0)
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    )
    return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000)
  } catch {
    // Not a zone this engine has: nothing to compare.
    return null
  }
}

/** Whether `zone` is an hour or more from `here` at `at`. */
export function farApart(zone: string, here: string, at: number): boolean {
  const theirs = zoneOffset(zone, at)
  const ours = zoneOffset(here, at)
  return theirs !== null && ours !== null && Math.abs(theirs - ours) >= 60
}
