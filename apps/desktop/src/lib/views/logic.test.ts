import { answer, builtinView, readBase, writeBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { daysShown, occurrences, place, placedByDay, stepped, timeOf } from './calendar'
import { donutPaths, heights, linePath, seriesOf, settingsOf, totalOf } from './chart'
import { changeOf, columnsOf, defaultColumns, editorOf, knownProperties } from './columns'
import { contextFor } from './context'
import { dayOf, nextMonday, nowOf, weekStart } from './days'
import { dropInto } from './drop'
import {
  addView,
  freeViewName,
  removeView,
  renameView,
  setFilter,
  setGroup,
  setHidden,
  setLayout,
  setManualOrder,
  setShowCompleted,
  setSort,
} from './edit'
import { expressionOf, filterOf, literal, rowOf, rowsOf } from './filter-rows'
import { noteRow, taskRow } from './fixture'
import { pieces, plain } from './inline'
import { switched } from './layout'
import { listItems } from './list-items'
import { panelCounts } from './panel'
import { rowKey } from './row-keys'
import { readSpec, sameView, writeSpec } from './spec'
import { barOf, dragged, spanOf } from './timeline'

const TODAY = '2026-10-04'
const context = (rows: Parameters<typeof contextFor>[0]['rows']) =>
  contextFor({ rows, today: TODAY, now: `${TODAY}T10:00:00` })

describe('a view tab’s words', () => {
  test('say which view, read back checked', () => {
    const words = writeSpec({ builtin: 'project', space: 'Notes', path: 'Errands.md' })
    expect(readSpec(words)).toEqual({ builtin: 'project', space: 'Notes', path: 'Errands.md' })
    expect(readSpec('not json')).toBeNull()
    expect(readSpec(JSON.stringify({ builtin: 'nonsense', view: 3 }))).toEqual({})
  })

  test('name one view however it was changed', () => {
    expect(sameView({ builtin: 'today' }, { builtin: 'today', yaml: 'views: []' })).toBe(true)
    expect(sameView({ builtin: 'label', tag: 'a' }, { builtin: 'label', tag: 'b' })).toBe(false)
    expect(sameView({ view: 'Board' }, { view: 'All' })).toBe(false)
  })
})

describe('days', () => {
  test('are the local calendar’s', () => {
    expect(dayOf(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
    expect(nowOf(new Date(2026, 9, 4, 9, 5, 7))).toBe('2026-10-04T09:05:07')
  })

  test('next Monday is never today', () => {
    expect(nextMonday('2026-10-04')).toBe('2026-10-05')
    expect(nextMonday('2026-10-05')).toBe('2026-10-12')
    expect(weekStart('2026-10-04', 1)).toBe('2026-09-28')
    expect(weekStart('2026-10-04', 0)).toBe('2026-10-04')
  })
})

describe('a base changed from the head', () => {
  const base = builtinView('today')

  test('is a new base every time, sharing what did not change', () => {
    const next = setLayout(base, 0, 'kanban')
    expect(next).not.toBe(base)
    expect(next.views[0]?.type).toBe('kanban')
    expect(base.views[0]?.type).toBe('list')
    expect(next.formulas).toBe(base.formulas)
  })

  test('sets and takes away a grouping, a filter, a sort', () => {
    const grouped = setGroup(base, 0, undefined)
    expect(grouped.views[0] && 'groupBy' in grouped.views[0]).toBe(false)
    const filtered = setFilter(base, 0, 'task.priority == 1')
    expect(filtered.views[0]?.filters).toBe('task.priority == 1')
    expect(setFilter(filtered, 0, undefined).views[0]?.filters).toBeUndefined()
    expect(setSort(base, 0, []).views[0]?.sort).toEqual([])
  })

  test('keeps nib’s own keys under nib, and takes one away with undefined', () => {
    const shown = setShowCompleted(base, 0, true)
    expect(shown.views[0]?.nib.showCompleted).toBe(true)
    expect(setShowCompleted(shown, 0, false).views[0]?.nib).not.toHaveProperty('showCompleted')
    const hidden = setHidden(base, 0, 'true', true)
    expect(hidden.views[0]?.nib.hidden).toEqual(['true'])
    expect(setHidden(hidden, 0, 'true', false).views[0]?.nib).not.toHaveProperty('hidden')
    expect(setManualOrder(base, 0, 'To do', ['a.md', 'b.md']).views[0]?.nib.order).toEqual({
      'To do': ['a.md', 'b.md'],
    })
  })

  test('adds, names and takes away views, never the last one', () => {
    const two = addView(base, 0)
    expect(two.views.map((one) => one.name)).toEqual(['Today', 'Today 2'])
    expect(freeViewName(two, 'Today')).toBe('Today 3')
    expect(renameView(two, 1, '  Board ').views[1]?.name).toBe('Board')
    expect(removeView(two, 0).views.map((one) => one.name)).toEqual(['Today 2'])
    expect(removeView(base, 0)).toBe(base)
  })

  test('written and read back, says the same', () => {
    const changed = setLayout(setShowCompleted(base, 0, true), 0, 'calendar')
    const again = readBase(writeBase(changed))
    expect(again.views[0]?.type).toBe('calendar')
    expect(again.views[0]?.nib.showCompleted).toBe(true)
    expect(again.views[0]?.filters).toEqual(base.views[0]?.filters)
  })
})

describe('switching layout', () => {
  test('gives a board of tasks their box as its columns', () => {
    const base = builtinView('logbook')
    const board = switched(setGroup(base, 0, undefined), 0, 'kanban', [])
    expect(board.views[0]?.groupBy).toEqual({ property: 'task.status', direction: 'ASC' })
  })

  test('gives a calendar of notes a date to sit on', () => {
    const base = readBase('views:\n  - type: table\n    name: All\n')
    const rows = [noteRow('Trip.md', 'when: 2026-10-08\nwho: Lu')]
    expect(switched(base, 0, 'calendar', rows).views[0]?.nib.date).toBe('note.when')
  })
})

describe('the columns', () => {
  const tasks = [taskRow('Errands.md', '- [ ] Bank 📅 2026-10-06')]

  test('of a view that names none: Todoist’s for tasks, the first properties for notes', () => {
    expect(defaultColumns('tasks', tasks)).toEqual([
      'task.text',
      'file.basename',
      'task.due',
      'task.priority',
    ])
    expect(defaultColumns('notes', [noteRow('Dune.md', 'author: Herbert\nyear: 1965')])).toEqual([
      'file.name',
      'note.author',
      'note.year',
    ])
    const base = readBase('views:\n  - type: table\n    order: [file.name, note.year]\n')
    expect(columnsOf(base, 0, [])).toEqual(['file.name', 'note.year'])
  })

  test('are edited with what their kind asks for, and formulas and files not at all', () => {
    const base = readBase('nib:\n  properties:\n    status:\n      options: [To do, Done]\n')
    const notes = [noteRow('A.md', 'done: true\ncount: 3\nwhen: 2026-10-01\ntags: [a]')]
    expect(editorOf(base, 'note.status', notes)).toBe('select')
    expect(editorOf(base, 'note.done', notes)).toBe('checkbox')
    expect(editorOf(base, 'note.count', notes)).toBe('number')
    expect(editorOf(base, 'note.when', notes)).toBe('date')
    expect(editorOf(base, 'note.tags', notes)).toBe('list')
    expect(editorOf(base, 'task.due', notes)).toBe('date')
    expect(editorOf(base, 'file.name', notes)).toBe('none')
    expect(editorOf(base, 'formula.age', notes)).toBe('none')
  })

  test('write a note’s property and a task’s field, and nothing through a formula', () => {
    const task = tasks[0]
    if (!task) throw new Error('fixture')
    expect(changeOf(task, 'task.due', '2026-10-09')).toEqual({ task: { due: '2026-10-09' } })
    expect(changeOf(task, 'note.status', 'Done')).toEqual({ note: { status: 'Done' } })
    expect(changeOf(task, 'formula.age', 3)).toBeNull()
    expect(changeOf(noteRow('A.md'), 'task.due', '2026-10-09')).toBeNull()
  })

  test('a picker offers a task’s fields, the files’ and every key the rows have', () => {
    const offered = knownProperties(readBase('formulas:\n  age: 1\n'), 'both', [
      noteRow('A.md', 'who: Lu'),
    ])
    expect(offered).toContain('task.due')
    expect(offered).toContain('file.mtime')
    expect(offered).toContain('note.who')
    expect(offered).toContain('formula.age')
    expect(knownProperties(readBase(''), 'notes', [])).not.toContain('task.due')
  })
})

describe('a drop into a group', () => {
  const bank = taskRow('Errands.md', '- [ ] Bank 📅 2026-10-01', 3)
  const done = taskRow('Errands.md', '- [x] Old ✅ 2026-10-01', 4)

  test('ticks for Done, opens again for To do, and writes Doing and Cancelled', () => {
    expect(dropInto('task.status', 'x', bank, TODAY)).toEqual({ tick: true })
    expect(dropInto('task.status', 'x', done, TODAY)).toBeNull()
    expect(dropInto('task.status', ' ', done, TODAY)).toEqual({
      change: { task: { status: ' ', completed: null, cancelledOn: null } },
    })
    expect(dropInto('task.status', '-', bank, TODAY)).toEqual({
      change: { task: { cancelled: true, cancelledOn: TODAY, completed: null } },
    })
  })

  test('gives a day, a priority, a heading, a note and a property', () => {
    expect(dropInto('formula.day', { kind: 'date', iso: '2026-10-09' }, bank, TODAY)).toEqual({
      change: { task: { due: '2026-10-09' } },
    })
    expect(dropInto('formula.overdue', false, bank, TODAY)).toEqual({
      change: { task: { due: TODAY } },
    })
    expect(dropInto('formula.overdue', true, bank, TODAY)).toBeNull()
    expect(dropInto('task.priority', 1, bank, TODAY)).toEqual({ change: { task: { priority: 1 } } })
    expect(dropInto('task.section', 'Shop', bank, TODAY)).toEqual({ move: { heading: 'Shop' } })
    expect(dropInto('file.path', 'Thesis.md', bank, TODAY)).toEqual({ move: { path: 'Thesis.md' } })
    expect(dropInto('note.status', 'Done', noteRow('Bug.md', 'status: To do'), TODAY)).toEqual({
      change: { note: { status: 'Done' } },
    })
    expect(dropInto('note.status', 'To do', noteRow('Bug.md', 'status: To do'), TODAY)).toBeNull()
    expect(dropInto('file.size', 3, bank, TODAY)).toBeNull()
  })

  test('takes the date off in the group with none', () => {
    expect(dropInto('task.due', null, bank, TODAY)).toEqual({ change: { task: { due: null } } })
  })
})

describe('a task’s lines moved', () => {
  test('a key and its lines go past a sibling, and in and out a level', async () => {
    const { indentedBlock, movedBlock, movedBeside, movedUnder, withLines, cutBlock } =
      await import('./lines')
    const note = '# P\n- [ ] A\n  - [ ] A1\n- [ ] B\n## Later\n- [ ] C\n'
    const b = taskRow('P.md', '- [ ] B', 3).anchor
    const a = taskRow('P.md', '- [ ] A', 1).anchor
    const c = taskRow('P.md', '- [ ] C', 5).anchor
    if (!a || !b || !c) throw new Error('fixture')

    expect(movedBlock(note, b, true)).toBe('# P\n- [ ] B\n- [ ] A\n  - [ ] A1\n## Later\n- [ ] C\n')
    expect(movedBlock(note, a, true)).toBeNull()
    expect(indentedBlock(note, b, true)).toBe(
      '# P\n- [ ] A\n  - [ ] A1\n  - [ ] B\n## Later\n- [ ] C\n',
    )
    expect(indentedBlock(note, a, false)).toBeNull()
    expect(movedUnder(note, a, 'Later')).toBe(
      '# P\n- [ ] B\n## Later\n- [ ] C\n- [ ] A\n  - [ ] A1\n',
    )
    expect(movedBeside(note, c, a, false)).toBe(
      '# P\n- [ ] C\n- [ ] A\n  - [ ] A1\n- [ ] B\n## Later\n',
    )
    expect(cutBlock(note, a)?.block).toEqual(['- [ ] A', '  - [ ] A1'])
    expect(withLines('', ['- [ ] New'])).toBe('- [ ] New\n')
    expect(withLines('# P\n\n- [ ] A\n\n', ['- [ ] New'])).toBe('# P\n\n- [ ] A\n- [ ] New\n\n')
  })
})

describe('the filter builder', () => {
  test('reads an expression as a row and writes it back', () => {
    expect(rowOf('note.status == "Done"')).toEqual({
      property: 'note.status',
      op: '==',
      value: 'Done',
    })
    expect(rowOf('task.due < date("2026-10-09")')).toEqual({
      property: 'task.due',
      op: '<',
      value: '2026-10-09',
    })
    expect(rowOf('file.hasTag("work")')).toEqual({
      property: 'file.tags',
      op: 'tag',
      value: 'work',
    })
    expect(rowOf('!note.cover')).toEqual({ property: 'note.cover', op: 'empty', value: '' })
    expect(rowOf('(now() - file.ctime).days > 3')).toEqual({
      kept: '(now() - file.ctime).days > 3',
    })
    expect(expressionOf({ property: 'note.year', op: '>=', value: '1965' })).toBe(
      'note.year >= 1965',
    )
    expect(expressionOf({ property: 'note.title', op: 'contains', value: 'Dune' })).toBe(
      'note.title.contains("Dune")',
    )
    expect(literal('today()')).toBe('today()')
  })

  test('keeps a group it cannot show, and the join', () => {
    const rows = rowsOf({ or: ['note.a == 1', { and: ['x', 'y'] }] })
    expect(rows.join).toBe('or')
    expect(rows.rows[1]).toEqual({ kept: { and: ['x', 'y'] } })
    expect(filterOf(rows)).toEqual({ or: ['note.a == 1', { and: ['x', 'y'] }] })
    expect(filterOf({ join: 'and', rows: [] })).toBeUndefined()
    expect(filterOf(rowsOf('task.done'))).toBe('task.done')
  })
})

describe('the calendar', () => {
  test('shows whole weeks for a month, and a week, three days or a day', () => {
    const month = daysShown('month', '2026-10-14', 1)
    expect(month[0]).toBe('2026-09-28')
    expect(month.length % 7).toBe(0)
    expect(month).toContain('2026-10-31')
    expect(daysShown('week', '2026-10-04', 1)).toHaveLength(7)
    expect(daysShown('days3', '2026-10-04', 1)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06'])
    expect(stepped('month', '2026-01-31', 1)).toBe('2026-02-28')
  })

  test('puts a timed task at its hour, as long as it lasts, and a repeat again faded', () => {
    const gym = taskRow(
      'Health.md',
      '- [ ] Gym [time:: 18:30] [duration:: 45m] 🔁 every day 📅 2026-10-04',
    )
    expect(place(gym, '2026-10-04')).toMatchObject({ start: 18 * 60 + 30, minutes: 45 })
    expect(timeOf(18 * 60 + 30)).toBe('18:30')
    const ghosts = occurrences(place(gym, '2026-10-04'), '2026-10-07')
    expect(ghosts.map((one) => one.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(ghosts.every((one) => one.ghost)).toBe(true)
  })

  test('keeps what has no day for the tray', () => {
    const rows = [taskRow('A.md', '- [ ] Dated 📅 2026-10-05'), taskRow('A.md', '- [ ] Not', 1)]
    const placed = placedByDay(rows, ['2026-10-04', '2026-10-05'], (row) => row.task?.due ?? null)
    expect(placed.byDay.get('2026-10-05')?.map((one) => one.row.task?.text)).toEqual(['Dated'])
    expect(placed.undated.map((one) => one.task?.text)).toEqual(['Not'])
  })
})

describe('the timeline', () => {
  const read = () => null
  test('runs a task from its start to its due date and writes what a drag moved', () => {
    const talk = taskRow('T.md', '- [ ] Talk 🛫 2026-10-05 📅 2026-10-08')
    const bar = barOf(talk, {}, read)
    expect(bar).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-08',
      from: 'task.start',
      to: 'task.due',
    })
    if (!bar) throw new Error('bar')
    expect(dragged(bar, 'move', 2)).toEqual({
      'task.start': '2026-10-07',
      'task.due': '2026-10-10',
    })
    expect(dragged(bar, 'end', -5)).toEqual({ 'task.due': '2026-10-05' })
    const one = barOf(taskRow('T.md', '- [ ] One 📅 2026-10-08'), {}, read)
    if (!one) throw new Error('bar')
    expect(dragged(one, 'start', -2)).toEqual({ 'task.start': '2026-10-06' })
    expect(barOf(taskRow('T.md', '- [ ] None'), {}, read)).toBeNull()
    expect(spanOf([bar], TODAY).first <= '2026-10-02').toBe(true)
  })
})

describe('the chart', () => {
  const base = readBase(
    'views:\n  - type: chart\n    groupBy: { property: note.status, direction: ASC }\n    nib: { chart: donut, measure: sum, of: note.points }\n',
  )
  const rows = [
    noteRow('A.md', 'status: Done\npoints: 3'),
    noteRow('B.md', 'status: Done\npoints: 2'),
    noteRow('C.md', 'status: Open\npoints: 5'),
  ]

  test('measures each group, and all of it', () => {
    const view = base.views[0]
    if (!view) throw new Error('view')
    const settings = settingsOf(view)
    expect(settings).toEqual({
      kind: 'donut',
      measure: 'sum',
      of: 'note.points',
      cumulative: false,
    })
    const answered = answer(base, 0, rows, context(rows))
    expect(seriesOf(answered, settings, base, context(rows)).map((one) => one.value)).toEqual([
      5, 5,
    ])
    expect(totalOf(answered, settings, base, context(rows)).value).toBe(10)
  })

  test('draws bars, a line and a donut as numbers', () => {
    expect(
      heights([
        { key: 'a', value: 2 },
        { key: 'b', value: 4 },
      ]),
    ).toEqual([0.5, 1])
    expect(linePath([0, 1], 100, 10)).toBe('M0.0 10.0 L100.0 0.0')
    expect(donutPaths([1, 1], 10, 5)).toHaveLength(2)
    expect(donutPaths([0], 10, 5)).toEqual([])
  })
})

describe('the list', () => {
  test('nests a sub-task under its parent and folds it with a twist', () => {
    const parent = taskRow('E.md', '- [ ] Bank', 1)
    const child = taskRow('E.md', '  - [ ] Card', 2, { parent: 1, indent: 2 })
    const groups = [{ key: null, rows: [child, parent], summaries: {} }]
    const open = listItems(groups, {
      grouped: false,
      folded: new Set(),
      shut: new Set(),
      adding: true,
    })
    expect(
      open.map((one) =>
        one.kind === 'row' ? `${one.depth}:${one.row.task?.text}:${one.twist}` : one.kind,
      ),
    ).toEqual(['0:Bank:open', '1:Card:null', 'add'])
    const shut = listItems(groups, {
      grouped: false,
      folded: new Set(),
      shut: new Set(['E.md#1']),
      adding: false,
    })
    expect(shut.map((one) => one.kind)).toEqual(['row'])
  })

  test('draws a head per group, folds one, and hides what the view hides', () => {
    const rows = [taskRow('E.md', '- [ ] A')]
    const groups = [
      { key: true, rows, summaries: {} },
      { key: false, rows, summaries: {} },
    ]
    const items = listItems(groups, {
      grouped: true,
      folded: new Set(['true']),
      shut: new Set(),
      hidden: ['false'],
      adding: false,
    })
    expect(items.map((one) => one.kind)).toEqual(['head'])
  })
})

describe('the keys of a row', () => {
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  })

  test('are Todoist’s', () => {
    expect(rowKey(press('t'), false)).toEqual({ kind: 'due', when: 'today' })
    expect(rowKey(press('T', { shiftKey: true }), false)).toEqual({ kind: 'due', when: 'tomorrow' })
    expect(rowKey(press('M', { shiftKey: true }), false)).toEqual({ kind: 'due', when: 'monday' })
    expect(rowKey(press('2'), false)).toEqual({ kind: 'priority', priority: 2 })
    expect(rowKey(press('Enter', { ctrlKey: true }), false)).toEqual({ kind: 'tick' })
    expect(rowKey(press('Enter', { metaKey: true }), true)).toEqual({ kind: 'tick' })
    expect(rowKey(press('ArrowUp', { altKey: true }), false)).toEqual({ kind: 'move', up: true })
    expect(rowKey(press('Tab', { shiftKey: true }), false)).toEqual({
      kind: 'indent',
      deeper: false,
    })
    expect(rowKey(press('q'), false)).toEqual({ kind: 'add' })
    expect(rowKey(press('5'), false)).toBeNull()
    expect(rowKey(press('t', { ctrlKey: true }), false)).toBeNull()
  })
})

describe('a line’s words', () => {
  test('are drawn without their marks', () => {
    expect(plain('Call **the** bank about [[Card|the card]] `now`')).toBe(
      'Call the bank about the card now',
    )
    expect(pieces('A *b* ~~c~~')).toEqual([
      { text: 'A ' },
      { text: 'b', em: true },
      { text: ' ' },
      { text: 'c', struck: true },
    ])
  })
})

describe('the panel', () => {
  test('counts Inbox, Today and Upcoming as their views answer them, and the projects and labels', () => {
    const rows = [
      taskRow('Inbox.md', '- [ ] Idea'),
      taskRow('Errands.md', '- [ ] Late #admin 📅 2026-10-01'),
      taskRow('Errands.md', '- [ ] Now 📅 2026-10-04', 1),
      taskRow('Thesis.md', '- [ ] Later #admin 📅 2026-10-09'),
      taskRow('Thesis.md', '- [x] Done ✅ 2026-10-01', 1),
    ]
    const counts = panelCounts(rows, TODAY, [{ space: 'Notes', path: 'Inbox.md' }])
    expect(counts).toMatchObject({ inbox: 1, today: 2, overdue: true, upcoming: 1 })
    expect(counts.projects.map((one) => `${one.name} ${one.count}`).sort()).toEqual([
      'Errands 2',
      'Inbox 1',
      'Thesis 1',
    ])
    expect(counts.labels).toEqual([{ tag: 'admin', count: 2 }])
  })
})

describe('the context', () => {
  test('answers a link, a note and its backlinks out of the rows', () => {
    const rows = [noteRow('Dune.md', {}, { links: ['Herbert'] }), noteRow('People/Herbert.md')]
    const made = context(rows)
    const dune = rows[0]
    if (!dune) throw new Error('fixture')
    expect(made.resolve?.('Herbert', dune)).toBe('People/Herbert.md')
    expect(made.row?.('Dune.md', 'Notes')).toBe(dune)
    const herbert = rows[1]
    if (!herbert) throw new Error('fixture')
    expect(made.backlinks?.(herbert)).toEqual(['Dune.md'])
  })
})
