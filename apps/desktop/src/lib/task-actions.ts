/** The reader's own hands on their to-dos from outside a view: a line added to an
 *  inbox, a box ticked, and Today as rows. What the glasses, the phone's widget and
 *  share sheet, and the AI sidebar's `/tasks` call, so each of them adds and ticks one
 *  way (docs/tasks.md 5.15, 5.18).
 *
 *  An agent's verbs do the same through lib/agents/workspace/tasks.ts, as the agent's
 *  own edits with its caret and its review; these are the reader's, written the way
 *  quick add writes (quick-add/write.ts) and through the road every replacement in a
 *  note takes (`replaceInNotes`), so each is one thing to undo and syncs like any other
 *  edit. Everything here is fetched when first asked for: nothing of it is in the first
 *  paint, and the glasses carry the add and the tick but not the list. */

import type { TaskOut } from '@nib/bases/tasks'
import { changeOf } from './search/replace'
import { insideSpace } from './space-paths'
import { workspace } from './workspace.svelte'
import { replaceInNotes } from './workspace/note-text'

/** Adds a line of words as a task, read the way quick add reads them (`tomorrow 4pm
 *  p1 >Note /Heading`) in the reader's language, and written the way quick add writes
 *  one: to the note the words name, else the space's inbox, made the first time
 *  (quick-add/write.ts). Answers where it went, or null where it went nowhere. */
export async function addTask(
  text: string,
  options: { root?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const said = text.trim()
  if (!said) return null
  const [{ parseQuickAdd }, { i18n }, write] = await Promise.all([
    import('@nib/bases/language'),
    import('./i18n.svelte'),
    import('./quick-add/write'),
  ])
  const root = options.root ?? workspace.activeSpace?.root
  if (root === undefined) return null
  const read = parseQuickAdd(said, [i18n.language], new Date(), { notes: write.noteNames(root) })
  return write.addTask(
    {
      text: read.text || said,
      fields: read.fields,
      ...(read.note === undefined ? {} : { note: read.note }),
      ...(read.heading === undefined ? {} : { heading: read.heading }),
    },
    { root },
  )
}

/** Ticks a task, or opens it again, as the Tasks plugin does: the done date, its open
 *  sub-tasks, and a recurring task's next line written above it, all one edit of the
 *  note and one undo (`editedTask`). Found by its anchor in the note as it is now.
 *  Answers whether it was found. */
export async function tickTask(at: string, space: string, done: boolean): Promise<boolean> {
  const root = workspace.spaces.find((one) => one.name === space)?.root
  if (root === undefined) return false
  const [{ clockOf, editedTask, readAt }, { oneEdit }] = await Promise.all([
    import('@nib/bases/tasks'),
    import('@nib/markdown/edits'),
  ])
  const anchor = readAt(at)
  const path = insideSpace(root, anchor.path)
  const before = await workspace.noteText(path)
  if (before === null) return false

  let after: string
  try {
    after = editedTask(before, space, anchor.path, anchor, {}, done, clockOf(new Date()).today).text
  } catch {
    // The task is not in the note any more: nothing to tick.
    return false
  }
  const edit = oneEdit(before, after)
  if (edit) await replaceInNotes(workspace, [changeOf(path, before, [edit])])
  return true
}

/** Today, open tasks for today and overdue, in every space, as the Today view orders
 *  them; or the list a Todoist filter answers, which takes the engine. */
export async function listed(filter?: string): Promise<{ total: number; tasks: TaskOut[] }> {
  // The glasses read Today their own lean way (even/today-tasks.ts) and carry neither
  // the rows store nor the engine; said as a throw rather than a guard so the bundler
  // drops both from their package. See vite.even.config.ts.
  if (__EVEN_PLUGIN__) throw new Error('no rows store on the glasses')
  const { rows } = await import('./rows/rows.svelte')
  if (!filter) {
    const { clockOf, taskOut, todayTasks } = await import('@nib/bases/tasks')
    const today = todayTasks(rows.of(), clockOf(new Date()).today)
    return { total: today.length, tasks: today.slice(0, 50).map(taskOut) }
  }

  const { clockOf, listTasks } = await import('@nib/bases/agent')
  const names = new Set(
    rows
      .of()
      .filter((row) => row.kind === 'note')
      .map((row) => row.file.basename.toLowerCase()),
  )
  return listTasks(
    rows.of(),
    { filter, inboxes: rows.inboxes(), isNote: (name) => names.has(name.toLowerCase()) },
    clockOf(new Date()),
  )
}
