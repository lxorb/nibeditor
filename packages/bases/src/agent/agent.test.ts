import { describe, expect, test } from 'vitest'
import { readBase } from '../base-file'
import { rowsOfText } from '../note-rows'
import {
  AgentError,
  atOf,
  clockOf,
  editedBase,
  editedTask,
  listTasks,
  movedTask,
  newTask,
  quickWords,
  queryBase,
  readAt,
  rowPlace,
  taskChange,
  taskOut,
  withProperties,
} from '.'
import { taskLine } from '@nib/markdown/task-edits'

const context = { today: '2026-10-04', now: '2026-10-04T09:00:00' }

const NOTE = [
  '# Errands',
  '- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 2026-10-04',
  '  Their number is on the card.',
  '  - [ ] Find the card',
  '- [ ] Water the plants 🔁 every 3 days 📅 2026-10-03',
  '- [x] Old thing ✅ 2026-10-01',
  '## Later',
  '- [ ] Renew the gym 📅 2026-10-20',
  '',
].join('\n')

const rows = rowsOfText('Home', 'Errands.md', NOTE)
const task = (words: string) => {
  const found = rows.find((row) => row.task?.text === words)
  if (!found) throw new Error(words)
  return found
}

describe('a task as an agent reads it', () => {
  test('only the fields it has, and an anchor it hands back', () => {
    const out = taskOut(task('Call the bank'))
    expect(out).toEqual({
      at: atOf(task('Call the bank')),
      space: 'Home',
      text: 'Call the bank',
      due: '2026-10-04',
      time: '16:00',
      priority: 2,
      tags: ['admin'],
      section: 'Errands',
    })
    expect(readAt(out.at)).toEqual({
      path: 'Errands.md',
      line: 1,
      hash: task('Call the bank').anchor?.hash,
    })
  })

  test('a note with # in its name keeps it', () => {
    expect(readAt('C#/Notes.md#4:abc').path).toBe('C#/Notes.md')
    expect(() => readAt('Notes.md')).toThrow(AgentError)
  })
})

describe('the arguments', () => {
  test('dates, a time with its zone, Todoist priorities, a rule, reminders, minutes', () => {
    expect(
      taskChange({
        due: '2026-10-06',
        scheduled: null,
        time: '9:30 Europe/Zurich',
        priority: 'p1',
        recurrence: 'every week on Monday',
        remind: ['15m', '2026-10-06 09:00'],
        duration: '1h30m',
        tags: '#a, b',
      }),
    ).toEqual({
      due: '2026-10-06',
      scheduled: null,
      time: '09:30',
      zone: 'Europe/Zurich',
      priority: 1,
      recurrence: 'every week on Monday',
      remind: [{ before: 15 }, { at: '2026-10-06', time: '09:00' }],
      duration: 90,
      tags: ['a', 'b'],
    })
  })

  test('each refused in a sentence that says what it takes', () => {
    expect(() => taskChange({ due: 'tomorrow' })).toThrow('due is a date, YYYY-MM-DD, or null')
    expect(() => taskChange({ priority: 7 })).toThrow('priority is 1 to 4')
    expect(() => taskChange({ recurrence: 'sometimes' })).toThrow('recurrence is a rule')
    expect(() => taskChange({ text: 'two\nlines' })).toThrow('one line')
  })

  test('a new task reads the marks in its words and the fields beside them', () => {
    const fields = newTask({
      text: 'Pay rent 📅 2026-10-31 #home',
      priority: 1,
      fields: { duration: 15 },
    })
    expect(taskLine(fields.fields)).toBe('- [ ] Pay rent [duration:: 15m] #home 🔺 📅 2026-10-31')
  })
})

describe('words read the way quick add reads them', () => {
  const read = quickWords(['en'], new Date('2026-10-04T09:00:00'), ['Errands'])

  test('the grammar, and where the words say the task goes', () => {
    const said = read('Call mum tomorrow 4pm p1 >Errands /Later')
    expect(taskLine(said.fields)).toBe('- [ ] Call mum [time:: 16:00] 🔺 📅 2026-10-05')
    expect(said).toMatchObject({ note: 'Errands', heading: 'Later' })
  })

  test("the Tasks plugin's marks written in the words win", () => {
    const said = read('Pay rent tomorrow 📅 2026-10-31 #home')
    expect(said.fields.due).toBe('2026-10-31')
    expect(said.fields.tags).toEqual(['home'])
  })
})

