/** Todoist, brought over whole (docs/tasks.md 5.17): from the account through its API
 *  with a token the reader pastes, or from a project's CSV export and a backup's zip of
 *  them.
 *
 *  What becomes what: a project a note (a project inside another one a note in that
 *  one's folder), a section a heading, a task a line in the Tasks plugin's format with
 *  its sub-tasks indented under it, its description and comments indented under it
 *  with their dates, a label a tag, a priority its emoji (the API counts 4 as p1, which
 *  is turned round here; the CSV counts as people do), the due date and its time, a
 *  recurrence read again by the Tasks plugin's grammar (and kept as words under the
 *  task where it cannot be read), the deadline, the duration, the reminders, the
 *  assignee by name, and the Inbox the space's inbox where the space has none yet.
 *  Done tasks, when asked for, come as done lines with their dates.
 *
 *  The token is a parameter and never more: nothing here keeps it, and nothing past the
 *  read holds it. The reading is two halves, so a test hands over a recorded answer:
 *  the API's pages or the CSV become `Account`, and `planOf` writes the notes. */

import { parseRule, ruleText } from '@nib/bases'
import { taskLine } from '@nib/markdown/task-edits'
import { NO_PRIORITY, type Priority, type Remind, type TaskFields } from '@nib/markdown/task-line'
import { key } from '../i18n.svelte'
import { readCsv } from './csv'
import { safeName } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** One project, as both halves read it. */
export interface Project {
  id: string
  name: string
  parent?: string
  inbox: boolean
}

export interface Section {
  id: string
  project: string
  name: string
  order: number
}

export interface Comment {
  text: string
  /** `YYYY-MM-DD`, where it was dated. */
  at?: string
}

export interface Task {
  id: string
  project: string
  section?: string
  parent?: string
  text: string
  description: string
  /** p1 to p4, as people count. */
  priority: Priority
  due?: string
  time?: string
  zone?: string
  /** The rule as Todoist wrote it, read again on the way out. */
  repeats?: string
  deadline?: string
  /** Minutes. */
  duration?: number
  labels: string[]
  order: number
  done?: string
  assignee?: string
  remind: Remind[]
  comments: Comment[]
}

/** An account, or a set of exports, read. */
export interface Account {
  projects: Project[]
  sections: Section[]
  tasks: Task[]
}

// ---- the notes -----------------------------------------------------------------------

