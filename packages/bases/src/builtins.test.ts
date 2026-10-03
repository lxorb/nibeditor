import { describe, expect, test } from 'vitest'
import { answer } from './answer'
import { readBase, writeBase } from './base-file'
import { builtinView } from './builtins'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Answer, Row } from './types'

const context = contextAt()
const keyed = (result: Answer) =>
  result.groups.map((group) => [group.key, group.rows.map((row) => row.task?.text)])

const rows: Row[] = [
  taskRow('Inbox.md', '- [ ] Call the bank [time:: 16:00] ⏫ 📅 2026-10-04', 0),
  taskRow('Inbox.md', '- [ ] Renew passport 📅 2026-09-26', 1),
  taskRow('Inbox.md', '- [ ] Draft talk ⏳ 2026-10-04 📅 2026-10-20', 2),
  taskRow('Errands.md', '- [ ] Gym [time:: 07:30] 🔺 📅 2026-10-04', 0, { section: ['Health'] }),
  taskRow('Errands.md', '- [ ] Taxes 🛫 2026-10-10 📅 2026-10-12', 1, { section: ['Admin'] }),
  taskRow('Errands.md', '- [ ] Dentist 📅 2026-10-06', 2, { section: ['Health'] }),
  taskRow('Errands.md', '- [x] Water ✅ 2026-10-03', 3, { section: ['Home'] }),
  taskRow('Errands.md', '- [-] Gym old ❌ 2026-10-02', 4, { section: ['Home'] }),
  taskRow('Errands.md', '- [ ] Review PR #work [assignee:: Emil] 📅 2026-10-05', 5),
  taskRow('Work.md', '- [ ] Ship it #work', 0, { space: 'Work' }),
  taskRow('Inbox.md', '- [ ] Elsewhere', 0, { space: 'Work' }),
  noteRow('Projects/Thesis.md', {}, { tags: ['work'] }),
]

describe('the built-in views', () => {
  test('Today: overdue first, then today, by priority and time; not started and done ones out', () => {
    expect(keyed(answer(builtinView('today'), 0, rows, context))).toEqual([
      [true, ['Renew passport']],
      [false, ['Gym', 'Call the bank', 'Draft talk']],
    ])
  })

  test('Upcoming: by day, started ones only', () => {
    expect(keyed(answer(builtinView('upcoming'), 0, rows, context))).toEqual([
      [{ kind: 'date', iso: '2026-10-05' }, ['Review PR']],
      [{ kind: 'date', iso: '2026-10-06' }, ['Dentist']],
      [{ kind: 'date', iso: '2026-10-20' }, ['Draft talk']],
    ])
  })

  test('Logbook: done and cancelled, newest day first', () => {
    expect(keyed(answer(builtinView('logbook'), 0, rows, context))).toEqual([
      [{ kind: 'date', iso: '2026-10-03' }, ['Water']],
      [{ kind: 'date', iso: '2026-10-02' }, ['Gym old']],
    ])
  })

  test('Inbox: every space has its own, shown together', () => {
    const inbox = builtinView('inbox', {
      inboxes: [
        { space: 'Notes', path: 'Inbox.md' },
        { space: 'Work', path: 'Inbox.md' },
      ],
    })
    expect(keyed(answer(inbox, 0, rows, context))).toEqual([
      ['Notes', ['Call the bank', 'Renew passport', 'Draft talk']],
      ['Work', ['Elsewhere']],
    ])
  })

  test("a project: its tasks under its headings, in the note's order", () => {
    const project = builtinView('project', { note: { space: 'Notes', path: 'Errands.md' } })
    expect(project.views[0]?.name).toBe('Errands')
    expect(keyed(answer(project, 0, rows, context))).toEqual([
      ['Health', ['Gym', 'Dentist']],
      ['Admin', ['Taxes']],
      [null, ['Review PR']],
    ])
  })

  test('a label: tasks and notes that carry the tag', () => {
    const label = builtinView('label', { tag: 'work' })
    const result = answer(label, 0, rows, context)
    expect(
      result.groups.map((group) => [
        group.key,
        group.rows.map((row) => row.task?.text ?? row.file.basename),
      ]),
    ).toEqual([
      ['Errands', ['Review PR']],
      ['Thesis', ['Thesis']],
      ['Work', ['Ship it']],
    ])
  })

  test('assigned to me', () => {
    expect(
      answer(builtinView('assigned'), 0, rows, context).groups[0]?.rows.map(
        (row) => row.task?.text,
      ),
    ).toEqual(['Review PR'])
  })

  test('each one copies to a base file that reads back the same', () => {
    for (const name of [
      'inbox',
      'today',
      'upcoming',
      'logbook',
      'project',
      'label',
      'assigned',
    ] as const) {
      const base = builtinView(name, {
        tag: 'x',
        note: { space: 'S', path: 'N.md' },
        inboxes: [{ space: 'S', path: 'Inbox.md' }],
      })
      expect(readBase(writeBase(base))).toEqual(base)
    }
  })
})
