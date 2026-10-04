/** Which reminders a device holds: the next ones across every space, as moments.
 *
 *  Pure, over the rows (docs/tasks.md 5.10). A reminder is a task's anchor plus the
 *  minute it rings, and its id is made from exactly that, so editing the words or the
 *  time of a task gives a new id and drops the old one, ticking or deleting it drops
 *  both, and handing the same plan twice changes nothing anywhere. The next 64 are
 *  kept, which is the most iOS holds for an app and plenty everywhere else; the list
 *  moves on as each one passes. */

import type { Row } from '@nib/bases'
import { momentOf, plainWords, reminderId, remindTimes } from '@nib/markdown/task-reminders'

/** How many reminders a device holds at once. */
export const MOST = 64

/** One reminder as every platform is handed it. */
export interface Reminder {
  /** Sixteen hex digits from the space, the note, the task's words and the minute. */
  id: string
  /** Milliseconds since the epoch. */
  at: number
  /** The task's words, as a person reads them. */
  title: string
  /** The note it is in, by name. */
  body: string
  /** Where the task is: the space by name, the note relative to it, the words' hash
   *  and the line it was last seen on. What Done and a press find it again by. */
  space: string
  path: string
  hash: string
  line: number
}

/** The next reminders after `now`, earliest first. `auto` is the automatic reminder's
 *  minutes before a task's time, or null where it is off. */
export function plan(
  rows: readonly Row[],
  now: number,
  auto: number | null,
  most = MOST,
): Reminder[] {
  const found: Reminder[] = []
  for (const row of rows) {
    const task = row.task
    if (row.kind !== 'task' || !task || !row.anchor) continue

    for (const wall of remindTimes(task, auto)) {
      const at = momentOf(wall)
      if (!(at > now)) continue
      found.push({
        id: reminderId(row.space, row.path, row.anchor.hash, wall),
        at,
        title: plainWords(task.text),
        body: row.file.basename,
        space: row.space,
        path: row.path,
        hash: row.anchor.hash,
        line: row.anchor.line,
      })
    }
  }

  found.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  return found.slice(0, most)
}

/** Whether two plans would ring the same reminders at the same moments. */
export function samePlan(a: readonly Reminder[], b: readonly Reminder[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, at) => one.id === b[at]?.id && one.at === b[at].at && one.title === b[at].title)
  )
}