describe('a task changed', () => {
  const anchor = (words: string) => readAt(atOf(task(words)))

  test('a field, one line', () => {
    const edited = editedTask(
      NOTE,
      'Home',
      'Errands.md',
      anchor('Call the bank'),
      { due: '2026-10-05' },
      undefined,
      context.today,
    )
    expect(edited.text.split('\n')[1]).toBe(
      '- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 2026-10-05',
    )
  })

  test('ticked: its open sub-task with it', () => {
    const edited = editedTask(
      NOTE,
      'Home',
      'Errands.md',
      anchor('Call the bank'),
      {},
      true,
      context.today,
    )
    const lines = edited.text.split('\n')
    expect(lines[1]).toContain('[x]')
    expect(lines[1]).toContain('✅ 2026-10-04')
    expect(lines[3]).toBe('  - [x] Find the card ✅ 2026-10-04')
    expect(readAt(edited.at).line).toBe(1)
  })

  test('a recurring one writes its next occurrence above, and says where', () => {
    const edited = editedTask(
      NOTE,
      'Home',
      'Errands.md',
      anchor('Water the plants'),
      {},
      true,
      context.today,
    )
    const lines = edited.text.split('\n')
    expect(lines[4]).toBe('- [ ] Water the plants 🔁 every 3 days 📅 2026-10-06')
    expect(lines[5]).toBe('- [x] Water the plants 🔁 every 3 days 📅 2026-10-03 ✅ 2026-10-04')
    expect(readAt(edited.at).line).toBe(5)
    expect(edited.next && readAt(edited.next).line).toBe(4)
  })

  test('found again where lines above it moved, refused where it is gone', () => {
    const moved = `Intro\n\n${NOTE}`
    const edited = editedTask(
      moved,
      'Home',
      'Errands.md',
      anchor('Renew the gym'),
      { priority: 1 },
      undefined,
      context.today,
    )
    expect(edited.text.split('\n')[9]).toBe('- [ ] Renew the gym 🔺 📅 2026-10-20')
    expect(() =>
      editedTask(
        '# Empty\n',
        'Home',
        'Errands.md',
        anchor('Renew the gym'),
        {},
        true,
        context.today,
      ),
    ).toThrow('not in the note any more')
  })

  test('moved, with everything under it', () => {
    const moved = movedTask(
      { text: NOTE, space: 'Home', path: 'Errands.md', anchor: anchor('Call the bank') },
      { text: '# Bank\n' },
    )
    expect(moved.source).not.toContain('Call the bank')
    expect(moved.source).not.toContain('Find the card')
    expect(moved.target).toBe(
      '# Bank\n\n- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 2026-10-04\n  Their number is on the card.\n  - [ ] Find the card\n',
    )
  })
})

describe('lists', () => {
  test('Today: overdue first, then today, open only', () => {
    const { tasks } = listTasks(rows, { view: 'today' }, context)
    expect(tasks.map((one) => one.text)).toEqual(['Water the plants', 'Call the bank'])
  })

  test("Todoist's filter, on top of a view or alone", () => {
    expect(listTasks(rows, { filter: '#admin' }, context).tasks.map((one) => one.text)).toEqual([
      'Call the bank',
    ])
    expect(
      listTasks(rows, { filter: 'p2 | no date' }, context).tasks.map((one) => one.text),
    ).toEqual(['Call the bank', 'Find the card'])
  })

  test('a limit, and the total past it', () => {
    const { total, tasks } = listTasks(rows, { limit: 1 }, context)
    expect(total).toBe(4)
    expect(tasks).toHaveLength(1)
  })

  test('a view or a filter that does not read is refused', () => {
    expect(() => listTasks(rows, { view: 'someday' }, context)).toThrow(AgentError)
    expect(() => listTasks(rows, { filter: 'today &' }, context)).toThrow(AgentError)
  })

  test('a base: its groups and the columns its view shows', () => {
    const books = [
      ...rowsOfText('Home', 'Books/Dune.md', '---\nstatus: reading\npages: 412\n---\n'),
      ...rowsOfText('Home', 'Books/Emma.md', '---\nstatus: done\npages: 300\n---\n'),
    ]
    const base = readBase(
      'filters: file.inFolder("Books")\nviews:\n  - type: table\n    name: All\n    order: [file.name, pages]\n    groupBy:\n      property: note.status\n',
    )
    const out = queryBase(base, undefined, books, context)
    expect(out.total).toBe(2)
    expect(out.groups.map((group) => group.key)).toEqual(['done', 'reading'])
    expect(out.groups[1]?.rows[0]).toEqual({
      path: 'Books/Dune.md',
      space: 'Home',
      'file.name': 'Dune.md',
      pages: 412,
    })
  })

  test('the clock in a zone', () => {
    expect(clockOf(new Date('2026-10-04T23:30:00Z'), 'Europe/Zurich')).toEqual({
      today: '2026-10-05',
      now: '2026-10-05T01:30:00',
    })
  })
})

