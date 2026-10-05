/** The columns of a view: which a view shows when it names none, what each is
 *  called, what a cell of it is edited with, and the change an edit writes.
 *
 *  A column is a property as Bases names one: `file.name`, `note.status` (or a
 *  bare `status`, which is the same), `formula.age`, and nib's `task.*`. Who may
 *  write a cell follows from that name alone, so a table, a card and a board agree:
 *  a note's own property and a task's own field are written through the one write
 *  path, and `file.*` and `formula.*` are what the files and the formulas say. */

import {
  type Base,
  isButton,
  readButtons,
  readReverse,
  type Context,
  type Row,
  type RowKinds,
  type TaskChange,
  type Value,
} from '@nib/bases'
import type { RowChange } from '../rows/write'
import { isLinkValue } from './values'

/** What a cell is edited with. `none` is read-only. */
export type Editor =
  | 'text'
  | 'words'
  | 'number'
  | 'date'
  | 'time'
  | 'duration'
  | 'checkbox'
  | 'list'
  | 'priority'
  | 'status'
  | 'select'
  | 'button'
  | 'none'

/** A property's name without the `note.` Bases lets it go without. */
export function bare(property: string): string {
  return property.startsWith('note.') ? property.slice(5) : property
}

/** Whether a property is a note's own front matter key. */
export function isNoteProperty(property: string): boolean {
  return !/^(file|formula|task|this)\./.test(property)
}

/** The task fields a view's cells write, and the editor each gets. As pairs: a
 *  `duration` key would read, to the motion test, as a transition's. */
const TASK_EDITORS: Partial<Record<string, Editor>> = Object.fromEntries([
  ['text', 'words'],
  ['status', 'status'],
  ['done', 'checkbox'],
  ['due', 'date'],
  ['scheduled', 'date'],
  ['start', 'date'],
  ['deadline', 'date'],
  ['time', 'time'],
  ['duration', 'duration'],
  ['priority', 'priority'],
  ['tags', 'list'],
  ['assignee', 'text'],
] satisfies [string, Editor][])

/** The columns a view shows when it names none. A task view reads like Todoist's
 *  list: the words, where they live, the date and the flag. A note view shows the
 *  name and the first properties its notes have, in the order they first appear. */
export function defaultColumns(kinds: RowKinds, rows: readonly Row[]): string[] {
  if (kinds === 'tasks') return ['task.text', 'file.basename', 'task.due', 'task.priority']

  const seen: string[] = []
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const key of Object.keys(row.note)) {
      if (!seen.includes(key)) seen.push(key)
      if (seen.length >= 5) break
    }
    if (seen.length >= 5) break
  }
  return ['file.name', ...seen.map((key) => `note.${key}`)]
}

/** The columns a view shows: its own order, else the defaults. */
export function columnsOf(base: Base, at: number, rows: readonly Row[]): string[] {
  const view = base.views[at]
  if (view?.order.length) return view.order
  return defaultColumns(view?.nib.rows ?? 'notes', rows)
}

/** The name the base gives a property, if it gives one. */
export function displayName(base: Base, property: string): string | undefined {
  return (base.properties[property] ?? base.properties[bare(property)])?.displayName
}

/** The select options the base gives a note property (`nib.properties`). */
export function optionsOf(base: Base, property: string): string[] {
  return base.nib.properties[bare(property)]?.options?.map((one) => one.value) ?? []
}

/** The tone the base gives one option of a property, if any. */
export function toneOf(base: Base, property: string, value: string): string | undefined {
  return base.nib.properties[bare(property)]?.options?.find((one) => one.value === value)?.tone
}

