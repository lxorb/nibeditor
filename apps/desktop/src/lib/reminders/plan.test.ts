import { describe, expect, test } from 'vitest'
import { rowsIn } from './fixtures'
import { MOST, plan, samePlan } from './plan'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime()

describe('plan', () => {
  test('the next reminders across every space, earliest first, the past left out', () => {
    const rows = [
      ...rowsIn('Work', 'Plan.md', '- [ ] Call the bank [time:: 16:00] 📅 2026-10-06\n'),
      ...rowsIn('Home', 'Inbox.md', '- [ ] Water the plants [time:: 09:00] 📅 2026-10-05\n'),
      ...rowsIn('Home', 'Old.md', '- [ ] Missed [time:: 09:00] 📅 2026-10-03\n'),
    ]
    const planned = plan(rows, NOW, 0)
    expect(planned.map((one) => [one.title, one.at, one.space, one.body])).toEqual([
      ['Water the plants', at(5, 9), 'Home', 'Inbox'],
      ['Call the bank', at(6, 16), 'Work', 'Plan'],
    ])
  })

  test('a task names itself again by its note, its words and its line', () => {
    const [one] = plan(
      rowsIn(
        'Work',
        'a/Plan.md',
        '# Errands\n\n- [ ] Call [[Bank|the bank]] [remind:: 2026-10-05 08:00]\n',
      ),
      NOW,
      null,
    )
    expect(one).toMatchObject({ title: 'Call the bank', path: 'a/Plan.md', line: 2, space: 'Work' })
    expect(one?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('a moved task moves its reminder: a new id at the new minute, the old one gone', () => {
    const before = plan(rowsIn('W', 'P.md', '- [ ] Call [time:: 16:00] 📅 2026-10-06\n'), NOW, 0)
    const after = plan(rowsIn('W', 'P.md', '- [ ] Call [time:: 17:00] 📅 2026-10-06\n'), NOW, 0)
    expect(after.map((one) => one.at)).toEqual([at(6, 17)])
    expect(after[0]?.id).not.toBe(before[0]?.id)
  })

  test('the same task at the same minute is the same id, wherever its line went', () => {
    const before = plan(rowsIn('W', 'P.md', '- [ ] Call [time:: 16:00] 📅 2026-10-06\n'), NOW, 0)
    const after = plan(
      rowsIn('W', 'P.md', 'Intro\n\n- [ ] Call [time:: 16:00] 📅 2026-10-06\n'),
      NOW,
      0,
    )
    expect(after[0]?.id).toBe(before[0]?.id)
    expect(samePlan(before, after)).toBe(true)
  })

  test('a ticked task rings nothing, and a recurring one ticked rings its next line', () => {
    const done = '- [x] Call [time:: 16:00] 📅 2026-10-06 ✅ 2026-10-04\n'
    expect(plan(rowsIn('W', 'P.md', done), NOW, 0)).toEqual([])

    const ticked =
      '- [ ] Water [time:: 09:00] 🔁 every day 📅 2026-10-06\n' +
      '- [x] Water [time:: 09:00] 🔁 every day 📅 2026-10-05 ✅ 2026-10-04\n'
    expect(plan(rowsIn('W', 'P.md', ticked), NOW, 0).map((one) => one.at)).toEqual([at(6, 9)])
  })

  test('64 kept, the soonest', () => {
    const two = (value: number) => String(value).padStart(2, '0')
    const lines = Array.from(
      { length: 100 },
      (_, n) => `- [ ] Task ${n} [remind:: 2026-11-${two((n % 28) + 1)} ${two(n % 24)}:00]`,
    ).join('\n')
    const planned = plan(rowsIn('W', 'P.md', lines), NOW, null)
    expect(planned).toHaveLength(MOST)
    const all = plan(rowsIn('W', 'P.md', lines), NOW, null, 1000)
    expect(all).toHaveLength(100)
    expect(planned).toEqual(all.slice(0, MOST))
  })

  test('the automatic reminder follows the setting', () => {
    const rows = rowsIn('W', 'P.md', '- [ ] Call [time:: 16:00] [remind:: 1h] 📅 2026-10-06\n')
    expect(plan(rows, NOW, 30).map((one) => one.at)).toEqual([at(6, 15), at(6, 15, 30)])
    expect(plan(rows, NOW, null).map((one) => one.at)).toEqual([at(6, 15)])
  })
})
