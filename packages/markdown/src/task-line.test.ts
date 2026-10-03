import { describe, expect, test } from 'vitest'
import { readDuration, readRemind, readTask, readTime, type TaskFields } from './task-line'

/** The Tasks plugin's own documented lines (docs/Reference/Task Formats/Tasks Emoji
 *  Format.md and Dataview Format.md), and what each one says. */
const PLUGIN_LINES: [string, Partial<TaskFields>][] = [
  [
    '- [ ] #task Has a created date ➕ 2023-04-13',
    { created: '2023-04-13', text: '#task Has a created date' },
  ],
  ['- [ ] #task Has a scheduled date ⏳ 2023-04-14', { scheduled: '2023-04-14' }],
  ['- [ ] #task Has a start date 🛫 2023-04-15', { start: '2023-04-15' }],
  ['- [ ] #task Has a due date 📅 2023-04-16', { due: '2023-04-16' }],
  ['- [x] #task Has a done date ✅ 2023-04-17', { completed: '2023-04-17', done: true }],
  [
    '- [-] #task Has a cancelled date ❌ 2023-04-18',
    { cancelledOn: '2023-04-18', cancelled: true },
  ],
  ['- [ ] #task Lowest priority ⏬', { priority: 6 }],
  ['- [ ] #task Low priority 🔽', { priority: 5 }],
  ['- [ ] #task Normal priority', { priority: 4 }],
  ['- [ ] #task Medium priority 🔼', { priority: 3 }],
  ['- [ ] #task High priority ⏫', { priority: 2 }],
  ['- [ ] #task Highest priority 🔺', { priority: 1 }],
  ['- [ ] #task Is a recurring task 🔁 every day when done', { recurrence: 'every day when done' }],
  ['- [ ] #task Keep this task when done too 🏁 keep', { onCompletion: 'keep' }],
  [
    '- [ ] #task Remove completed instance of this recurring task when done 🔁 every day 🏁 delete',
    { recurrence: 'every day', onCompletion: 'delete' },
  ],
  ['- [ ] #task do this first 🆔 dcf64c', { id: 'dcf64c' }],
  [
    '- [ ] #task do this after first and some other task ⛔ dcf64c,0h17ye',
    { dependsOn: ['dcf64c', '0h17ye'] },
  ],
  ['- [ ] #task Has a created date  [created:: 2023-04-13]', { created: '2023-04-13' }],
  ['- [x] #task Has a done date  [completion:: 2023-04-17]', { completed: '2023-04-17' }],
  ['- [-] #task Has a cancelled date  [cancelled:: 2023-04-18]', { cancelledOn: '2023-04-18' }],
  ['- [ ] #task High priority  [priority:: high]', { priority: 2 }],
  [
    '- [ ] #task Is a recurring task [repeat:: every day when done]',
    { recurrence: 'every day when done' },
  ],
  [
    '- [ ] #task Remove completed instance of this recurring task when done  [repeat:: every day]  [onCompletion:: delete]',
    { recurrence: 'every day', onCompletion: 'delete' },
  ],
  [
    '- [ ] #task do this after first and some other task  [dependsOn:: dcf64c,0h17ye]',
    { dependsOn: ['dcf64c', '0h17ye'] },
  ],
  // The recurring examples of docs/Getting Started/Recurring Tasks.md.
  [
    '- [ ] take out the trash 🔁 every Sunday 📅 2021-04-25',
    { text: 'take out the trash', recurrence: 'every Sunday', due: '2021-04-25' },
  ],
  [
    '- [x] take out the trash 🔁 every Sunday 📅 2021-04-25 ✅ 2021-04-24',
    { recurrence: 'every Sunday', due: '2021-04-25', completed: '2021-04-24' },
  ],
  [
    '-   [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30',
    {
      text: 'Mow the lawn',
      recurrence: 'every 2 weeks',
      scheduled: '2021-10-28',
      due: '2021-10-30',
    },
  ],
]

