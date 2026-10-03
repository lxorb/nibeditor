/** The views nib ships, as the bases they are: Inbox, Today, Upcoming, Logbook, a
 *  project, a label, and what is assigned to me. Each is an ordinary Base, so the
 *  engine answers it like any other and "Copy to a base" writes it as a `.base`
 *  file the reader then changes. Group keys are values, never words: Today groups
 *  by whether a task is overdue, and the view says "Overdue" in the reader's
 *  language. */

import type { Base, Filter, View } from './types'

export type BuiltinName =
  'inbox' | 'today' | 'upcoming' | 'logbook' | 'project' | 'label' | 'assigned'

export interface BuiltinParams {
  /** Each space's inbox note: Inbox. */
  inboxes?: { space: string; path: string }[]
  /** The note: a project. */
  note?: { space: string; path: string }
  /** The tag, without `#`: a label. */
  tag?: string
}

const quote = (text: string) => JSON.stringify(text)

const inNote = (space: string, path: string) =>
  `file.space == ${quote(space)} && file.path == ${quote(path)}`

function base(
  view: Omit<View, 'nib' | 'options' | 'order' | 'summaries'> & Partial<View>,
  formulas: Record<string, string> = {},
): Base {
  return {
    formulas,
    properties: {},
    summaries: {},
    views: [{ order: [], summaries: {}, options: {}, nib: { rows: 'tasks', kept: {} }, ...view }],
    nib: { properties: {}, kept: {} },
    kept: {},
  }
}

/** A built-in view as a Base. */
export function builtinView(name: BuiltinName, params: BuiltinParams = {}): Base {
  switch (name) {
    case 'inbox': {
      const inboxes = params.inboxes ?? []
      const filters: Filter = inboxes.length
        ? { or: inboxes.map((one) => inNote(one.space, one.path)) }
        : 'false'
      return base({
        type: 'list',
        name: 'Inbox',
        filters,
        sort: [],
        groupBy: { property: 'file.space', direction: 'ASC' },
      })
    }
    case 'today':
      return base(
        {
          type: 'list',
          name: 'Today',
          filters: { and: ['task.started', 'task.due <= today() || task.scheduled <= today()'] },
          sort: [
            { property: 'task.priority', direction: 'ASC' },
            { property: 'task.time', direction: 'ASC' },
          ],
          groupBy: { property: 'formula.overdue', direction: 'DESC' },
        },
        { overdue: 'task.due < today() || task.scheduled < today()' },
      )
    case 'upcoming':
      return base(
        {
          type: 'list',
          name: 'Upcoming',
          filters: { and: ['task.started', 'task.due > today() || task.scheduled > today()'] },
          sort: [
            { property: 'task.time', direction: 'ASC' },
            { property: 'task.priority', direction: 'ASC' },
          ],
          groupBy: { property: 'formula.day', direction: 'ASC' },
        },
        { day: 'if(task.due > today(), task.due, task.scheduled)' },
      )
    case 'logbook':
      return base(
        {
          type: 'list',
          name: 'Logbook',
          filters: 'task.done || task.cancelled',
          sort: [],
          groupBy: { property: 'formula.day', direction: 'DESC' },
          nib: { rows: 'tasks', showCompleted: true, kept: {} },
        },
        { day: 'if(task.completed, task.completed, task.cancelledOn)' },
      )
    case 'project': {
      const note = params.note
      return base({
        type: 'list',
        name: note ? note.path.replace(/^.*\//, '').replace(/\.md$/i, '') : 'Project',
        filters: note ? inNote(note.space, note.path) : 'false',
        sort: [],
        groupBy: { property: 'task.section', direction: 'ASC' },
        nib: { rows: 'tasks', groupOrder: 'rows', kept: {} },
      })
    }
    case 'label': {
      const tag = quote(params.tag ?? '')
      return base({
        type: 'list',
        name: `#${params.tag ?? ''}`,
        filters: `if(task, task.hasTag(${tag}), file.hasTag(${tag}))`,
        sort: [],
        groupBy: { property: 'file.basename', direction: 'ASC' },
        nib: { rows: 'both', kept: {} },
      })
    }
    case 'assigned':
      return base({
        type: 'list',
        name: 'Assigned to me',
        filters: 'task.mine',
        sort: [
          { property: 'task.date', direction: 'ASC' },
          { property: 'task.priority', direction: 'ASC' },
        ],
      })
  }
}
