import { describe, expect, test } from 'vitest'
import { compileFilter } from './filter'
import { contextAt, taskRow } from './fixtures/rows'
import { fromTodoist } from './todoist'
import type { Filter, Row } from './types'

const options = {
  today: '2026-10-04',
  isNote: (name: string) => ['work', 'thesis'].includes(name.toLowerCase()),
}

/** Todoist's documented filters, and the tree each one compiles to. */
const TREES: [string, Filter[]][] = [
  ['today', ['task.date == today()']],
  [
    'overdue',
    [
      'task.date < today() || (task.date == today() && task.time && task.time < now().format("HH:mm"))',
    ],
  ],
  ['no date', ['!task.date']],
  ['!no date', [{ not: ['!task.date'] }]],
  [
    '!no date & !no time',
    [{ and: [{ not: ['!task.date'] }, { not: ['task.date && !task.time'] }] }],
  ],
  ['5 days', ['task.date >= today() && task.date < today() + "5d"']],
  ['next 5 days', ['task.date >= today() && task.date < today() + "5d"']],
  ['date: Jan 3', ['task.date == date("2026-01-03")']],
  ['date before: May 5', ['task.date < date("2026-05-05")']],
  ['date after: May 5', ['task.date > date("2026-05-05")']],
  ['date before: +4 hours', ['task.at < now() + "4h"']],
  ['due before: May 5', ['task.due < date("2026-05-05")']],
  ['no deadline', ['!task.deadline']],
  ['deadline: today', ['task.deadline == today()']],
  ['deadline before: today', ['task.deadline < today()']],
  [
    'deadline after: yesterday & deadline before: in 7 days',
    [{ and: ['task.deadline > today() - "1d"', 'task.deadline < today() + "7d"'] }],
  ],
  ['recurring', ['task.recurring']],
  ['!recurring', [{ not: ['task.recurring'] }]],
  ['p1', ['task.priority == 1']],
  ['p4', ['task.priority >= 4']],
  ['No priority', ['task.priority >= 4']],
  ['#Work', ['file.basename.lower() == "work"']],
  ['#errands', ['task.hasTag("errands")']],
  ['##Work', ['file.inFolder("Work") || file.basename.lower() == "work"']],
  [
    '##School & !#Science',
    [
      {
        and: [
          'file.inFolder("School") || file.basename.lower() == "school"',
          { not: ['task.hasTag("Science")'] },
        ],
      },
    ],
  ],
  ['/Meetings', ['task.section && task.section.lower() == "meetings"']],
  [
    '#Work & /Meetings',
    [
      {
        and: [
          'file.basename.lower() == "work"',
          'task.section && task.section.lower() == "meetings"',
        ],
      },
    ],
  ],
  ['!/*', [{ not: ['task.section'] }]],
  ['%email', ['task.hasTag("email")']],
  ['@email', ['task.hasTag("email")']],
  ['no labels', ['task.tags.isEmpty()']],
  ['search: Meeting', ['task.text.lower().contains("meeting")']],
  ['subtask', ['task.subtask']],
  ['!subtask', [{ not: ['task.subtask'] }]],
  ['assigned to: others', ['task.assignee && !task.mine']],
  ['assigned to: me', ['task.mine']],
  ['assigned', ['task.assignee']],
  ['created: today', ['if(task.created, task.created, file.ctime.date()) == today()']],
  [
    'created before: -365 days',
    ['if(task.created, task.created, file.ctime.date()) < today() - "365d"'],
  ],
  [
    'created: Jan 3 2023',
    ['if(task.created, task.created, file.ctime.date()) == date("2023-01-03")'],
  ],
  ['%urgent*', ['task.tags.filter(/^urgent.*$/i.matches(value)).length > 0']],
  ['#*Work', ['/^.*Work$/i.matches(file.basename)']],
  ['/*Work*', ['task.section && /^.*Work.*$/i.matches(task.section)']],
  ['view all', ['true']],
  ['shared', ['file.shared']],
  ['today & %email', [{ and: ['task.date == today()', 'task.hasTag("email")'] }]],
  [
    '(p1 | p2) & 7 days',
    [
      {
        and: [
          { or: ['task.priority == 1', 'task.priority == 2'] },
          'task.date >= today() && task.date < today() + "7d"',
        ],
      },
    ],
  ],
  ['today | overdue, no date', [{ or: ['task.date == today()', TREES_OVERDUE()] }, '!task.date']],
  ['#a\\&b', ['task.hasTag("a&b")']],
  ['heute & überfällig', [{ and: ['task.date == today()', TREES_OVERDUE()] }]],
  ['fri', ['task.date == today() + duration(((5 - number(today().format("E")) + 7) % 7) + "d")']],
  ['6/10', ['task.date == date("2026-10-06")']],
]

function TREES_OVERDUE(): string {
  return 'task.date < today() || (task.date == today() && task.time && task.time < now().format("HH:mm"))'
}

describe("Todoist's documented filters", () => {
  test.each(TREES)('%s', (source, expected) => {
    expect(fromTodoist(source, options)).toEqual(expected)
  })

  test('a US reader writes the month first', () => {
    expect(fromTodoist('6/10', { ...options, lang: 'en-US' })).toEqual([
      'task.date == date("2026-06-10")',
    ])
  })
})

describe('what a filter it compiles to keeps', () => {
  const rows: Row[] = [
    taskRow('Work.md', '- [ ] Write report 🔺 📅 2026-10-04', 0, { section: ['Meetings'] }),
    taskRow('Work.md', '- [ ] Old thing #email 📅 2026-09-20', 1),
    taskRow('Home.md', '- [ ] Paint [assignee:: Emil] 📅 2026-10-08', 0),
    taskRow('Home.md', '- [ ] Someday', 1),
    taskRow('Home.md', '- [ ] Call [time:: 09:00] 📅 2026-10-04', 2),
  ]
  const context = contextAt()
  const kept = (source: string) =>
    rows
      .filter((row) =>
        fromTodoist(source, options).some((filter) => compileFilter(filter)(row, context)),
      )
      .map((row) => row.task?.text)

  test.each<[string, (string | undefined)[]]>([
    ['today', ['Write report', 'Call']],
    ['overdue', ['Old thing', 'Call']],
    ['no date', ['Someday']],
    ['7 days', ['Write report', 'Paint', 'Call']],
    ['p1', ['Write report']],
    ['#Work', ['Write report', 'Old thing']],
    ['/Meetings', ['Write report']],
    ['%email', ['Old thing']],
    ['assigned to: me', ['Paint']],
    ['search: paint', ['Paint']],
    ['today | overdue', ['Write report', 'Old thing', 'Call']],
    ['!#Work & !no date', ['Paint', 'Call']],
    ['date before: +4 hours', ['Old thing', 'Write report', 'Call'].sort()],
  ])('%s keeps %j', (source, expected) => {
    expect(kept(source).sort()).toEqual([...expected].sort())
  })
})

describe('mistakes', () => {
  test.each([
    ['frobnicate', '"frobnicate" is not a filter'],
    ['(today', 'A "(" is not closed'],
    ['today &', 'The filter ends too soon'],
    ['date: someday', '"someday" is not a date'],
  ])('%s says %s', (source, message) => {
    expect(() => fromTodoist(source, options)).toThrow(message)
  })
})
