/** Where a plan goes on each kind of device, and how the page rings what nothing else
 *  will (docs/tasks.md 5.10).
 *
 *  A desktop hands it to the crate, which puts it on Windows' or a Mac's own schedule
 *  and says no on Linux. A phone hands it to the activity, which sets the alarms
 *  (Reminders.kt). The browser build has nothing that rings with the tab closed but the
 *  Worker's push, so the page rings while it is open. */

import { t } from '../i18n.svelte'
import { frameWord, method } from '../mobile/bridge'
import { notify } from '../notify'
import { parsed } from '../stored'
import { invoke, isDesktop } from '../tauri'
import type { Reminder } from './plan'
import { type Pressed, pressOf } from './presses'

/** The minutes from a moment to nine the next morning, on this machine's clock: what
 *  "tomorrow" snoozes a reminder by. */
function untilTomorrow(at: number): number {
  const day = new Date(at)
  const nine = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 9, 0)
  return Math.max(1, Math.round((nine.getTime() - at) / 60_000))
}

/** The buttons' words, in the reader's language. */
function words() {
  return {
    done: t('Done'),
    snooze: t('Snooze'),
    minutes: t('{count} min', { count: 15 }),
    hour: t('{count} min', { count: 60 }),
    tomorrow: t('Tomorrow'),
    channel: t('Reminders'),
  }
}

/** Hands the whole plan to whatever rings with nib closed. Answers whether anything
 *  does. */
export async function hand(plan: readonly Reminder[]): Promise<boolean> {
  const reminders = plan.map((one) => ({ ...one, tomorrow: untilTomorrow(one.at) }))

  if (isDesktop) return invoke<boolean>('reminders_set', { reminders, words: words() })

  const alarms = method('reminders')
  if (alarms) {
    alarms(await frameWord(), JSON.stringify({ reminders, words: words() }))
    return true
  }
  return false
}

/** Shows one reminder the page rang itself, and answers a press on it with `opened`. */
export function show(one: Reminder, opened: (press: Pressed) => void) {
  notify(one.title, one.body, one.id, () => {
    opened({ act: 'open', space: one.space, path: one.path, hash: one.hash, line: one.line })
  })
}

/** The presses waiting for the page: the crate's on a desktop, the activity's on a
 *  phone. Each is handed over once. */
export async function taken(): Promise<Pressed[]> {
  let said: unknown = []
  if (isDesktop) said = await invoke<unknown>('reminders_taken').catch(() => [])
  else {
    const take = method('remindersTaken')
    if (take) said = parsed(take())
  }
  return Array.isArray(said) ? said.map(pressOf).filter((one) => one !== null) : []
}
