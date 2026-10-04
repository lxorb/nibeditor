/** The reader's own hands on their to-dos from outside a view: a line added to an
 *  inbox, a box ticked, and Today as rows. What the glasses, the phone's widget and
 *  share sheet, and the AI sidebar's `/tasks` call, so each of them adds and ticks one
 *  way (docs/tasks.md 5.15, 5.18).
 *
 *  An agent's verbs do the same through lib/agents/workspace/tasks.ts, as the agent's
 *  own edits with its caret and its review; these are the reader's, written through the
 *  one write path every replacement in a note takes (`replaceInNotes`, `rows.write`),
 *  so each is one thing to undo and syncs like any other edit. Everything here is
 *  fetched when first asked for, the engine with it: nothing of it is in the first
 *  paint. */

import type { TaskOut } from '@nib/bases/agent'
import { changeOf } from './search/replace'
import { insideSpace } from './space-paths'
import { workspace } from './workspace.svelte'
import { replaceInNotes } from './workspace/note-text'

/** Adds a line of words as a task: to the space's inbox (made the first time), or to
 *  the note and under the heading named. The words may carry the Tasks plugin's own
 *  marks. Answers where it went, or null where no space is open. */
export async function addTask(
  text: string,
  options: { root?: string; note?: string; under?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const root = options.root ?? workspace.activeSpace?.root
  if (root === undefined) return null
  const [{ rows }, { newTask, placeLines }, { taskLine }] = await Promise.all([
    import('./rows/rows.svelte'),
    import('@nib/bases/agent'),
    import('@nib/markdown/task-edits'),
  ])

  const line = taskLine(newTask({ text }))
  const path = options.note ? insideSpace(root, options.note) : await rows.inbox(root)
  if (path === null) return null
  const before = (await workspace.noteText(path)) ?? ''
  const placed = placeLines(before, [line], options.under)
  await replaceInNotes(workspace, [changeOf(path, before, [placed.edit])])
  return { path, line: placed.line }
}

/** Ticks a task, or opens it again, found by its anchor among the rows as they are
 *  now, through the one write path. Answers whether it was found. */
export async function tickTask(at: string, space: string, done: boolean): Promise<boolean> {
  const [{ rows }, { clockOf, findTask, readAt }] = await Promise.all([
    import('./rows/rows.svelte'),
    import('@nib/bases/agent'),
  ])
  const anchor = readAt(at)
  const row = findTask(
    rows.of(space).filter((one) => one.path === anchor.path),
    anchor,
  )
  if (!row) return false
  const completed = done ? clockOf(new Date()).today : null
  return rows.write(row, { task: { done, completed } })
}

/** Today, open tasks for today and overdue, in every space, as the Today view orders
 *  them; or the list a Todoist filter answers. */
export async function listed(filter?: string): Promise<{ total: number; tasks: TaskOut[] }> {
  const [{ rows }, { clockOf, listTasks }] = await Promise.all([
    import('./rows/rows.svelte'),
    import('@nib/bases/agent'),
  ])
  const names = new Set(
    rows
      .of()
      .filter((row) => row.kind === 'note')
      .map((row) => row.file.basename.toLowerCase()),
  )
  return listTasks(
    rows.of(),
    {
      ...(filter ? { filter } : { view: 'today' }),
      inboxes: rows.inboxes(),
      isNote: (name) => names.has(name.toLowerCase()),
    },
    clockOf(new Date()),
  )
}
