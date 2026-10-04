/** `/tasks` and `/today` (docs/tasks.md 5.15): the reader's to-dos in the thread, and
 *  the model planning their day.
 *
 *  `/tasks` with nothing after it is Today; with Todoist's filter language it is that
 *  list; with words that are no filter, the model writes the filter (Todoist's Filter
 *  Assist), which is shown above the rows so the reader learns it. The rows are a
 *  notice the thread draws with live boxes (TaskRows.svelte), never sent to the model.
 *
 *  `/today` hands the model the plan as a turn in Agent mode: it reads the lists with
 *  `list_tasks` and writes times and dates with `update_task`, every one an edit the
 *  review keeps or undoes, so nothing it plans is final until the reader says so. */

import type { Thread } from '../chat/types'
import type { Host } from './host'
import { sendHere } from './host'

/** What `/today` asks for, after anything the reader added. In English, for the model. */
const PLAN = [
  'Plan my day.',
  "Read today's list and what is overdue with list_tasks (view today), then the next seven days (filter: 7 days), and the inbox.",
  'Weigh priorities, deadlines, durations and what is overdue, and propose an order that fits one day, with a time for each task that has to happen at one.',
  'Then write it: for each task you scheduled, update_task with time (HH:MM) and scheduled (today), and move what does not fit today to a later day with scheduled.',
  'Change nothing else. End with the plan as a short list, earliest first.',
].join(' ')

export function planDay(host: Host, thread: Thread | null, args: string): void {
  sendHere(host, thread, args.trim() ? `${PLAN}\n\n${args.trim()}` : PLAN, { mode: 'agent' })
}

/** How a model is asked to turn words into a filter. In English, for the model. */
const ASSIST = [
  "Write one filter in Todoist's filter language for the request below and answer with the filter alone, nothing else.",
  'Operators: & (and), | (or), ! (not), parentheses, and a comma between lists.',
  'Queries: today, tomorrow, overdue, no date, 7 days, next 3 days, date before: <date>, date after: <date>, p1 p2 p3 p4, #<note or tag>, ##<folder>, /<heading>, @<tag>, recurring, subtask, assigned to: me, search: <words>, deadline before: <date>.',
].join(' ')

/** The rows a list answers, as the notice the thread draws them from. */
export interface Listed {
  filter?: string
  total: number
  tasks: {
    at: string
    space: string
    text: string
    status?: string
    due?: string
    time?: string
    priority?: number
  }[]
}

/** A list, worked out from the rows every space has. */
async function listed(filter: string | undefined): Promise<Listed> {
  const [{ rows }, { clockOf, listTasks }] = await Promise.all([
    import('../../rows/rows.svelte'),
    import('@nib/bases/agent'),
  ])
  const names = new Set(
    rows
      .of()
      .filter((row) => row.kind === 'note')
      .map((row) => row.file.basename.toLowerCase()),
  )
  const answer = listTasks(
    rows.of(),
    {
      ...(filter ? { filter } : { view: 'today' }),
      inboxes: rows.inboxes(),
      isNote: (name) => names.has(name.toLowerCase()),
    },
    clockOf(new Date()),
  )
  return { ...(filter ? { filter } : {}), ...answer }
}

/** `/tasks [filter or words]`. */
export async function showTasks(host: Host, thread: Thread, args: string): Promise<void> {
  const asked = args.trim()
  const { AgentError } = await import('@nib/bases/agent')
  let answer: Listed
  try {
    answer = await listed(asked || undefined)
  } catch (error) {
    if (!(error instanceof AgentError)) throw error
    const filter = (
      await host.ask(thread, [
        { role: 'system', content: ASSIST },
        { role: 'user', content: asked },
      ])
    )
      .trim()
      .replace(/^`+|`+$/g, '')
      .split('\n')[0]
      ?.trim()
    // A model that answered nothing leaves the reader's words, refused as they are.
    answer = await listed(filter?.length ? filter : asked)
  }
  host.line(thread, JSON.stringify(answer), 'tasks')
}

/** A box in the thread ticked or cleared: the task found again by its anchor in the
 *  rows as they are now and written through the one write path, as a box in a view
 *  is. Answers whether it was found. */
export async function tickTask(at: string, space: string, done: boolean): Promise<boolean> {
  const [{ rows }, { clockOf, findTask, readAt }] = await Promise.all([
    import('../../rows/rows.svelte'),
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
