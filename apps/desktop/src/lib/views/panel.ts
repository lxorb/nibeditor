/** What the Tasks panel lists, with its counts: Inbox, Today and Upcoming as the views
 *  they open answer them, then the projects (every note with open tasks, the most
 *  recently written first) and the labels (every tag on an open task).
 *
 *  Inbox, Today and Upcoming are counted by the engine answering the very bases their
 *  tabs open (`builtinView`), so a number in the panel and the rows behind it can never
 *  disagree. The projects and labels are one pass over the open tasks. Pure: the panel
 *  hands in the rows and the day, and draws the answer. */

import { answer, type Base, builtinView, type Row } from '@nib/bases'
import { contextFor } from './context'

interface Project {
  space: string
  path: string
  name: string
  /** Open tasks in it. */
  count: number
  /** When it was last written, for the order. */
  mtime: number
}

interface Label {
  tag: string
  count: number
}

export interface PanelCounts {
  inbox: number
  today: number
  /** Whether any of Today's tasks are overdue, which turns its count to the danger tone. */
  overdue: boolean
  upcoming: number
  projects: Project[]
  labels: Label[]
}

/** The built-in bases, made once per set of inboxes, so the engine compiles each once
 *  and keeps what it knows about every row between two counts. */
const made = new Map<string, Base>()

function builtin(
  name: 'inbox' | 'today' | 'upcoming',
  inboxes: { space: string; path: string }[],
): Base {
  const key = name === 'inbox' ? `inbox\n${JSON.stringify(inboxes)}` : name
  let base = made.get(key)
  if (!base) {
    base = builtinView(name, { inboxes })
    if (name === 'inbox')
      for (const old of made.keys()) if (old.startsWith('inbox\n')) made.delete(old)
    made.set(key, base)
  }
  return base
}

const isOpen = (row: Row) =>
  row.kind === 'task' && !!row.task && !row.task.done && !row.task.cancelled

/** The panel's lists and counts over these rows, on this day. */
export function panelCounts(
  rows: readonly Row[],
  today: string,
  inboxes: { space: string; path: string }[],
): PanelCounts {
  const context = contextFor({ rows, today, now: `${today}T00:00:00` })
  const todayAnswer = answer(builtin('today', inboxes), 0, rows, context)

  const projects = new Map<string, Project>()
  const labels = new Map<string, number>()
  for (const row of rows) {
    if (!isOpen(row)) continue
    const key = `${row.space}\n${row.path}`
    const project = projects.get(key)
    if (project) project.count++
    else {
      projects.set(key, {
        space: row.space,
        path: row.path,
        name: row.file.basename,
        count: 1,
        mtime: row.file.mtime,
      })
    }
    for (const tag of row.task?.tags ?? []) labels.set(tag, (labels.get(tag) ?? 0) + 1)
  }

  return {
    inbox: answer(builtin('inbox', inboxes), 0, rows, context).total,
    today: todayAnswer.total,
    overdue: todayAnswer.groups.some((group) => group.key === true && group.rows.length > 0),
    upcoming: answer(builtin('upcoming', inboxes), 0, rows, context).total,
    projects: [...projects.values()].sort(
      (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name),
    ),
    labels: [...labels.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  }
}

/** How many projects the panel lists before the rest go under More. */
export const PROJECTS_SHOWN = 7