/** What kind of value a note property holds, read off the rows that have it. */
function noteKind(key: string, rows: readonly Row[]): Editor {
  for (const row of rows) {
    const value = row.note[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') return 'checkbox'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'list'
    if (typeof value === 'object' && 'kind' in value && value.kind === 'date') return 'date'
    return 'text'
  }
  return 'text'
}

/** What a cell of this column is edited with. */
export function editorOf(base: Base, property: string, rows: readonly Row[]): Editor {
  if (property.startsWith('task.')) return TASK_EDITORS[property.slice(5)] ?? 'none'
  if (isButton(property)) return 'button'
  if (!isNoteProperty(property)) return 'none'
  // An id is given, never typed: Notion's ID property cannot be edited either.
  if (base.nib.id?.property === bare(property)) return 'none'
  if (optionsOf(base, property).length) return 'select'
  return noteKind(bare(property), rows)
}

/** The change one cell's new value writes, or null where the column is not one a
 *  row can be written through (a file's name, a formula), or the row has no such
 *  field (a note row under a task column). */
export function changeOf(row: Row, property: string, value: Value | null): RowChange | null {
  if (property.startsWith('task.')) {
    if (row.kind !== 'task') return null
    const field = property.slice(5)
    if (!(field in TASK_EDITORS)) return null
    // Each editor in TASK_EDITORS hands back the shape its field holds (a date as
    // its ISO day, a priority as its number, tags as words), so the field and the
    // value agree by construction rather than by type.
    const task: TaskChange = { [field]: value }
    return { task }
  }
  if (!isNoteProperty(property)) return null
  return { note: { [bare(property)]: value } }
}

const TASK_FIELDS = [
  'task.text',
  'task.status',
  'task.due',
  'task.scheduled',
  'task.start',
  'task.deadline',
  'task.time',
  'task.duration',
  'task.priority',
  'task.tags',
  'task.assignee',
  'task.section',
  'task.recurrence',
  'task.completed',
]

const FILE_FIELDS = [
  'file.name',
  'file.basename',
  'file.folder',
  'file.tags',
  'file.mtime',
  'file.ctime',
  'file.size',
  'file.space',
]

/** Every property a picker offers for a view: a task's fields where the view has tasks,
 *  the files' own, every front matter key its rows have, and the base's formulas. */
export function knownProperties(base: Base, kinds: RowKinds, rows: readonly Row[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    if (kinds === 'tasks' && row.kind !== 'task') continue
    for (const key of Object.keys(row.note)) keys.add(`note.${key}`)
    if (keys.size > 200) break
  }
  return [
    ...(kinds === 'notes' ? [] : TASK_FIELDS),
    ...FILE_FIELDS,
    ...[...keys].sort(),
    ...Object.keys(base.formulas).map((name) => `formula.${name}`),
    ...readButtons(base).map((button) => `button.${button.name}`),
  ]
}

/** How the base says a property's value is shown (`nib.properties.<key>.format`). */
export function formatOf(base: Base, property: string): string | undefined {
  const key = property.startsWith('formula.') ? property.slice(8) : bare(property)
  return base.nib.properties[key]?.format
}

/** Whether a value is a link, or a list holding one. */
function holdsLink(value: Value | undefined): boolean {
  if (Array.isArray(value)) return value.some(holdsLink)
  return isLinkValue(value)
}

/** The note properties of these rows that hold links: the relations a rollup can start
 *  from. */
export function relationsOf(rows: readonly Row[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const [key, value] of Object.entries(row.note)) if (holdsLink(value)) keys.add(key)
  }
  return [...keys].sort().map((key) => `note.${key}`)
}

/** A relation another set of notes holds to this view's rows, which a reverse column
 *  shows: the property, and what the column is called (the linking notes' folder, as
 *  Notion names the reverse after the other database). */
export interface ReverseOffer {
  property: string
  name: string
}

/** Every property of the space's notes whose links point at a row of the view, but the
 *  ones the base already shows back. */
export function reverseOffers(
  base: Base,
  shown: readonly Row[],
  all: readonly Row[],
  context: Context,
): ReverseOffer[] {
  const keyOf = (space: string, path: string) => `${space}\n${path}`
  const here = new Set(shown.map((row) => keyOf(row.space, row.path)))
  const taken = new Set(Object.values(base.formulas).flatMap((source) => readReverse(source) ?? []))
  const found = new Map<string, string>()
  for (const row of all) {
    if (row.kind !== 'note') continue
    for (const [key, value] of Object.entries(row.note)) {
      if (found.has(key) || taken.has(key) || !holdsLink(value)) continue
      const targets = (Array.isArray(value) ? value : [value]).flatMap((one) =>
        isLinkValue(one) ? [one.target] : [],
      )
      const points = targets.some((target) => {
        const path = context.resolve?.(target, row)
        return path != null && here.has(keyOf(row.space, path))
      })
      if (points) found.set(key, row.file.folder.split('/').pop() ?? key)
    }
  }
  return [...found].map(([property, name]) => ({ property, name: name || property }))
}
