import { describe, expect, test } from 'vitest'
import { changedTask, taskLine, type TaskChange, writeTask } from './task-edits'
import { readTask } from './task-line'

/** Lines already in nib's order, which a read and a whole write give back byte for
 *  byte: the Tasks plugin's documented emoji lines and the design's examples. */
const CANONICAL = [
  '- [ ] #task Has a created date ➕ 2023-04-13',
  '- [ ] #task Has a scheduled date ⏳ 2023-04-14',
  '- [ ] #task Has a start date 🛫 2023-04-15',
  '- [ ] #task Has a due date 📅 2023-04-16',
  '- [x] #task Has a done date ✅ 2023-04-17',
  '- [-] #task Has a cancelled date ❌ 2023-04-18',
  '- [ ] #task Lowest priority ⏬',
  '- [ ] #task Low priority 🔽',
  '- [ ] #task Normal priority',
  '- [ ] #task Medium priority 🔼',
  '- [ ] #task High priority ⏫',
  '- [ ] #task Highest priority 🔺',
  '- [ ] #task Is a recurring task 🔁 every day when done',
  '- [ ] #task Keep this task when done too 🏁 keep',
  '- [ ] #task Remove this task when done 🏁 delete',
  '- [ ] #task Remove completed instance of this recurring task when done 🔁 every day 🏁 delete',
  '- [ ] #task do this first 🆔 dcf64c',
  '- [ ] #task do this after first and some other task ⛔ dcf64c,0h17ye',
  '- [ ] take out the trash 🔁 every Sunday 📅 2021-05-02',
  '- [x] take out the trash 🔁 every Sunday 📅 2021-04-25 ✅ 2021-04-24',
  '- [ ] take out the trash 🔁 every Sunday ➕ 2023-03-10 📅 2021-05-02',
  '- [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-11-11 📅 2021-11-13',
  '- [ ] do stuff 🔁 every month on the last 📅 2022-06-30',
  '- [ ] Call the bank about the card [time:: 16:00] [remind:: 15m] #admin ⏫ 📅 2026-10-06',
  '- [ ] Water the plants 🔁 every 3 days when done 📅 2026-10-04',
  '- [x] Water the plants 🔁 every 3 days when done 📅 2026-10-01 ✅ 2026-10-01',
  '- [/] Draft the talk [duration:: 2h] [deadline:: 2026-10-20] ⏳ 2026-10-08',
  '- [-] Renew the gym ❌ 2026-09-30',
  '- [ ] Review [time:: 09:30 Europe/Zurich] [assignee:: Lucile] #work 🆔 a1 ⛔ b2,c3 🔺 🔁 every weekday ➕ 2026-10-01 🛫 2026-10-02 ⏳ 2026-10-03 📅 2026-10-04 ^blk',
]

describe('a canonical line', () => {
  test.each(CANONICAL)('reads and writes back unchanged: %s', (line) => {
    const fields = readTask(line)
    expect(fields).not.toBeNull()
    if (!fields) return
    expect(taskLine(fields)).toBe(line)
  })

  test.each(CANONICAL)('takes no edit for a change to what it already says: %s', (line) => {
    const fields = readTask(line)
    if (!fields) return
    expect(writeTask(line, {})).toEqual([])
    expect(writeTask(line, fields)).toEqual([])
  })
})

