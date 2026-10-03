import { describe, expect, test } from 'vitest'
import { answer, cellValue, compileView, groupName, rowId, viewOf } from './answer'
import { DEFAULT_SUMMARIES } from './summaries'
import { readBase } from './base-file'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Answer, Row, Value } from './types'

const context = contextAt()
const names = (rows: readonly Row[]) => rows.map((row) => row.task?.text ?? row.file.basename)
const groups = (result: Answer) => result.groups.map((group) => [group.key, names(group.rows)])

const books = [
  noteRow(
    'Books/Dune.md',
    'status: Doing\npages: 412\nrating: 5\nread: true\nfinished: 2026-09-01',
  ),
  noteRow('Books/Emma.md', 'status: To do\npages: 474\nrating: 3\nread: false'),
  noteRow('Books/Ulysses.md', 'status: Done\npages: 730\nread: true\nfinished: 2026-06-01'),
  noteRow('Books/Beloved.md', 'status: Doing\npages: 324\nrating: 4\nread: false'),
  noteRow('Films/Heat.md', 'status: Done\nrating: 5'),
]

const base = readBase(`filters:
  and:
    - file.inFolder("Books")
formulas:
  long: pages > 400
properties:
  status:
    displayName: Status
summaries:
  doubled: values.sum() * 2
views:
  - type: table
    name: All
    order:
      - file.name
      - status
      - pages
    sort:
      - property: pages
        direction: DESC
    summaries:
      pages: Sum
      rating: Average
      read: Checked
      finished: Latest
      status: Unique
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    nib:
      order:
        Doing: [Books/Beloved.md]
  - type: table
    name: Long
    filters:
      and:
        - formula.long
    limit: 1
    sort:
      - property: file.name
        direction: ASC
  - type: table
    name: Custom
    summaries:
      pages: doubled
nib:
  properties:
    status:
      options:
        - { value: To do, group: todo }
        - { value: Doing, group: doing }
        - { value: Review, group: doing }
        - { value: Done, group: done }
`)

describe('a view of notes', () => {
  test("filters by the base's filter, sorts by the view's sort", () => {
    const result = answer(base, 'All', books, context)
    expect(result.total).toBe(4)
    expect(groups(result)).toEqual([[null, ['Ulysses', 'Emma', 'Dune', 'Beloved']]])
  })

  test('summarises with the defaults', () => {
    expect(answer(base, 'All', books, context).summaries).toEqual({
      pages: 1940,
      rating: 4,
      read: 2,
      finished: { kind: 'date', iso: '2026-09-01' },
      status: 3,
    })
  })

  test("summarises with the base's own formula over values", () => {
    expect(answer(base, 'Custom', books, context).summaries).toEqual({ pages: 3880 })
  })

  test('groups in the order the options say, empty groups kept, and a manual order first', () => {
    const result = answer(base, 'Board', books, context)
    expect(groups(result)).toEqual([
      ['To do', ['Emma']],
      ['Doing', ['Beloved', 'Dune']],
      ['Review', []],
      ['Done', ['Ulysses']],
    ])
  })

  test("a view's filters add to the base's, formulas included, and the limit comes after the sort", () => {
    expect(groups(answer(base, 'Long', books, context))).toEqual([[null, ['Dune']]])
  })

  test("the view's own search looks through what the view shows", () => {
    expect(
      names(answer(base, 'All', books, { ...context, search: 'doing' }).groups[0]?.rows ?? []),
    ).toEqual(['Dune', 'Beloved'])
    expect(
      names(answer(base, 'All', books, { ...context, search: 'emm 474' }).groups[0]?.rows ?? []),
    ).toEqual(['Emma'])
  })

  test('the first view when none is named, and a cell as the view shows it', () => {
    expect(answer(base, undefined, books, context).total).toBe(4)
    const dune = books[0]
    if (!dune) throw new Error('no row')
    expect(cellValue(base, 'formula.long', dune, context)).toBe(true)
    expect(cellValue(base, 'note.status', dune, context)).toBe('Doing')
  })
})

describe('groups', () => {
  const rows = [
    noteRow('a.md', 'kind: b\nsize: 2'),
    noteRow('b.md', 'kind: a\nsize: 1'),
    noteRow('c.md', 'size: 3'),
    noteRow('d.md', 'kind: b\nsize: 1'),
  ]

  test('by value either way round, the group with no value last', () => {
    const view = (direction: string) =>
      readBase(
        `views:\n  - type: list\n    name: L\n    groupBy:\n      property: kind\n      direction: ${direction}\n`,
      )
    expect(groups(answer(view('ASC'), 'L', rows, context))).toEqual([
      ['a', ['b']],
      ['b', ['a', 'd']],
      [null, ['c']],
    ])
    expect(groups(answer(view('DESC'), 'L', rows, context)).map(([key]) => key)).toEqual([
      'b',
      'a',
      null,
    ])
  })

  test('a sub-group splits each group, with its own summaries', () => {
    const view = readBase(`views:
  - type: kanban
    name: K
    groupBy:
      property: kind
      direction: ASC
    summaries:
      size: Sum
    nib:
      subGroupBy:
        property: size
        direction: ASC
`)
    const result = answer(view, 'K', rows, context)
    const b = result.groups[1]
    expect(b?.summaries).toEqual({ size: 3 })
    expect(b?.sub?.map((group) => [group.key, names(group.rows), group.summaries])).toEqual([
      [1, ['d'], { size: 1 }],
      [2, ['a'], { size: 2 }],
    ])
  })

  test('in the order their first row comes, for headings', () => {
    const tasks = [
      taskRow('P.md', '- [ ] one', 2, { section: ['Zeta'] }),
      taskRow('P.md', '- [ ] two', 5, { section: ['Alpha'] }),
      taskRow('P.md', '- [ ] three', 7, { section: ['Zeta'] }),
    ]
    const view = readBase(`views:
  - type: list
    name: P
    groupBy:
      property: task.section
      direction: ASC
    nib:
      rows: tasks
      groupOrder: rows
`)
    expect(groups(answer(view, 'P', tasks, context))).toEqual([
      ['Zeta', ['one', 'three']],
      ['Alpha', ['two']],
    ])
  })
})