/** A label as a tag: what a tag may hold, spaces as dashes. */
export function tagOf(label: string): string {
  return label
    .trim()
    .replace(/^[@#]/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
}

/** Todoist's rule in the words the Tasks plugin reads, or null where it reads none:
 *  `every!` is `when done`, `every other` is every two, a workday a weekday. */
export function ruleOf(written: string): string | null {
  const said = written
    .trim()
    .toLowerCase()
    .replace(/^every other (day|week|month|year)$/, 'every 2 $1s')
    .replace(/\bevery (?:work ?day|weekday)s?\b/, 'every weekday')
    .replace(/\b(starting|from) .*$/, '')
    .trim()
  const rule = parseRule(said)
  return rule ? ruleText(rule) : null
}

/** One task's lines: the line, its description and its comments under it, then its
 *  sub-tasks, each a level further in. */
function linesOf(
  task: Task,
  children: ReadonlyMap<string, Task[]>,
  depth: number,
  kept: Kept,
): string[] {
  const pad = '  '.repeat(depth)
  const rule = task.repeats ? ruleOf(task.repeats) : null
  if (task.repeats && !rule) kept.words += 1

  const fields: TaskFields = {
    text: task.text.replace(/(^|\s)@([\p{L}\p{N}_/-]+)/gu, '$1#$2'),
    status: task.done ? 'x' : ' ',
    done: !!task.done,
    cancelled: false,
    remind: task.remind,
    priority: task.priority,
    tags: task.labels.map(tagOf).filter(Boolean),
    dependsOn: [],
    fields: {},
    ...(task.due ? { due: task.due } : {}),
    ...(task.time ? { time: task.time } : {}),
    ...(task.zone ? { zone: task.zone } : {}),
    ...(rule ? { recurrence: rule } : {}),
    ...(task.deadline ? { deadline: task.deadline } : {}),
    ...(task.duration ? { duration: task.duration } : {}),
    ...(task.assignee ? { assignee: task.assignee } : {}),
    ...(task.done ? { completed: task.done } : {}),
  }
  const under = `${pad}  `
  const lines = [taskLine(fields, `${pad}- `)]
  for (const line of task.description.split(/\r?\n/))
    if (line.trim()) lines.push(`${under}${line.trimEnd()}`)
  if (task.repeats && !rule) lines.push(`${under}Todoist: ${task.repeats}`)
  for (const comment of task.comments) {
    const [first = '', ...rest] = comment.text.split(/\r?\n/)
    lines.push(`${under}${comment.at ? `${comment.at}: ` : ''}${first.trimEnd()}`)
    for (const line of rest) if (line.trim()) lines.push(`${under}${line.trimEnd()}`)
  }
  for (const child of children.get(task.id) ?? [])
    lines.push(...linesOf(child, children, depth + 1, kept))
  return lines
}

interface Kept {
  words: number
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order

/** The notes an account makes: a note a project, in its parent's folder. */
export function planOf(account: Account): ImportPlan & { inbox?: string } {
  const kept: Kept = { words: 0 }
  const projects = new Map(account.projects.map((one) => [one.id, one]))
  const pathOf = (project: Project, seen = new Set<string>()): string => {
    const parent = project.parent ? projects.get(project.parent) : undefined
    const name = safeName(project.name) || 'Todoist'
    if (!parent || seen.has(parent.id)) return name
    seen.add(project.id)
    return `${pathOf(parent, seen)}/${name}`
  }

  const children = new Map<string, Task[]>()
  for (const task of account.tasks) {
    if (!task.parent) continue
    children.set(task.parent, [...(children.get(task.parent) ?? []), task])
  }
  for (const list of children.values()) list.sort(byOrder)
  const known = new Set(account.tasks.map((one) => one.id))
  const top = account.tasks.filter((one) => !one.parent || !known.has(one.parent)).sort(byOrder)

  const files: Planned[] = []
  let inbox: string | undefined
  for (const project of account.projects) {
    const own = top.filter((one) => one.project === project.id)
    const sections = account.sections.filter((one) => one.project === project.id).sort(byOrder)
    const lines: string[] = []
    for (const task of own.filter(
      (one) => !one.section || !sections.some((section) => section.id === one.section),
    )) {
      lines.push(...linesOf(task, children, 0, kept))
    }
    for (const section of sections) {
      if (lines.length) lines.push('')
      lines.push(`## ${section.name.trim()}`, '')
      for (const task of own.filter((one) => one.section === section.id))
        lines.push(...linesOf(task, children, 0, kept))
    }
    const path = `${pathOf(project)}.md`
    if (project.inbox) inbox = path
    files.push({ kind: 'note', path, text: lines.length ? `${lines.join('\n')}\n` : '' })
  }

  const lost: Lost[] = kept.words ? [{ text: WORDS, one: WORD, values: { count: kept.words } }] : []
  return { format: 'todoist', files, lost, ...(inbox ? { inbox } : {}) }
}

const WORDS = key('{count} repeating dates kept as words under their tasks')
const WORD = key('{count} repeating date kept as words under its task')

// ---- the CSV -------------------------------------------------------------------------

/** The columns every Todoist CSV starts with, which is how one is known. */
const HEADER = ['TYPE', 'CONTENT', 'DESCRIPTION', 'PRIORITY', 'INDENT']

/** Whether a file is a Todoist CSV: its header says so. */
export function isTodoistCsv(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const columns = first.split(',').map((one) => one.trim().replace(/^"|"$/g, '').toUpperCase())
  return HEADER.every((name, at) => columns[at] === name)
}

/** A date as a CSV writes it, where it is a date: `2026-10-06`, `2026-10-06 16:00`. */
function csvDate(said: string): { due: string; time?: string } | null {
  const found = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(said.trim())
  if (!found?.[1]) return null
  return found[2]
    ? { due: found[1], time: `${found[2].padStart(2, '0')}:${found[3] ?? '00'}` }
    : { due: found[1] }
}

/** A person as the CSV names one, `Lucile (14781400)`, by their name. */
const personOf = (said: string) => said.replace(/\s*\(\d+\)\s*$/, '').trim()

/** One CSV: a project. Its tasks nest by INDENT, a section starts a heading, and a
 *  note row is a comment of the task above it. */
export function csvProject(name: string, text: string, at: number): Account {
  const project: Project = { id: `csv-${at}`, name, inbox: /^inbox$/i.test(name) }
  const sections: Section[] = []
  const tasks: Task[] = []
  const [header = [], ...rows] = readCsv(text)
  const column = (row: readonly string[], named: string) => row[header.indexOf(named)]?.trim() ?? ''
  const open: Task[] = []
  let section: string | undefined

  rows.forEach((row, index) => {
    const type = column(row, 'TYPE').toLowerCase()
    if (type === 'section') {
      section = `${project.id}-s${index}`
      sections.push({
        id: section,
        project: project.id,
        name: column(row, 'CONTENT'),
        order: index,
      })
      open.length = 0
      return
    }
    if (type === 'note') {
      open.at(-1)?.comments.push({ text: column(row, 'CONTENT') })
      return
    }
    if (type !== 'task') return

    const indent = Math.max(1, Number(column(row, 'INDENT')) || 1)
    open.length = Math.min(open.length, indent - 1)
    const parent = open.at(-1)
    const priority = Number(column(row, 'PRIORITY'))
    const date = column(row, 'DATE')
    const when = csvDate(date)
    const minutes = Number(column(row, 'DURATION'))
    const deadline = csvDate(column(row, 'DEADLINE'))
    const assignee = personOf(column(row, 'RESPONSIBLE'))
    const task: Task = {
      id: `${project.id}-t${index}`,
      project: project.id,
      ...(section ? { section } : {}),
      ...(parent ? { parent: parent.id } : {}),
      text: column(row, 'CONTENT'),
      description: column(row, 'DESCRIPTION'),
      priority: priority >= 1 && priority <= 4 ? (priority as Priority) : NO_PRIORITY,
      ...(when ?? {}),
      ...(date && !when ? { repeats: date } : {}),
      ...(deadline ? { deadline: deadline.due } : {}),
      ...(minutes > 0 ? { duration: minutes } : {}),
      ...(assignee ? { assignee } : {}),
      labels: [],
      order: index,
      remind: [],
      comments: [],
    }
    tasks.push(task)
    open.push(task)
  })
  return { projects: [project], sections, tasks }
}

/** Every Todoist CSV among the files, each a project named after its file (a
 *  backup's `Work [2203306141].csv` is the project Work). */
export async function readTodoistFiles(
  sources: readonly Source[],
): Promise<ImportPlan & { inbox?: string }> {
  const account: Account = { projects: [], sections: [], tasks: [] }
  let at = 0
  for (const source of sources) {
    if (!/\.csv$/i.test(source.path)) continue
    const text = await source.text()
    if (!isTodoistCsv(text)) continue
    const name = (source.path.split('/').pop() ?? source.path)
      .replace(/\.csv$/i, '')
      .replace(/\s*\[\d+\]$/, '')
    const one = csvProject(name, text, at++)
    account.projects.push(...one.projects)
    account.sections.push(...one.sections)
    account.tasks.push(...one.tasks)
  }
  return planOf(account)
}

// ---- the API -------------------------------------------------------------------------

const API = 'https://api.todoist.com/api/v1'

/** What a fetch needs to be, so a test hands over a recorded answer. */
export type Fetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const id = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

/** Every page of one list. */
async function pages(get: Fetch, token: string, path: string, list = 'results'): Promise<Json[]> {
  const out: Json[] = []
  let cursor: string | null = null
  for (let page = 0; page < 500; page++) {
    const join = path.includes('?') ? '&' : '?'
    const url = `${API}${path}${join}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await get(url, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401 || response.status === 403) throw new Error(REFUSED)
    if (!response.ok) throw new Error(UNREACHABLE)
    const said = await response.json()
    const rows = isRecord(said) ? said[list] : null
    if (Array.isArray(rows)) out.push(...rows.filter(isRecord))
    cursor = isRecord(said) && typeof said.next_cursor === 'string' ? said.next_cursor : null
    if (!cursor) break
  }
  return out
}

const REFUSED = key('Todoist did not take that token.')
const UNREACHABLE = key('Todoist could not be reached.')

/** A due date as the API says one: the day, and the time and zone of a timed one. */
function dueOf(due: unknown): Pick<Task, 'due' | 'time' | 'zone' | 'repeats'> {
  if (!isRecord(due)) return {}
  const date = text(due.date)
  const day = date.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return {}
  const repeats = due.is_recurring === true && text(due.string) ? { repeats: text(due.string) } : {}
  const clock = /T(\d{2}):(\d{2})/.exec(date)
  if (!clock) return { due: day, ...repeats }

  const zone = text(due.timezone)
  if (date.endsWith('Z') && zone) {
    // A fixed time is said in UTC with the zone it was set in: written as that zone's
    // wall clock and the zone after it, as nib writes a time that does not float.
    const local = wallClock(new Date(date), zone)
    if (local) return { due: local.day, time: local.time, zone, ...repeats }
  }
  return { due: day, time: `${clock[1]}:${clock[2]}`, ...repeats }
}

/** A moment as a zone's wall clock. */
function wallClock(moment: Date, zone: string): { day: string; time: string } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(moment)
        .map((part) => [part.type, part.value]),
    )
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    }
  } catch {
    // A zone this engine does not know: the time floats instead.
    return null
  }
}

/** A task as the API answers it. */
function taskOf(
  row: Json,
  people: ReadonlyMap<string, string>,
  remind: Remind[],
  comments: Comment[],
): Task {
  const priority = Number(row.priority)
  const deadline = isRecord(row.deadline) ? text(row.deadline.date).slice(0, 10) : ''
  const duration = isRecord(row.duration)
    ? Number(row.duration.amount) * (text(row.duration.unit) === 'day' ? 1440 : 1)
    : 0
  const assignee = people.get(id(row.responsible_uid))
  const done = text(row.completed_at).slice(0, 10)
  return {
    id: id(row.id),
    project: id(row.project_id),
    ...(id(row.section_id) ? { section: id(row.section_id) } : {}),
    ...(id(row.parent_id) ? { parent: id(row.parent_id) } : {}),
    text: text(row.content),
    description: text(row.description),
    // The API counts 4 as the most urgent; people count it as p1.
    priority: priority >= 1 && priority <= 4 ? ((5 - priority) as Priority) : NO_PRIORITY,
    ...dueOf(row.due),
    ...(deadline ? { deadline } : {}),
    ...(duration > 0 ? { duration } : {}),
    labels: Array.isArray(row.labels) ? row.labels.map(text).filter(Boolean) : [],
    order: Number(row.child_order) || 0,
    ...(row.checked === true && done ? { done } : {}),
    ...(assignee ? { assignee } : {}),
    remind,
    comments,
  }
}

/** A reminder as the API answers one: some minutes before, or a moment. */
function remindOf(row: Json): Remind | null {
  if (text(row.type) === 'relative' && typeof row.minute_offset === 'number')
    return { before: row.minute_offset }
  const at = isRecord(row.due) ? text(row.due.date) : ''
  const found = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at)
  return found?.[1] && found[2] ? { at: found[1], time: found[2] } : null
}

/** A comment, with an attachment as a link to it. */
function commentOf(row: Json): Comment {
  const file = isRecord(row.file_attachment) ? row.file_attachment : null
  const link =
    file && text(file.file_url)
      ? ` [${text(file.file_name) || 'file'}](${text(file.file_url)})`
      : ''
  const at = text(row.posted_at).slice(0, 10)
  return { text: `${text(row.content)}${link}`.trim(), ...(at ? { at } : {}) }
}

export interface ApiOptions {
  /** The last three months of done tasks too, the most the API answers. */
  completed?: boolean
  now?: Date
}

/** The whole account, read once with the token handed in. */
export async function readTodoistAccount(
  get: Fetch,
  token: string,
  options: ApiOptions = {},
): Promise<Account> {
  const [projects, sections, open, reminders] = await Promise.all([
    pages(get, token, '/projects'),
    pages(get, token, '/sections'),
    pages(get, token, '/tasks'),
    pages(get, token, '/reminders').catch(() => [] as Json[]),
  ])

  let done: Json[] = []
  if (options.completed) {
    const until = options.now ?? new Date()
    const since = new Date(until.getTime() - 89 * 86_400_000)
    done = await pages(
      get,
      token,
      `/tasks/completed/by_completion_date?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`,
      'items',
    )
  }

  const people = new Map<string, string>()
  for (const project of projects.filter((one) => one.is_shared === true)) {
    for (const person of await pages(get, token, `/projects/${id(project.id)}/collaborators`).catch(
      () => [] as Json[],
    )) {
      people.set(id(person.id), text(person.name) || text(person.email))
    }
  }

  const remindOfTask = new Map<string, Remind[]>()
  for (const row of reminders) {
    const one = remindOf(row)
    if (one) remindOfTask.set(id(row.item_id), [...(remindOfTask.get(id(row.item_id)) ?? []), one])
  }

  const tasks: Task[] = []
  for (const row of [...open, ...done]) {
    const comments =
      Number(row.note_count) > 0
        ? (await pages(get, token, `/comments?task_id=${encodeURIComponent(id(row.id))}`)).map(
            commentOf,
          )
        : []
    tasks.push(taskOf(row, people, remindOfTask.get(id(row.id)) ?? [], comments))
  }

  return {
    projects: projects
      .filter((one) => one.is_archived !== true && one.is_deleted !== true)
      .map((one) => ({
        id: id(one.id),
        name: text(one.name),
        ...(id(one.parent_id) ? { parent: id(one.parent_id) } : {}),
        inbox: one.inbox_project === true || one.is_inbox_project === true,
      })),
    sections: sections
      .filter((one) => one.is_archived !== true && one.is_deleted !== true)
      .map((one) => ({
        id: id(one.id),
        project: id(one.project_id),
        name: text(one.name),
        order: Number(one.section_order) || 0,
      })),
    tasks,
  }
}
