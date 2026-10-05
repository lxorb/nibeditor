/** Templates: a note whose words a new note starts from, with Obsidian's core
 *  Templates plugin's placeholders filled in, and a template that makes its own note
 *  on a schedule (docs/tasks.md 5.13).
 *
 *  `{{title}}`, `{{date}}`, `{{time}}` and `{{date:YYYY-MM-DD}}` are Obsidian's;
 *  `{{date+7d}}` (and `-`, with `d`, `w`, `M`, `y`) is nib's, so a project template
 *  can write its tasks' dates relative to the day it is used: `📅 {{date+7d}}`.
 *
 *  A repeating template says `repeat: every Monday` in its front matter. Whoever runs
 *  nib on a day the rule names makes the note; a stretch nib was closed for makes one
 *  note, not one per missed week, with the missed days listed in it. The template
 *  keeps the last day it made a note for in `made:`, which syncs, so two devices agree
 *  on whether this week's is made. Pure: the day and the time come in. */

import { writeProperty } from '@nib/markdown/property-edits'
import { addDays, addMonths, formatDate } from './dates'
import { nextDate, parseRule } from './recurrence'
import type { Value } from './types'

/** What a placeholder is filled with. `time` is `HH:mm`. */
export interface Filling {
  title: string
  today: string
  time: string
}

/** A day moved by `+7d`, `-1w`, `+1M`, `+1y`. */
function shifted(today: string, by: string | undefined): string {
  if (!by) return today
  const found = /^([+-])(\d+)([dwMy])$/.exec(by)
  if (!found) return today
  const amount = Number(found[2]) * (found[1] === '-' ? -1 : 1)
  switch (found[3] ?? 'd') {
    case 'w':
      return addDays(today, amount * 7)
    case 'M':
      return addMonths(today, amount)
    case 'y':
      return addMonths(today, amount * 12)
    default:
      return addDays(today, amount)
  }
}

const PLACEHOLDER = /\{\{\s*(title|date|time)\s*([+-]\d+[dwMy])?\s*(?::([^}]*))?\}\}/g

/** A template's words with every placeholder filled. One it does not know is kept. */
export function fillTemplate(text: string, filling: Filling): string {
  return text.replace(
    PLACEHOLDER,
    (_written, name: string, by: string | undefined, format: string | undefined) => {
      if (name === 'title') return filling.title
      const iso = shifted(filling.today, by)
      const value = { kind: 'date' as const, iso, time: `${filling.time}:00` }
      if (format?.trim()) return formatDate(value, format.trim())
      return name === 'time' ? filling.time : iso
    },
  )
}

/** The front matter keys that are the template's own and never the note's. */
const TEMPLATE_KEYS = ['repeat', 'made', 'folder'] as const

/** A template's words as a note's: its own keys taken off its front matter. */
export function withoutTemplateKeys(text: string): string {
  let out = text
  for (const key of TEMPLATE_KEYS) {
    const edit = writeProperty(out, key, null)
    if (edit) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  // A front matter block left with nothing in it goes too.
  return out.replace(/^---\r?\n---\r?\n(\r?\n)?/, '')
}

/** A day a property holds, as `YYYY-MM-DD`. */
function dayIn(value: Value | undefined): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'date')
    return typeof value.iso === 'string' ? value.iso : null
  return null
}

/** What a repeating template owes on `today`: the day its note is for and the days
 *  it missed before that, oldest first; null when nothing is due. A template that never
 *  made a note starts with the first day its rule names from today on. */
export function repeatDue(
  note: Record<string, Value>,
  today: string,
): { day: string; missed: string[] } | null {
  const said = note.repeat
  if (typeof said !== 'string') return null
  const rule = parseRule(said.replace(/^🔁\s*/u, ''))
  if (!rule) return null
  const made = dayIn(note.made) ?? addDays(today, -1)
  const days: string[] = []
  for (let after = made; days.length < 400;) {
    const next = nextDate(rule, made, after)
    if (next === null || next > today) break
    days.push(next)
    after = next
  }
  const day = days.pop()
  return day === undefined ? null : { day, missed: days }
}
