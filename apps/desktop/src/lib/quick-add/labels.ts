/** A task's fields said the reader's way, short: what a control and a picker's row show
 *  beside the day (`dayWords` in @nib/editor, which a chip in a note says too): `45
 *  min`, `30 min` before, p1's tone. */

import { dayWords, timeWords } from '@nib/editor/task-days'
import type { Remind } from '@nib/markdown/task-line'
import { t } from '../i18n.svelte'

export { dayWords }

/** Minutes, `45 min` or `1 h 30 min`. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (hours) parts.push(t('{count} h', { count: hours }))
  if (rest || !hours) parts.push(t('{count} min', { count: rest }))
  return parts.join(' ')
}

/** One reminder: `16:00`, `30 min`, `Tomorrow 09:00`. */
export function remindLabel(one: Remind, today: string): string {
  if ('before' in one) return one.before === 0 ? t('At the time') : durationLabel(one.before)
  if ('at' in one) return dayWords(one.at, today, one.time)
  return timeWords(one.time)
}

/** A priority's tone, out of the six (docs/design.md): p1 red, p2 orange, p3 blue,
 *  and none for p4 and the two low ones, which take the colour of whatever they sit in. */
export function priorityTone(priority: number): string | undefined {
  return (
    { 1: 'var(--canvas-1)', 2: 'var(--canvas-2)', 3: 'var(--canvas-5)' } as Record<number, string>
  )[priority]
}
