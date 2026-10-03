import { expect, test } from 'vitest'
import { answer, compileView } from './answer'
import { readBase } from './base-file'
import { builtinView } from './builtins'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Row } from './types'

/** What a view costs over a big space: ten thousand task rows across five thousand
 *  notes, the size docs/tasks.md budgets for, answered as Today (two filters, a
 *  formula, a grouping, two sorts) and as a table of five thousand notes (a filter,
 *  a formula, a grouping, a sort, three summaries).
 *
 *  On the machine this was written on, a Snapdragon X Elite with other agents'
 *  builds on it, measured in this runner: Today over 10,000 tasks 12 to 17 ms
 *  answered whole (5.4 to 7.5 ms bundled and run in plain Node, where the test
 *  runner's module wrapping is not in the way) and 1.5 to 2.7 ms answered again after
 *  one row changed; the notes table 8 to 15 ms whole. Counting days once per date
 *  (dates.ts) took Today from 17 to 19 ms down to 12 to 13. The clock
 *  is asked only of a run that set `NIB_PERF=1` (see search/fuzzy.perf.test.ts in
 *  the app for why); the bound is the design's, 20 ms, and a change of shape (work
 *  that grows with something other than the rows) misses it by far more than a busy
 *  machine does. */
const CLOCKED = process.env.NIB_PERF === '1'

const context = contextAt()
const days = ['2026-09-28', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-09', '2026-11-01']
const marks = [' ', ' ', ' ', 'x', '/']

const tasks: Row[] = Array.from({ length: 10_000 }, (_, at) =>
  taskRow(
    `Folder ${at % 40}/Note ${at % 5000}.md`,
    `- [${marks[at % marks.length] ?? ' '}] Task ${at} #tag${at % 7} ${['🔺', '⏫', '', ''][at % 4] ?? ''} 📅 ${days[at % days.length] ?? ''}`,
    at % 20,
    { section: [`Heading ${at % 3}`] },
  ),
)
const notes: Row[] = Array.from({ length: 5000 }, (_, at) =>
  noteRow(`Folder ${at % 40}/Note ${at}.md`, {
    status: ['To do', 'Doing', 'Done'][at % 3] ?? null,
    pages: at % 700,
    rating: at % 5,
  }),
)

const table = readBase(`filters:
  and:
    - file.inFolder("Folder 1") || pages > 100
formulas:
  long: pages > 400
views:
  - type: table
    name: T
    groupBy:
      property: status
      direction: ASC
    sort:
      - property: pages
        direction: DESC
    summaries:
      pages: Sum
      rating: Average
      formula.long: Checked
`)

/** Milliseconds per call, the best of a few: the floor, which is the work. */
function timed(run: () => unknown, times = 5): number {
  let best = Infinity
  for (let one = 0; one < times; one++) {
    const started = performance.now()
    run()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

test('Today over ten thousand tasks', () => {
  const today = builtinView('today')
  const result = answer(today, 0, tasks, context)
  expect(result.total).toBeGreaterThan(1000)

  const whole = timed(() => answer(builtinView('today'), 0, tasks, context))
  if (CLOCKED) expect(whole).toBeLessThan(20)
})

test('answered again after one row changed', () => {
  const view = compileView(builtinView('today'))
  view.answer(tasks, context)
  const changed = [...tasks]
  changed[5] = taskRow('Folder 5/Note 5.md', '- [ ] Changed 📅 2026-10-04', 5)
  const again = timed(() => view.answer(changed, context))
  expect(
    view
      .answer(changed, context)
      .groups.some((group) => group.rows.some((row) => row.task?.text === 'Changed')),
  ).toBe(true)
  if (CLOCKED) expect(again).toBeLessThan(10)
})

test('a table of five thousand notes, grouped and summarised', () => {
  const result = answer(table, 'T', notes, context)
  expect(result.groups.map((group) => group.key)).toEqual(['Doing', 'Done', 'To do'])

  // A copy each time, so nothing a previous answer kept is reused.
  const whole = timed(() => answer(structuredClone(table), 'T', notes, context))
  if (CLOCKED) expect(whole).toBeLessThan(20)
})