describe('a view of tasks', () => {
  const rows = [
    noteRow('Inbox.md'),
    taskRow('Inbox.md', '- [ ] Call the bank ⏫ 📅 2026-10-04', 0),
    taskRow('Inbox.md', '- [x] Water ✅ 2026-10-03', 1),
    taskRow('Inbox.md', '- [ ] Pay 🔺 📅 2026-10-02', 2),
    taskRow('Inbox.md', '- [-] Gym ❌ 2026-10-01', 3),
  ]
  const tasks = readBase(`views:
  - type: list
    name: Open
    sort:
      - property: task.priority
        direction: ASC
    nib:
      rows: tasks
  - type: list
    name: All
    nib:
      rows: both
      showCompleted: true
`)

  test('takes task rows only, done and cancelled ones out unless asked', () => {
    expect(names(answer(tasks, 'Open', rows, context).groups[0]?.rows ?? [])).toEqual([
      'Pay',
      'Call the bank',
    ])
    expect(answer(tasks, 'All', rows, context).total).toBe(5)
  })
})

describe('answering again', () => {
  test('reuses what it knew about rows that did not change, and sees the one that did', () => {
    let runs = 0
    const counting = readBase(`formulas:
  seen: file.name
views:
  - type: table
    name: T
    filters:
      and:
        - formula.seen.length > 0
    sort:
      - property: size
        direction: ASC
`)
    const view = compileView(counting, 'T')
    const rows = Array.from({ length: 50 }, (_, at) => noteRow(`n${at}.md`, { size: 50 - at }))
    const counted = rows.map(
      (row) =>
        new Proxy(row, {
          get: (target, key): unknown => {
            if (key === 'file') runs++
            return Reflect.get(target, key) as unknown
          },
        }),
    )
    view.answer(counted, context)
    const first = runs
    const changed = noteRow('n0.md', { size: 100 })
    const next = [changed, ...counted.slice(1)]
    runs = 0
    const result = view.answer(next, context)
    expect(first).toBeGreaterThan(0)
    expect(runs).toBeLessThan(first / 10)
    expect(result.groups[0]?.rows.at(-1)).toBe(changed)
  })

  test('starts again when the day changes', () => {
    const today = readBase(
      'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - due == today()\n',
    )
    const rows = [noteRow('a.md', 'due: 2026-10-04'), noteRow('b.md', 'due: 2026-10-05')]
    expect(names(answer(today, 'T', rows, context).groups[0]?.rows ?? [])).toEqual(['a'])
    expect(
      names(answer(today, 'T', rows, contextAt({ today: '2026-10-05' })).groups[0]?.rows ?? []),
    ).toEqual(['b'])
  })
})

describe('a filter that fails on a row', () => {
  test('leaves that row out and the view stands', () => {
    const odd = readBase(
      'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - title.lower() == "x"\n',
    )
    const rows: Row[] = [noteRow('a.md', { title: 'X' }), noteRow('b.md', { title: 5 as Value })]
    expect(names(answer(odd, 'T', rows, context).groups[0]?.rows ?? [])).toEqual(['a'])
  })
})

describe('the names a view gives', () => {
  test('a view by name, by place, or the first', () => {
    expect(viewOf(base, 'Board')?.type).toBe('kanban')
    expect(viewOf(base, 2)?.name).toBe('Long')
    expect(viewOf(base, 'nope')?.name).toBe('All')
  })

  test('a group by its key as text, the group of nothing as empty', () => {
    expect(groupName('Doing')).toBe('Doing')
    expect(groupName(null)).toBe('')
    expect(groupName({ kind: 'date', iso: '2026-10-04' })).toBe('2026-10-04')
  })

  test('a row by its path, a task by its line too', () => {
    expect(rowId(noteRow('a.md'))).toBe('a.md')
    expect(rowId(taskRow('a.md', '- [ ] x', 7))).toBe('a.md#7')
  })

  test('every default summary has a name a view can use', () => {
    const rows = [noteRow('a.md', { n: 1, b: true }), noteRow('b.md', { n: 3, b: false })]
    for (const name of DEFAULT_SUMMARIES) {
      const one = readBase(
        `views:\n  - type: table\n    name: S\n    summaries:\n      n: ${name}\n`,
      )
      expect(answer(one, 'S', rows, context).summaries.n, name).not.toBeUndefined()
    }
  })
})