describe('a task line read the way the Tasks plugin reads it', () => {
  test.each(PLUGIN_LINES)('%s', (line, expected) => {
    expect(readTask(line)).toMatchObject(expected)
  })

  test('is null for a line that is not a task', () => {
    expect(readTask('- buy milk')).toBeNull()
    expect(readTask('a [x] in a sentence')).toBeNull()
  })

  test('takes nib fields before the tags and the emoji', () => {
    const task = readTask(
      '- [ ] Call the bank about the card [time:: 16:00] [remind:: 15m] #admin ⏫ 📅 2026-10-06',
    )
    expect(task).toMatchObject({
      text: 'Call the bank about the card',
      time: '16:00',
      remind: [{ before: 15 }],
      tags: ['admin'],
      priority: 2,
      due: '2026-10-06',
    })
  })

  test('reads every example line of the design', () => {
    expect(
      readTask('- [x] Water the plants 🔁 every 3 days when done 📅 2026-10-01 ✅ 2026-10-01'),
    ).toMatchObject({
      done: true,
      recurrence: 'every 3 days when done',
      completed: '2026-10-01',
    })
    expect(
      readTask('- [/] Draft the talk [duration:: 2h] [deadline:: 2026-10-20] ⏳ 2026-10-08'),
    ).toMatchObject({
      status: '/',
      done: false,
      duration: 120,
      deadline: '2026-10-20',
      scheduled: '2026-10-08',
    })
    expect(readTask('- [-] Renew the gym ❌ 2026-09-30')).toMatchObject({
      cancelled: true,
      done: false,
    })
  })

  test('reads fields in any order, as the plugin does', () => {
    expect(readTask('- [ ] a 📅 2026-10-06 ⏫ 🛫 2026-10-01')).toMatchObject({
      due: '2026-10-06',
      priority: 2,
      start: '2026-10-01',
      text: 'a',
    })
  })

  test('reads the alternative emoji and the variation selector', () => {
    expect(readTask('- [ ] a 📆 2026-10-06')?.due).toBe('2026-10-06')
    expect(readTask('- [ ] a 🗓 2026-10-06')?.due).toBe('2026-10-06')
    expect(readTask('- [ ] a ⌛ 2026-10-06')?.scheduled).toBe('2026-10-06')
    expect(readTask('- [ ] a ⏫️')?.priority).toBe(2)
    expect(readTask('- [ ] a 📅️ 2026-10-06')?.due).toBe('2026-10-06')
  })

  test('stops at the first thing that is not a field', () => {
    // A due date in the middle of the words is words, as in the plugin.
    const task = readTask('- [ ] pay 📅 2026-10-06 the rent')
    expect(task?.due).toBeUndefined()
    expect(task?.text).toBe('pay 📅 2026-10-06 the rent')
  })

  test('keeps tags among the words and after them', () => {
    const task = readTask('- [ ] #work call #mum about #home/garden 📅 2026-10-06 #later')
    expect(task?.tags).toEqual(['work', 'mum', 'home/garden', 'later'])
    // The tag right before the fields is one of them, as the plugin reads it.
    expect(task?.text).toBe('#work call #mum about')
  })

  test('reads a block id at the very end', () => {
    expect(readTask('- [ ] a 📅 2026-10-06 ^abc-1')).toMatchObject({
      block: 'abc-1',
      due: '2026-10-06',
    })
  })

  test('reads bracket fields wherever they stand, and keeps the ones nib has no name for', () => {
    const task = readTask(
      '- [ ] Review [assignee:: Lucile] the PR [effort:: big] (due:: 2026-10-06)',
    )
    expect(task).toMatchObject({
      text: 'Review the PR',
      assignee: 'Lucile',
      due: '2026-10-06',
      fields: { effort: 'big' },
    })
  })

  test('keeps a value a field cannot hold as an unknown field', () => {
    const task = readTask('- [ ] a [due:: someday]')
    expect(task?.due).toBeUndefined()
    expect(task?.fields).toEqual({ due: 'someday' })
  })

  test('refuses dates that do not exist', () => {
    expect(readTask('- [ ] a 📅 2026-02-30')?.due).toBeUndefined()
  })

  test('reads a time with its zone', () => {
    expect(readTask('- [ ] a [time:: 16:00 Europe/Zurich]')).toMatchObject({
      time: '16:00',
      zone: 'Europe/Zurich',
    })
  })

  test('reads boxes nib does not name as open, with their mark', () => {
    expect(readTask('- [>] forwarded')).toMatchObject({
      status: '>',
      done: false,
      cancelled: false,
    })
  })
})

describe('the values of nib fields', () => {
  test.each([
    ['45m', 45],
    ['2h', 120],
    ['1h30m', 90],
    ['1h 30m', 90],
    ['1.5h', 90],
    ['90 min', 90],
    ['90', 90],
    ['1,5 Std', 90],
  ])('duration %s is %i minutes', (written, minutes) => {
    expect(readDuration(written)).toBe(minutes)
  })

  test('a duration that is not one', () => {
    expect(readDuration('soon')).toBeNull()
    expect(readDuration('')).toBeNull()
  })

  test('times', () => {
    expect(readTime('9:05')).toEqual({ time: '09:05' })
    expect(readTime('24:00')).toBeNull()
    expect(readTime('16:00:30')).toEqual({ time: '16:00' })
  })

  test('reminders: before, at a time on the day, at a moment', () => {
    expect(readRemind('15m, 1h, 1d, 9:00, 2026-10-06 09:00')).toEqual([
      { before: 15 },
      { before: 60 },
      { before: 1440 },
      { time: '09:00' },
      { at: '2026-10-06', time: '09:00' },
    ])
    expect(readRemind('whenever')).toBeNull()
  })
})
