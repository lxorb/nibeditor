import { describe, expect, test } from 'vitest'
import { answer } from './answer'
import { contextAt, taskRow } from './fixtures/rows'
import { readTasksQuery } from './tasks-query'
import type { Row } from './types'

const context = contextAt()
const rows: Row[] = [
  taskRow('Work/Plan.md', '- [ ] Write report 🔺 📅 2026-10-04', 0, { section: ['Q4'] }),
  taskRow('Work/Plan.md', '- [ ] Old thing #email 📅 2026-09-20', 1, { section: ['Q3'] }),
  taskRow('Home.md', '- [ ] Paint 🔁 every week ⏳ 2026-10-08', 0),
  taskRow('Home.md', '- [ ] Someday 🛫 2026-11-01', 1),
  taskRow('Home.md', '- [x] Water ✅ 2026-10-03', 2),
  taskRow('Home.md', '- [/] Halfway 🔽', 3),
]
const kept = (query: string) => {
  const { base } = readTasksQuery(query)
  return answer(base, 0, rows, context).groups.flatMap((group) =>
    group.rows.map((row) => row.task?.text),
  )
}

describe('a tasks fence', () => {
  test.each<[string, string[]]>([
    ['not done', ['Write report', 'Old thing', 'Paint', 'Someday', 'Halfway']],
    ['done', ['Water']],
    ['due before tomorrow', ['Write report', 'Old thing']],
    ['due today', ['Write report']],
    ['due on 2026-09-20', ['Old thing']],
    ['due after 2026-09-30', ['Write report']],
    ['no due date', ['Paint', 'Someday', 'Water', 'Halfway']],
    ['has scheduled date', ['Paint']],
    // 2026-10-04 is a Sunday: this week ends today, and the 8th is next week's.
    ['scheduled this week', []],
    ['happens next week', ['Paint']],
    ['happens last week', []],
    ['starts before today', ['Write report', 'Old thing', 'Paint', 'Water', 'Halfway']],
    ['is recurring', ['Paint']],
    ['priority is highest', ['Write report']],
    ['priority is above none', ['Write report']],
    ['priority is below none', ['Halfway']],
    ['path includes work', ['Write report', 'Old thing']],
    ['path does not include Work', ['Paint', 'Someday', 'Water', 'Halfway']],
    ['filename includes home', ['Paint', 'Someday', 'Water', 'Halfway']],
    ['description includes REPORT', ['Write report']],
    ['heading includes q3', ['Old thing']],
    ['tags include #email', ['Old thing']],
    ['tag does not include email', ['Write report', 'Paint', 'Someday', 'Water', 'Halfway']],
    ['status.type is IN_PROGRESS', ['Halfway']],
    ['(due today) OR (is recurring)', ['Write report', 'Paint']],
    ['(not done) AND NOT (path includes Work)', ['Paint', 'Someday', 'Halfway']],
    ['NOT (done)', ['Write report', 'Old thing', 'Paint', 'Someday', 'Halfway']],
    ['not done\npath includes Home\nlimit 2', ['Paint', 'Someday']],
    ['not done\nsort by priority', ['Write report', 'Old thing', 'Paint', 'Someday', 'Halfway']],
    ['not done\nsort by priority reverse\nlimit to 1 tasks', ['Halfway']],
  ])('%j', (query, expected) => {
    expect(kept(query)).toEqual(expected)
  })

  test('groups by what the plugin groups by, one level and a second under it', () => {
    const { base } = readTasksQuery('not done\ngroup by filename\ngroup by heading')
    expect(base.views[0]?.groupBy).toEqual({ property: 'file.basename', direction: 'ASC' })
    expect(base.views[0]?.nib.subGroupBy).toEqual({ property: 'task.section', direction: 'ASC' })
    const result = answer(base, 0, rows, context)
    expect(result.groups.map((group) => group.key)).toEqual(['Home', 'Plan'])
  })

  test("lines about drawing are nib's to decide, and lines it cannot read are said", () => {
    const query = readTasksQuery(
      'not done\nshort mode\nhide edit button\nexplain\n# a comment\nfrobnicate wildly\ngroup by urgency score',
    )
    expect(query.unsupported).toEqual(['frobnicate wildly', 'group by urgency score'])
    expect(query.base.views[0]?.filters).toBe('!task.done && !task.cancelled')
  })
})