/** Changes, and the line each one leaves. */
const CHANGES: [string, TaskChange, string][] = [
  ['- [ ] a', { due: '2026-10-06' }, '- [ ] a 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { due: '2026-10-07' }, '- [ ] a 📅 2026-10-07'],
  ['- [ ] a 📅 2026-10-06', { due: null }, '- [ ] a'],
  ['- [ ] a 📅 2026-10-06', { priority: 2 }, '- [ ] a ⏫ 📅 2026-10-06'],
  ['- [ ] a ⏫ 📅 2026-10-06', { priority: 1 }, '- [ ] a 🔺 📅 2026-10-06'],
  ['- [ ] a ⏫ 📅 2026-10-06', { priority: 4 }, '- [ ] a 📅 2026-10-06'],
  ['- [ ] a ⏫ 📅 2026-10-06', { priority: null }, '- [ ] a 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { scheduled: '2026-10-05' }, '- [ ] a ⏳ 2026-10-05 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { time: '16:00' }, '- [ ] a [time:: 16:00] 📅 2026-10-06'],
  ['- [ ] a #x 📅 2026-10-06', { time: '16:00' }, '- [ ] a [time:: 16:00] #x 📅 2026-10-06'],
  ['- [ ] a [time:: 16:00]', { time: '09:30' }, '- [ ] a [time:: 09:30]'],
  ['- [ ] a [time:: 16:00]', { zone: 'Europe/Zurich' }, '- [ ] a [time:: 16:00 Europe/Zurich]'],
  ['- [ ] a [time:: 16:00] 📅 2026-10-06', { time: null }, '- [ ] a 📅 2026-10-06'],
  [
    '- [ ] a',
    { duration: 90, remind: [{ before: 15 }] },
    '- [ ] a [duration:: 1h30m] [remind:: 15m]',
  ],
  [
    '- [ ] a',
    { deadline: '2026-10-20', assignee: 'Lucile' },
    '- [ ] a [deadline:: 2026-10-20] [assignee:: Lucile]',
  ],
  ['- [ ] a', { done: true, completed: '2026-10-04' }, '- [x] a ✅ 2026-10-04'],
  ['- [x] a ✅ 2026-10-04', { done: false, completed: null }, '- [ ] a'],
  [
    '- [ ] a 📅 2026-10-06',
    { cancelled: true, cancelledOn: '2026-10-04' },
    '- [-] a 📅 2026-10-06 ❌ 2026-10-04',
  ],
  ['- [ ] a 📅 2026-10-06', { status: '/' }, '- [/] a 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { recurrence: 'every week' }, '- [ ] a 🔁 every week 📅 2026-10-06'],
  ['- [ ] a 🔁 every week 📅 2026-10-06', { recurrence: null }, '- [ ] a 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { text: 'buy milk' }, '- [ ] buy milk 📅 2026-10-06'],
  ['- [ ] a #x 📅 2026-10-06', { text: 'b' }, '- [ ] b #x 📅 2026-10-06'],
  ['- [ ] a 📅 2026-10-06', { tags: ['admin'] }, '- [ ] a #admin 📅 2026-10-06'],
  ['- [ ] a #admin 📅 2026-10-06', { tags: [] }, '- [ ] a 📅 2026-10-06'],
  ['- [ ] call #mum today', { tags: [] }, '- [ ] call today'],
  ['- [ ] a 📅 2026-10-06 ^blk', { priority: 3 }, '- [ ] a 🔼 📅 2026-10-06 ^blk'],
  ['- [ ] a ^blk', { due: '2026-10-06' }, '- [ ] a 📅 2026-10-06 ^blk'],
  ['- [ ] a', { id: 'x1', dependsOn: ['y2'] }, '- [ ] a 🆔 x1 ⛔ y2'],
  // Fields out of nib's order stay where they are; a new one goes before the first
  // that ranks after it.
  ['- [ ] a 📅 2026-10-06 ⏫', { start: '2026-10-01' }, '- [ ] a 🛫 2026-10-01 📅 2026-10-06 ⏫'],
  // A line in Dataview's format stays in it.
  ['- [ ] a  [due:: 2026-10-06]', { priority: 2 }, '- [ ] a  [priority:: high] [due:: 2026-10-06]'],
  ['- [ ] a  [due:: 2026-10-06]', { due: '2026-10-07' }, '- [ ] a  [due:: 2026-10-07]'],
  ['- [ ] a  [priority:: high]', { priority: 1 }, '- [ ] a  [priority:: highest]'],
  // Unknown fields are kept, and can be set.
  ['- [ ] a [effort:: big] 📅 2026-10-06', { due: null }, '- [ ] a [effort:: big]'],
  ['- [ ] a [effort:: big]', { fields: { effort: 'small' } }, '- [ ] a [effort:: small]'],
  ['- [ ] a [effort:: big]', { fields: {} }, '- [ ] a'],
  // Fields among the words are carried over a change of the words.
  ['- [ ] a [assignee:: Lucile] b', { text: 'c' }, '- [ ] c [assignee:: Lucile]'],
  ['- [ ] a [assignee:: Lucile] b', { text: 'c', assignee: 'Emil' }, '- [ ] c [assignee:: Emil]'],
  // An empty task gets its fields after the box.
  ['- [ ] ', { due: '2026-10-06' }, '- [ ] 📅 2026-10-06'],
  ['  * [ ] nested', { due: '2026-10-06' }, '  * [ ] nested 📅 2026-10-06'],
]

describe('a change', () => {
  test.each(CHANGES)('%s with %o is %s', (line, change, after) => {
    expect(changedTask(line, change)).toBe(after)
  })

  test('touches only the characters that change', () => {
    expect(writeTask('- [ ] a ⏫ 📅 2026-10-06', { due: '2026-10-07' })).toEqual([
      { from: 13, to: 23, insert: '2026-10-07' },
    ])
    expect(writeTask('- [ ] a', { done: true })).toEqual([{ from: 3, to: 4, insert: 'x' }])
  })

  test('is nothing for a line that is not a task', () => {
    expect(writeTask('- a', { due: '2026-10-06' })).toEqual([])
  })

  test('keeps every Tasks field readable: nib fields never land after its fields', () => {
    const line = changedTask('- [ ] a ⏫ 📅 2026-10-06', { remind: [{ before: 15 }], tags: ['x'] })
    expect(line).toBe('- [ ] a [remind:: 15m] #x ⏫ 📅 2026-10-06')
    expect(readTask(line)).toMatchObject({ priority: 2, due: '2026-10-06', tags: ['x'] })
  })
})
