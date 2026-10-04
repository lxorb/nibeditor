/** A chip pressed in a note: its field's choices, in the app's own menu at the chip,
 *  out of the same lists quick add offers (pickers.ts), so a day is picked the same way
 *  in a note as in quick add (docs/tasks.md 5.7). What is picked is handed back as the
 *  change to the task, which the editor writes as one edit of the characters that
 *  change. */

import { todayOf } from '@nib/bases'
import type { TaskChange } from '@nib/markdown/task-edits'
import type { TaskFields } from '@nib/markdown/task-line'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry, menu } from '../menu.svelte'
import { dayRows, durationRows, priorityRows, remindRows } from './pickers'

/** The rules a repeat chip offers, in the Tasks plugin's own words. */
const RULES: [string, () => string][] = [
  ['every day', () => t('Every day')],
  ['every weekday', () => t('Every weekday')],
  ['every week', () => t('Every week')],
  ['every month', () => t('Every month')],
  ['every year', () => t('Every year')],
]

function repeatRows(current: string | undefined, set: (rule: string | null) => void): MenuEntry[] {
  return [
    ...RULES.map(([rule, said]) => ({
      label: said(),
      checked: current === rule,
      run: () => set(rule),
    })),
    ...(current ? [DIVIDER, { label: t('Remove'), run: () => set(null) }] : []),
  ]
}

/** The rows for one chip's field. */
function rowsFor(
  field: string,
  fields: TaskFields,
  at: DOMRect,
  change: (change: TaskChange) => void,
): MenuEntry[] {
  const today = todayOf()
  switch (field) {
    case 'date':
      return dayRows(
        fields,
        today,
        (when) => change(when),
        () => at,
      )
    case 'deadline':
      return dayRows(
        { due: fields.deadline },
        today,
        (when) => change({ deadline: when.due }),
        () => at,
        false,
      )
    case 'priority':
      return priorityRows(fields.priority, (priority) => change({ priority }))
    case 'remind':
      return remindRows(fields.remind, fields, today, (remind) => change({ remind }))
    case 'duration':
      return durationRows(fields.duration, (duration) => change({ duration }))
    case 'recurrence':
      return repeatRows(fields.recurrence, (recurrence) => change({ recurrence }))
    default:
      return []
  }
}

/** Shows the field's choices at the chip. */
export function pickField(
  field: string,
  fields: TaskFields,
  at: DOMRect,
  change: (change: TaskChange) => void,
): void {
  const rows = rowsFor(field, fields, at, change)
  if (!rows.length) return
  // The menu opens where a press would have opened it: under the chip's start.
  menu.show(new MouseEvent('contextmenu', { clientX: at.left, clientY: at.bottom }), rows)
}
