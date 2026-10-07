/** When a status clears, Slack's six answers, as the moment it is read as gone.
 *
 *  Worked out on the device that sets it, in the zone that device is in: "today" is the
 *  end of the setter's day, not the server's. The service then reads a status whose
 *  moment has passed as none, so nothing has to run at the minute it ends; see
 *  services/sync/src/people/profile.ts. Pure, with the clock handed in. */

export type Clears = '30m' | '1h' | '4h' | 'today' | 'week' | 'never'

export const CLEARS: readonly Clears[] = ['30m', '1h', '4h', 'today', 'week', 'never']

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The moment a status set at `now` goes, or null for one that stays. The week ends as
 *  Sunday does, at midnight, where a reader whose week starts on Monday expects it. */
export function clearsAt(choice: Clears, now: Date): number | null {
  switch (choice) {
    case '30m':
      return now.getTime() + 30 * MINUTE
    case '1h':
      return now.getTime() + HOUR
    case '4h':
      return now.getTime() + 4 * HOUR
    case 'today':
      return midnightAfter(now, 0)
    case 'week':
      return midnightAfter(now, (7 - now.getDay()) % 7)
    case 'never':
      return null
  }
}

/** The midnight that ends the day `days` after `now`'s, in this device's zone. */
function midnightAfter(now: Date, days: number): number {
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  end.setDate(end.getDate() + days)
  return end.getTime()
}

/** Whether a status still stands at `now`. */
export function stands(status: { until: number | null } | null | undefined, now: number): boolean {
  return !!status && (status.until === null || status.until > now)
}