describe('bases', () => {
  test('a new row goes where the filter looks', () => {
    const base = readBase(
      'filters:\n  and:\n    - file.inFolder("Reading/Books")\n    - file.hasTag("book")\n    - status == "to read"\nviews:\n  - type: cards\n    name: Shelf\n',
    )
    expect(rowPlace(base)).toEqual({
      folder: 'Reading/Books',
      properties: { status: 'to read', tags: ['book'] },
    })
  })

  test('properties written, taken away, a list as a list', () => {
    expect(
      withProperties('Words', { status: 'done', pages: 3, read: true, tags: ['a', 'b'] }),
    ).toBe('---\nstatus: done\npages: 3\nread: true\ntags: [a, b]\n---\nWords')
    expect(withProperties('---\nstatus: done\n---\nWords', { status: null })).toBe('Words')
    expect(() => withProperties('', { 'a:b': 1 })).toThrow(AgentError)
  })

  test('a base edited: a view added, a filter set, a formula, a view gone', () => {
    const base = readBase('views:\n  - type: table\n    name: All\n')
    const edited = editedBase(base, [
      { op: 'add_view', name: 'Board', type: 'kanban', groupBy: 'note.status' },
      { op: 'set_filter', filter: 'file.inFolder("Books")' },
      { op: 'add_formula', name: 'left', formula: 'pages - read' },
      { op: 'edit_view', view: 'All', name: 'Everything', limit: 10 },
      { op: 'add_property', name: 'pages', displayName: 'Pages' },
    ])
    expect(edited.views.map((view) => view.name)).toEqual(['Everything', 'Board'])
    expect(edited.views[0]?.limit).toBe(10)
    expect(edited.views[1]?.groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
    expect(edited.filters).toBe('file.inFolder("Books")')
    expect(edited.formulas.left).toBe('pages - read')
    expect(base.views).toHaveLength(1)
    expect(editedBase(edited, [{ op: 'remove_view', name: 'Board' }]).views).toHaveLength(1)
    expect(() => editedBase(base, [{ op: 'rename' }])).toThrow(AgentError)
  })
})

describe('Today without the engine', () => {
  test('is what the engine answers for Today, row for row', async () => {
    const { todayTasks } = await import('./today')
    const many = [
      ...rows,
      ...rowsOfText(
        'Home',
        'More.md',
        [
          '- [ ] Late and urgent 🔺 📅 2026-10-01',
          '- [ ] Scheduled today [time:: 09:00] ⏳ 2026-10-04',
          '- [ ] Not started yet 🛫 2026-10-05 📅 2026-10-04',
          '- [ ] Early [time:: 07:00] 📅 2026-10-04',
          '- [-] Cancelled 📅 2026-10-04',
          '- [ ] Later 📅 2026-10-09',
        ].join('\n'),
      ),
    ]
    const engine = listTasks(many, { view: 'today' }, context).tasks.map((one) => one.at)
    expect(todayTasks(many, context.today).map((row) => atOf(row))).toEqual(engine)
    expect(engine).toHaveLength(5)
  })
})
