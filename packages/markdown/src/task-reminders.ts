/** When a task asks to be reminded, as moments on a clock.
 *
 *  One answer for every place that rings: the app's scheduler, which hands the next
 *  reminders to the system, and the Worker, which pushes to a phone that has not opened
 *  nib since (docs/tasks.md 5.10). Both read the same task line, so both have to agree on
 *  the minute, and this is where that minute is worked out.
 *
 *  A task's time is floating, the wall clock wherever the reader is, unless a zone is
 *  written after it; so a reminder is first a wall time (a date and `HH:MM`) and only
 *  becomes a moment against a zone: the one on the line, else the one the caller is in.
 *
 *  What rings: each `[remind::]` entry (some minutes before the task's time, a time on
 *  the task's own day, or a moment of its own), and the automatic one at the task's time
 *  less the reader's offset, as Todoist does for every task with a time. A task that is
 *  done or cancelled rings nothing. A relative reminder needs a time to count back from,
 *  and a time of day needs a day, so a task without either has none of those. */

import type { TaskFields } from './task-line'

/** A wall time: a date and `HH:MM`, and the zone it is read in where the line says. */
export interface WallTime {
  date: string
  time: string
  zone?: string
}

const MINUTE = 60_000

/** The day a task is on: its due date, else the scheduled one. */
export function taskDay(task: TaskFields): string | undefined {
  return task.due ?? task.scheduled
}

/** Every wall time a task rings at, earliest first and each once. `auto` is how many
 *  minutes before its time a task with a time is reminded of on its own, or null where
 *  the reader turned that off. */
export function remindTimes(task: TaskFields, auto: number | null): WallTime[] {
  if (task.done || task.cancelled) return []

  const day = taskDay(task)
  const zone = task.zone
  const at = (date: string, time: string): WallTime =>
    zone ? { date, time, zone } : { date, time }
  const found: WallTime[] = []

  for (const one of task.remind) {
    if ('at' in one) found.push(at(one.at, one.time))
    else if ('time' in one) {
      if (day) found.push(at(day, one.time))
    } else if (day && task.time) {
      found.push(before(at(day, task.time), one.before))
    }
  }
  if (auto !== null && day && task.time) found.push(before(at(day, task.time), auto))

  const seen = new Set<string>()
  return found
    .filter((one) => {
      const key = `${one.date} ${one.time}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
}

/** A wall time some minutes earlier, counted on the wall clock: 15 minutes before
 *  00:10 is 23:55 the day before. */
function before(wall: WallTime, minutes: number): WallTime {
  if (minutes <= 0) return wall
  const [hours = 0, mins = 0] = wall.time.split(':').map(Number)
  const [year = 1970, month = 1, day = 1] = wall.date.split('-').map(Number)
  const moment = new Date(Date.UTC(year, month - 1, day, hours, mins) - minutes * MINUTE)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  const date = `${pad(moment.getUTCFullYear(), 4)}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`
  const time = `${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())}`
  return wall.zone ? { date, time, zone: wall.zone } : { date, time }
}

/** The moment a wall time stands for, in milliseconds since the epoch: read in its own
 *  zone where it has one, else in `zone`, else on this machine's clock. NaN for a date,
 *  a time or a zone that is not one. */
export function momentOf(wall: WallTime, zone?: string): number {
  const [hours, minutes] = wall.time.split(':').map(Number)
  const [year, month, day] = wall.date.split('-').map(Number)
  if ([hours, minutes, year, month, day].some((one) => one === undefined || Number.isNaN(one))) {
    return NaN
  }
  const named = wall.zone ?? zone
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0)
  if (!named) {
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0).getTime()
  }

  // The zone's offset at the moment guessed, then again at the moment that gives, which
  // is the one a clock change between the two decides.
  const first = utc - offsetOf(named, utc)
  if (Number.isNaN(first)) return NaN
  return utc - offsetOf(named, first)
}

/** How far a zone's wall clock is ahead of UTC at a moment, in milliseconds. */
function offsetOf(zone: string, moment: number): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = formatter(zone).formatToParts(new Date(moment))
  } catch {
    // Not a zone this runtime knows: no moment, rather than a guessed one.
    return NaN
  }
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? NaN)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  )
  return wall - Math.floor(moment / 1000) * 1000
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let made = formatters.get(zone)
  if (!made) {
    made = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, made)
  }
  return made
}

/** A reminder's id: sixteen hex digits from the space, the note, the task's words (their
 *  hash) and the minute. Every device and the Worker make the same one for the same
 *  reminder, so a phone told of one by a push knows the alarm it set for it already;
 *  and editing the words or the time of a task is a new id. FNV-1a, 64 bits: short
 *  enough for a Windows toast's tag, and spread enough that 64 of them never meet. */
export function reminderId(space: string, path: string, hash: string, wall: WallTime): string {
  let value = 0xcbf29ce484222325n
  const key = [space, path, hash, `${wall.date} ${wall.time}`].join('\n')
  for (const byte of new TextEncoder().encode(key)) {
    value ^= BigInt(byte)
    value = (value * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return value.toString(16).padStart(16, '0')
}

/** A task's words as a notification says them: a link as its text, a wikilink as its
 *  name or the words it shows, and the marks of emphasis and code gone. */
export function plainWords(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.replace(/#.*$/, ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}
