/** The words the views say: a view's name, a layout's, a group's, a column's, a day's.
 *
 *  Names and counts and nothing else (docs/tasks.md 5.19): a group is called by its
 *  value, a day by the day, a column by its property. The engine's group keys are
 *  values rather than words (Today groups by whether a task is overdue), and this is
 *  where a value becomes what the reader reads, in their language. */

import { groupName, type Value } from '@nib/bases'
import { key, t } from '../i18n.svelte'
import { bare } from './columns'
import { dayWords } from '@nib/editor/task-days'
import type { ChartKind, Measure } from './chart'
import type { Builtin } from './spec'
import { dayIn } from './values'

const BUILTIN_NAMES: Record<Builtin, string> = {
  inbox: key('Inbox'),
  today: key('Today'),
  upcoming: key('Upcoming'),
  logbook: key('Logbook'),
  project: key('Project'),
  label: key('Label'),
}

export const builtinName = (builtin: Builtin): string => t(BUILTIN_NAMES[builtin])

/** Every layout a view can be drawn as, in the order the switch offers them. */
export const LAYOUTS = [
  'list',
  'table',
  'cards',
  'kanban',
  'calendar',
  'timeline',
  'chart',
] as const
export type Layout = (typeof LAYOUTS)[number]

const LAYOUT_NAMES: Record<Layout, string> = {
  list: key('List'),
  table: key('Table'),
  cards: key('Cards'),
  kanban: key('Board'),
  calendar: key('Calendar'),
  timeline: key('Timeline'),
  chart: key('Chart'),
}

/** The layout a view's type draws as: Bases' own names, and `board` read as the
 *  kanban Obsidian 1.14 writes. A type nib has no layout for is drawn as a table, the
 *  way Obsidian falls back for one it does not know. */
export function layoutOf(type: string): Layout {
  if (type === 'board') return 'kanban'
  return LAYOUTS.find((one) => one === type) ?? 'table'
}

export const layoutName = (layout: Layout): string => t(LAYOUT_NAMES[layout])

const STATUS_NAMES: Record<string, string> = {
  ' ': key('To do'),
  '/': key('Doing'),
  x: key('Done'),
  X: key('Done'),
  '-': key('Cancelled'),
}

const FIELD_NAMES: Record<string, string> = {
  'file.name': key('Name'),
  'file.basename': key('Note'),
  'file.path': key('Note'),
  'file.folder': key('Under'),
  'file.mtime': key('Modified'),
  'file.ctime': key('Created'),
  'file.size': key('Size'),
  'file.tags': key('Tags'),
  'file.space': key('Space'),
  'task.text': key('Task'),
  'task.status': key('Status'),
  'task.done': key('Done'),
  'task.due': key('Due'),
  'task.date': key('Date'),
  'task.scheduled': key('Scheduled'),
  'task.start': key('Start'),
  'task.deadline': key('Deadline'),
  'task.time': key('Time'),
  'task.duration': key('Duration'),
  'task.priority': key('Priority'),
  'task.tags': key('Tags'),
  'task.assignee': key('Assignee'),
  'task.section': key('Section'),
  'task.recurrence': key('Repeat'),
  'task.completed': key('Done'),
}

/** What a column is called: the base's display name, nib's word for a field it
 *  knows, else the property's own name. */
export function propertyName(property: string, displayName?: string): string {
  if (displayName) return displayName
  const known = FIELD_NAMES[property]
  if (known) return t(known)
  return bare(property).replace(/^(formula|button)\./, '')
}

/** The words of a priority, `p1` to `p4`; the two low ones Tasks has read as `p5`
 *  and `p6`. A name rather than a word, the way Todoist writes it in every language. */
export const priorityName = (priority: number): string => `p${priority}`

/** What a group of a view is called. */
export function groupLabel(property: string | undefined, value: Value, today: string): string {
  if (property === 'formula.overdue') return value === true ? t('Overdue') : t('Today')
  if (value === null || value === '') return t('None')
  if (property === 'task.status' && typeof value === 'string') {
    const known = STATUS_NAMES[value]
    return known ? t(known) : value
  }
  if (property === 'task.priority' && typeof value === 'number') return priorityName(value)
  if (typeof value === 'boolean') return value ? '✓' : '–'
  const day = dayIn(value)
  if (day !== null && (typeof value !== 'string' || value.length === 10))
    return dayWords(day, today)
  return groupName(value)
}

/** A status character as its word. */
export const statusName = (status: string): string => t(STATUS_NAMES[status] ?? 'To do')

const CHART_NAMES: Record<ChartKind, string> = {
  bar: key('Bars'),
  hbar: key('Bars across'),
  line: key('Line'),
  donut: key('Donut'),
  number: key('A number'),
}

export const chartName = (kind: ChartKind): string => t(CHART_NAMES[kind])

const MEASURE_NAMES: Record<Measure, string> = {
  count: key('Count'),
  sum: key('Sum'),
  average: key('Average'),
  earliest: key('Earliest'),
  latest: key('Latest'),
}

export const measureName = (measure: Measure): string => t(MEASURE_NAMES[measure])

/** Bases' summaries by the names its files write, in the reader's language. */
const SUMMARY_NAMES: Record<string, string> = {
  Average: key('Average'),
  Min: key('Min'),
  Max: key('Max'),
  Sum: key('Sum'),
  Range: key('Range'),
  Median: key('Median'),
  Stddev: key('Stddev'),
  Earliest: key('Earliest'),
  Latest: key('Latest'),
  // A summary counts boxes and values; the app's own `Checked` and `Empty` are a
  // verification and a verb, so these four say what they count.
  Checked: key('Ticked'),
  Unchecked: key('Not ticked'),
  Empty: key('Without a value'),
  Filled: key('With a value'),
  Unique: key('Unique'),
}

/** A summary's name as the reader reads it; a base's own formula is its own name. */
export const summaryName = (name: string): string => {
  const known = SUMMARY_NAMES[name]
  return known ? t(known) : name
}
