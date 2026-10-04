/** The rows a task's field is picked from, for somebody who would rather click than
 *  type: a day, a priority, a reminder, a duration, a note. One list each, drawn by
 *  quick add's own popover and by the menu a chip in a note opens, so a day is picked
 *  the same way everywhere (docs/tasks.md 5.6, 5.7).
 *
 *  Rows of `menu-item.ts`, which every list in the app shares; each row hands its
 *  answer to `set` and nothing else. A day nobody has a row for is the system's own
 *  calendar (`askNative`), as a date property's field is. */

import { addDays, weekday } from '@nib/bases'
import type { Priority, Remind } from '@nib/markdown/task-line'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { dayWords, durationLabel, remindLabel } from './labels'

/** A day and a time, or neither. */
export interface When {
  due?: string | undefined
  time?: string | undefined
}

/** The coming Monday, never today: Todoist's `next week`. */
const nextMonday = (today: string) => addDays(today, (8 - weekday(today)) % 7 || 7)

/** The coming Saturday, today counted. */
const weekendOf = (today: string) => addDays(today, (6 - weekday(today) + 7) % 7)

/** A field of the system's own, opened over `anchor` and answered with what was picked:
 *  `YYYY-MM-DD` or `HH:MM`, or null where it was put away. */
function askNative(
  type: 'date' | 'time',
  value: string | undefined,
  anchor: DOMRect,
): Promise<string | null> {
  return new Promise((resolve) => {
    const field = document.createElement('input')
    field.type = type
    field.value = value ?? ''
    field.tabIndex = -1
    field.setAttribute('aria-hidden', 'true')
    Object.assign(field.style, {
      position: 'fixed',
      left: `${anchor.left}px`,
      top: `${anchor.bottom}px`,
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.append(field)
    let settled = false
    const done = (answer: string | null) => {
      if (settled) return
      settled = true
      field.remove()
      resolve(answer)
    }
    field.addEventListener('change', () => done(field.value || null))
    field.addEventListener('blur', () => done(null))
    field.addEventListener('cancel', () => done(null))
    try {
      field.showPicker()
    } catch {
      // A webview without the system's picker answers nothing rather than throwing
      // at whoever asked; the row simply did not pick.
      done(null)
    }
  })
}

/** The day rows: today, tomorrow, next week, the weekend, any day, a time, none. */
export function dayRows(
  current: When,
  today: string,
  set: (when: { due: string | null; time?: string | null }) => void,
  anchor: () => DOMRect,
  /** Whether a time can be set as well: a deadline is a day. */
  timed = true,
): MenuEntry[] {
  const day = (due: string) => ({
    label: dayWords(due, today),
    checked: current.due === due,
    run: () => set({ due }),
  })
  // The weekend is left out where it is today or tomorrow, which already have a row.
  const weekend = weekendOf(today)
  return [
    day(today),
    day(addDays(today, 1)),
    ...(weekend > addDays(today, 1) ? [day(weekend)] : []),
    { ...day(nextMonday(today)), label: t('Next week') },
    DIVIDER,
    {
      label: t('Pick a date…'),
      asks: true,
      run: () => void askNative('date', current.due, anchor()).then((due) => due && set({ due })),
    },
    ...(timed
      ? [
          {
            label: t('Set a time…'),
            asks: true,
            run: () =>
              void askNative('time', current.time, anchor()).then(
                (time) => time && set({ due: current.due ?? today, time }),
              ),
          },
        ]
      : []),
    ...(current.due
      ? [DIVIDER, { label: t('No date'), run: () => set({ due: null, time: null }) }]
      : []),
  ]
}

/** p1 to p4, in the priorities' own tones. */
export function priorityRows(current: Priority, set: (priority: Priority) => void): MenuEntry[] {
  return ([1, 2, 3, 4] as const).map((level) => ({
    label: t('Priority {level}', { level }),
    checked: current === level,
    run: () => set(level),
  }))
}

/** Reminders: at the time and before it where there is a time, a morning otherwise. */
export function remindRows(
  current: readonly Remind[],
  when: When,
  today: string,
  set: (remind: Remind[]) => void,
): MenuEntry[] {
  const has = (one: Remind) => current.some((held) => JSON.stringify(held) === JSON.stringify(one))
  const toggle = (one: Remind) => ({
    label: remindLabel(one, today),
    checked: has(one),
    run: () =>
      set(
        has(one)
          ? current.filter((held) => JSON.stringify(held) !== JSON.stringify(one))
          : [...current, one],
      ),
  })
  const timed: Remind[] = when.time
    ? [{ before: 0 }, { before: 15 }, { before: 30 }, { before: 60 }]
    : [{ time: '09:00' }]
  const morning: Remind = { at: addDays(when.due ?? today, when.due ? -1 : 1), time: '09:00' }
  return [
    ...timed.map(toggle),
    toggle(morning),
    ...(current.length ? [DIVIDER, { label: t('Remove'), run: () => set([]) }] : []),
  ]
}

/** How long it takes. */
export function durationRows(
  current: number | undefined,
  set: (minutes: number | null) => void,
): MenuEntry[] {
  return [
    ...[15, 30, 45, 60, 90, 120].map((minutes) => ({
      label: durationLabel(minutes),
      checked: current === minutes,
      run: () => set(minutes),
    })),
    ...(current === undefined ? [] : [DIVIDER, { label: t('Remove'), run: () => set(null) }]),
  ]
}

/** Where it lands: the inbox, then the notes offered, by name. */
export function whereRows(
  current: string | undefined,
  notes: readonly string[],
  set: (note: string | undefined) => void,
): MenuEntry[] {
  return [
    { label: t('Inbox'), checked: current === undefined, run: () => set(undefined) },
    ...(notes.length ? [DIVIDER] : []),
    ...notes.map((note) => ({
      label: note.split('/').at(-1) ?? note,
      checked: current?.toLowerCase() === note.toLowerCase(),
      run: () => set(note),
    })),
  ]
}
