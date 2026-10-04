/** A task's fields as the quiet chips after its words, the way the editor draws them
 *  (docs/tasks.md 5.7): the date as a weekday within the week and a short date past
 *  it, red when overdue; the time; ↻ for a repeat; ⏱ and the duration; ⚑ and the
 *  deadline; 🔔 when a reminder is set; the assignee. The priority is the box's colour,
 *  not a chip.
 *
 *  Lane 3 draws the same fields in the editor; the words here are the views' own and
 *  read the same fields, so the two cannot say a task is due on different days. */

import type { TaskRow, Value } from '@nib/bases'
import { amount } from '../i18n.svelte'
import { isDateValue, isDurationValue, isLinkValue } from './values'
import { dayWords } from '@nib/editor/task-days'

export interface Chip {
  kind: 'date' | 'time' | 'repeat' | 'duration' | 'deadline' | 'remind' | 'assignee'
  text: string
  /** A date in the past, drawn in the danger tone. */
  late?: boolean
}

/** Minutes as the views write them: `45m`, `2h`, `1h 30m`. */
function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${amount(rest)}m`
  return rest ? `${amount(hours)}h ${amount(rest)}m` : `${amount(hours)}h`
}

/** The chips one task wears, in the order the editor draws them. `dated` false leaves
 *  the date off, for a view whose groups already are the days (Upcoming, a calendar). */
export function chipsOf(task: TaskRow, today: string, dated = true): Chip[] {
  const out: Chip[] = []
  const day = task.due ?? task.scheduled
  const open = !task.done && !task.cancelled
  if (dated && day) {
    out.push({
      kind: 'date',
      text: dayWords(day, today),
      ...(open && day < today ? { late: true } : {}),
    })
  }
  if (task.time) out.push({ kind: 'time', text: task.time })
  if (task.recurrence) out.push({ kind: 'repeat', text: '↻' })
  if (task.duration !== undefined) out.push({ kind: 'duration', text: minutesText(task.duration) })
  if (task.deadline) {
    out.push({
      kind: 'deadline',
      text: `⚑ ${dayWords(task.deadline, today)}`,
      ...(open && task.deadline < today ? { late: true } : {}),
    })
  }
  if (task.remind.length) out.push({ kind: 'remind', text: '🔔' })
  if (task.assignee) out.push({ kind: 'assignee', text: `+${task.assignee}` })
  return out
}

/** A cell's value as the words it shows. */
export function valueText(value: Value, today: string): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return amount(value)
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (Array.isArray(value))
    return value
      .map((one) => valueText(one, today))
      .filter(Boolean)
      .join(', ')
  if (isDateValue(value)) return dayWords(value.iso, today, value.time?.slice(0, 5))
  if (isDurationValue(value)) return minutesText(Math.round(value.ms / 60_000))
  if (isLinkValue(value))
    return value.display ?? (value.target.split('/').pop() ?? value.target).replace(/\.md$/i, '')
  if ('kind' in value && 'name' in value && typeof value.name === 'string') return value.name
  if ('kind' in value && 'src' in value && typeof value.src === 'string') return value.src
  return ''
}

/** A tone a base names for an option (`tone: warning`, `tone: 3`), as a CSS colour. */
export function toneColour(tone: string | undefined): string | null {
  switch (tone) {
    case undefined:
      return null
    case 'danger':
    case 'red':
    case '1':
      return 'var(--canvas-1)'
    case 'warning':
    case 'orange':
    case '2':
      return 'var(--canvas-2)'
    case 'yellow':
    case '3':
      return 'var(--canvas-3)'
    case 'success':
    case 'green':
    case '4':
      return 'var(--canvas-4)'
    case 'info':
    case 'cyan':
    case '5':
      return 'var(--canvas-5)'
    case 'purple':
    case '6':
      return 'var(--canvas-6)'
    default:
      return null
  }
}
