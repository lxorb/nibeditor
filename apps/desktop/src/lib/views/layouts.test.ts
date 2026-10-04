import { answer, type Base, builtinView, readBase, type Row } from '@nib/bases'
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

/** What each layout draws for an answer: the rows, the groups, the columns, the days.
 *  Rendered on the server, as the panels' tests are: the markup is what a reader gets.
 *  What a press writes is act.ts's and drop.ts's, tested in logic.test.ts, and the drive
 *  (test/e2e/tasks.py) drags and ticks in a browser. */

vi.mock('../rooms.svelte', () => ({ rooms: { present: {}, following: null } }))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    of: () => [],
    at: () => [],
    watch: () => () => undefined,
    write: () => Promise.resolve(true),
    inbox: () => Promise.resolve(null),
    inboxes: () => [],
  },
}))

const { contextFor } = await import('./context')
const { columnsOf } = await import('./columns')
const { noteRow, taskRow } = await import('./fixture')
const { kitFor } = await import('./kit')
const ListLayout = (await import('./ListLayout.svelte')).default
const TableLayout = (await import('./TableLayout.svelte')).default
const CardsLayout = (await import('./CardsLayout.svelte')).default
const BoardLayout = (await import('./BoardLayout.svelte')).default
const CalendarLayout = (await import('./CalendarLayout.svelte')).default
const UpcomingLayout = (await import('./UpcomingLayout.svelte')).default
const TimelineLayout = (await import('./TimelineLayout.svelte')).default
const ChartLayout = (await import('./ChartLayout.svelte')).default
const AgendaLayout = (await import('./AgendaLayout.svelte')).default
const PhoneRows = (await import('./PhoneRows.svelte')).default
const ViewFrame = (await import('./ViewFrame.svelte')).default

const TODAY = '2026-10-04'

/** A view on screen, as the layouts read one: what LiveView would hold for this base
 *  over these rows. */
function kitOf(base: Base, rows: readonly Row[], spec = {}) {
  const context = contextFor({ rows, today: TODAY, now: `${TODAY}T10:00:00` })
  const live = {
    base,
    at: 0,
    view: base.views[0] ?? null,
    rows,
    context,
    today: TODAY,
    typed: '',
    failed: false,
    answer: answer(base, 0, rows, context),
    columns: columnsOf(base, 0, rows),
    search: () => undefined,
    change: () => Promise.resolve(),
    reload: () => Promise.resolve(),
  }
  // A LiveView is a store with runes; the layouts read only these fields of it.
  return kitFor(live as unknown as Parameters<typeof kitFor>[0], spec, null, false)
}

const TASKS = [
  taskRow('Errands.md', '- [ ] Call the bank [time:: 16:00] ⏫ 📅 2026-10-01', 2, {
    section: ['Errands'],
  }),
  taskRow('Errands.md', '  - [ ] Find the card', 3, { section: ['Errands'], parent: 2, indent: 2 }),
  taskRow('Errands.md', '- [ ] Milk #shop 📅 2026-10-04', 5, { section: ['Shop'] }),
  taskRow('Thesis.md', '- [/] Draft the talk [duration:: 2h] 📅 2026-10-08', 1),
]

const BUGS = readBase(`nib:
  properties:
    status:
      options:
        - { value: To do, tone: neutral }
        - { value: Doing, tone: info }
        - { value: Done, tone: success }
views:
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
    order: [file.name, note.status, note.due]
`)
const NOTES = [
  noteRow('Bugs/Sync.md', 'status: Doing\ndue: 2026-10-06\npoints: 3'),
  noteRow('Bugs/Glass.md', 'status: To do\ndue: 2026-10-09\npoints: 5'),
]

describe('the list', () => {
  test('draws Today as Overdue and Today, each with its rows and an add row', () => {
    const html = render(ListLayout, { props: { kit: kitOf(builtinView('today'), TASKS) } }).body
    expect(html).toContain('Overdue')
    expect(html.indexOf('Call the bank')).toBeLessThan(html.indexOf('Milk'))
    expect(html).toContain('16:00')
    expect(html).toContain('Errands')
    expect(html.match(/Add task/g)?.length).toBe(2)
    expect(html).toContain('Reschedule to today')
  })

  test('puts a sub-task under its parent in a project', () => {
    const base = builtinView('project', { note: { space: 'Notes', path: 'Errands.md' } })
    const html = render(ListLayout, { props: { kit: kitOf(base, TASKS), where: false } }).body
    expect(html.indexOf('Call the bank')).toBeLessThan(html.indexOf('Find the card'))
    expect(html).toContain('--depth: 1')
    expect(html).toContain('aria-expanded="true"')
  })
})

