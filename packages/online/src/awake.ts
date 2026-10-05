/** The one rule of docs/online-terminal.md 4.4: whether a machine stays awake.
 *
 *  `Machine` asks it on its alarm every minute while the machine is awake, and the app
 *  may ask it to say why a machine went down; one pure function, so the two cannot
 *  disagree and the table of cases is a test rather than a hope.
 *
 *  The order is the order of the bounds, hardest first: a service or an account that
 *  is switched off, then the service's budget, then the month's allowance - none of
 *  which Keep awake or a working agent outlasts - and only then whether anything is
 *  using it. A machine at a bound is told so at once; giving an awake machine its ten
 *  minutes and a line on the screen (4.8) is the caller's, which knows when it first
 *  heard. */

import type { Activity, Allowance, AwakeAnswer, Watcher } from './types'

/** How long after the last sign of use a machine sleeps. */
export const IDLE_MS = 15 * 60 * 1000

/** How long a stretch one `Activity` covers: `nibd` reports every 30 seconds. */
export const ACTIVITY_EVERY_MS = 30 * 1000

/** Above this share of its CPU, a machine is working (a build that prints nothing). */
const BUSY_CPU = 0.05

/** Above this many bytes a minute over the network, a machine is working (an agent
 *  thinking on the network). */
const BUSY_NET_PER_MINUTE = 50 * 1024

/** The allowance of an account or a service that is switched off: no time at all. The
 *  caller passes it as `limit` when the service's `online` is off or the account's
 *  `users.online` is cleared, and the machine is told `off`. */
export const OFF: Allowance = { awakeS: 0, cpuS: 0, homeBytes: 0, egressBytes: 0 }

/** Whether one report shows the machine working: anything printed, the CPU past its
 *  share, or the network past its rate over the stretch the report covers. */
function working(activity: Activity): boolean {
  const netPerMinute = (activity.net * 60_000) / ACTIVITY_EVERY_MS
  return activity.output > 0 || activity.cpu > BUSY_CPU || netPerMinute > BUSY_NET_PER_MINUTE
}

/** Whether any allowance that is metered by time or traffic is used up. The home is
 *  not among them: a full home fails writes as a full disk does, and never puts the
 *  machine to sleep (4.3). */
function spent(used: Allowance, limit: Allowance): boolean {
  return (
    used.awakeS >= limit.awakeS || used.cpuS >= limit.cpuS || used.egressBytes >= limit.egressBytes
  )
}

/** Whether the machine stays awake, and why not if not.
 *
 *  - `off`: the limit allows no awake time (`OFF`);
 *  - `budget`: the service's estimated spend has reached Emil's ceiling;
 *  - `allowance`: the month's awake hours, CPU or egress is used;
 *  - otherwise it stays while Keep awake is on, while anybody active has one of its
 *    terminals on screen, or while any report of the last 15 minutes shows it working;
 *  - and else `idle`. */
export function awake(
  now: number,
  watchers: readonly Watcher[],
  recent: readonly Activity[],
  keepAwake: boolean,
  used: Allowance,
  limit: Allowance,
  budgetLeft: number,
): AwakeAnswer {
  if (limit.awakeS <= 0) return { stay: false, reason: 'off' }
  if (!(budgetLeft > 0)) return { stay: false, reason: 'budget' }
  if (spent(used, limit)) return { stay: false, reason: 'allowance' }

  if (keepAwake) return { stay: true }
  if (watchers.some((watcher) => watcher.active && watcher.onScreen)) return { stay: true }
  if (recent.some((activity) => now - activity.at <= IDLE_MS && working(activity))) {
    return { stay: true }
  }
  return { stay: false, reason: 'idle' }
}