describe('the table', () => {
  test('has a column per property and a cell per row', () => {
    const base = readBase(
      'views:\n  - type: table\n    order: [file.name, note.status, note.points]\n    summaries: { note.points: Sum }\n',
    )
    const html = render(TableLayout, { props: { kit: kitOf(base, NOTES) } }).body
    expect(html.match(/role="columnheader"/g)).toHaveLength(3)
    expect(html).toContain('Sync.md')
    expect(html).toContain('Doing')
    expect(html).toContain('8')
  })
})

describe('the cards', () => {
  test('are a card per row with its other properties under it', () => {
    const html = render(CardsLayout, { props: { kit: kitOf(BUGS, NOTES) } }).body
    expect(html.match(/class="card /g)).toHaveLength(2)
    expect(html).toContain('Glass')
  })
})

describe('the board', () => {
  test('keeps a column for every option, in the options’ order, empty ones too', () => {
    const html = render(BoardLayout, { props: { kit: kitOf(BUGS, NOTES) } }).body
    const heads = [...html.matchAll(/class="name[^"]*">([^<]+)</g)].map(([, name]) => name)
    expect(heads).toEqual(['To do', 'Doing', 'Done'])
    expect(html).toContain('Sync')
  })

  test('groups task lines by their box', () => {
    const base = readBase(
      'views:\n  - type: kanban\n    groupBy: { property: task.status, direction: ASC }\n    nib: { rows: tasks }\n',
    )
    const html = render(BoardLayout, { props: { kit: kitOf(base, TASKS) } }).body
    expect(html).toContain('To do')
    expect(html).toContain('Doing')
  })
})

describe('the calendar', () => {
  test('is a month of days with the rows on theirs', () => {
    const base = readBase('views:\n  - type: calendar\n    nib: { rows: tasks }\n')
    const html = render(CalendarLayout, { props: { kit: kitOf(base, TASKS) } }).body
    expect(html).toContain('Milk')
    expect(html).toContain('Draft the talk')
    expect(html.match(/class="day /g)?.length).toBeGreaterThanOrEqual(28)
    expect(html).toMatch(/class="day [^"]*today/)
  })
})

describe('Upcoming', () => {
  test('is a week strip over the days', () => {
    const html = render(UpcomingLayout, {
      props: { kit: kitOf(builtinView('upcoming'), TASKS) },
    }).body
    expect(html.match(/class="day /g)).toHaveLength(7)
    expect(html).toContain('Draft the talk')
  })
})

describe('the timeline', () => {
  test('is a bar per dated row beside its name', () => {
    const base = readBase('views:\n  - type: timeline\n    nib: { rows: tasks }\n')
    const html = render(TimelineLayout, { props: { kit: kitOf(base, TASKS) } }).body
    expect(html.match(/class="span/g)).toHaveLength(3)
    expect(html).toContain('Draft the talk')
  })
})

describe('the chart', () => {
  test('is a bar per group', () => {
    const base = readBase(
      'views:\n  - type: chart\n    groupBy: { property: note.status, direction: ASC }\n',
    )
    const html = render(ChartLayout, { props: { kit: kitOf(base, NOTES) } }).body
    expect(html.match(/<rect/g)).toHaveLength(2)
  })
})

describe('on a phone', () => {
  test('the calendar is an agenda and the table rows with their properties', () => {
    const base = readBase('views:\n  - type: calendar\n    nib: { rows: tasks }\n')
    const agenda = render(AgendaLayout, { props: { kit: kitOf(base, TASKS) } }).body
    expect(agenda).toContain('Today')
    expect(agenda).toContain('Milk')
    const rows = render(PhoneRows, { props: { kit: kitOf(BUGS, NOTES) } }).body
    expect(rows).toContain('Doing')
  })
})

describe('the frame', () => {
  test('wears the head with its layout switch, its tools and the view', () => {
    const html = render(ViewFrame, {
      props: { kit: kitOf(builtinView('today'), TASKS), title: 'Today' },
    }).body
    expect(html.match(/role="tab"/g)?.length).toBeGreaterThanOrEqual(6)
    expect(html).toContain('aria-label="Filter"')
    expect(html).toContain('aria-label="Sort"')
    expect(html).toContain('aria-label="Group"')
    expect(html).toContain('Call the bank')
  })
})
