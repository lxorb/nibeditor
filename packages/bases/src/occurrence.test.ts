import { appliedEdits } from '@nib/markdown/edits'
import { readTask } from '@nib/markdown/task-line'
import { describe, expect, test } from 'vitest'
import { finish, nextOccurrence, skip, tick } from './occurrence'

const ticked = (note: string, line: number, today: string, skipPast = true) =>
  appliedEdits(note, tick(note, line, today, { skipPast }))

describe("the Tasks plugin's documented recurring examples, with its own dates", () => {
  test('take out the trash', () => {
    expect(
      ticked('- [ ] take out the trash 🔁 every Sunday 📅 2021-04-25\n', 0, '2021-04-24', false),
    ).toBe(
      '- [ ] take out the trash 🔁 every Sunday 📅 2021-05-02\n' +
        '- [x] take out the trash 🔁 every Sunday 📅 2021-04-25 ✅ 2021-04-24\n',
    )
  })

  test('sweep the floors, a week late, from the old date', () => {
    expect(
      ticked('- [ ] sweep the floors 🔁 every week ⏳ 2021-02-06\n', 0, '2022-02-13', false),
    ).toBe(
      '- [ ] sweep the floors 🔁 every week ⏳ 2021-02-13\n' +
        '- [x] sweep the floors 🔁 every week ⏳ 2021-02-06 ✅ 2022-02-13\n',
    )
  })

  test('sweep the floors when done, from today', () => {
    expect(
      ticked('- [ ] sweep the floors 🔁 every week when done ⏳ 2021-02-06\n', 0, '2022-02-13'),
    ).toBe(
      '- [ ] sweep the floors 🔁 every week when done ⏳ 2022-02-20\n' +
        '- [x] sweep the floors 🔁 every week when done ⏳ 2021-02-06 ✅ 2022-02-13\n',
    )
  })

  test('mow the lawn: every date moves together', () => {
    expect(
      ticked(
        '-   [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30',
        0,
        '2021-10-30',
        false,
      ),
    ).toBe(
      '-   [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-11-11 📅 2021-11-13\n' +
        '-   [x] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30 ✅ 2021-10-30',
    )
  })

  test('do stuff every month: the 31st comes back as the 30th', () => {
    let note = '- [ ] do stuff 🔁 every month 📅 2021-10-31'
    const dues: string[] = []
    for (const day of ['2021-10-31', '2021-11-30', '2021-12-30', '2022-01-30', '2022-02-28']) {
      note = ticked(note, 0, day)
      dues.push(readTask(note.split('\n')[0] ?? '')?.due ?? '')
    }
    expect(dues).toEqual(['2021-11-30', '2021-12-30', '2022-01-30', '2022-02-28', '2022-03-28'])
  })
})

describe('ticking', () => {
  test('an ordinary task: the box and the date, one line', () => {
    expect(ticked('a\n- [ ] Call the bank 📅 2026-10-06\nb', 1, '2026-10-04')).toBe(
      'a\n- [x] Call the bank 📅 2026-10-06 ✅ 2026-10-04\nb',
    )
  })

  test('a done task opens again, and so does a cancelled one', () => {
    expect(ticked('- [x] a ✅ 2026-10-01', 0, '2026-10-04')).toBe('- [ ] a')
    expect(ticked('- [-] a ❌ 2026-10-01', 0, '2026-10-04')).toBe('- [ ] a')
  })

  test('a daily task a week overdue comes back tomorrow, not six days ago', () => {
    expect(ticked('- [ ] Water 🔁 every day 📅 2026-09-27', 0, '2026-10-04')).toBe(
      '- [ ] Water 🔁 every day 📅 2026-10-05\n- [x] Water 🔁 every day 📅 2026-09-27 ✅ 2026-10-04',
    )
  })

  test('a task ticked early steps from its own date', () => {
    expect(ticked('- [ ] Rent 🔁 every month 📅 2026-10-31', 0, '2026-10-04')).toBe(
      '- [ ] Rent 🔁 every month 📅 2026-11-30\n- [x] Rent 🔁 every month 📅 2026-10-31 ✅ 2026-10-04',
    )
  })

  test('ticks the open sub-tasks with the parent, and leaves the done ones', () => {
    const note = [
      '- [ ] Move',
      '  - [ ] Boxes',
      '  - [x] Van ✅ 2026-10-01',
      '  Notes on it',
      '- [ ] Next',
    ].join('\n')
    expect(ticked(note, 0, '2026-10-04')).toBe(
      [
        '- [x] Move ✅ 2026-10-04',
        '  - [x] Boxes ✅ 2026-10-04',
        '  - [x] Van ✅ 2026-10-01',
        '  Notes on it',
        '- [ ] Next',
      ].join('\n'),
    )
  })

  test('a recurring parent brings its description and sub-tasks with it, open again', () => {
    const note = [
      '- [ ] Clean 🔁 every week 📅 2026-10-04',
      '  The whole flat.',
      '  - [ ] Kitchen',
      '  - [x] Bath ✅ 2026-10-03',
      '  Took long this time.',
      'after',
    ].join('\n')
    expect(ticked(note, 0, '2026-10-04')).toBe(
      [
        '- [ ] Clean 🔁 every week 📅 2026-10-11',
        '  The whole flat.',
        '  - [ ] Kitchen',
        '  - [ ] Bath',
        '- [x] Clean 🔁 every week 📅 2026-10-04 ✅ 2026-10-04',
        '  The whole flat.',
        '  - [x] Kitchen ✅ 2026-10-04',
        '  - [x] Bath ✅ 2026-10-03',
        '  Took long this time.',
        'after',
      ].join('\n'),
    )
  })

  test('nib fields come along and reminders at a moment move with the dates', () => {
    const line =
      '- [ ] Call [time:: 16:00] [remind:: 15m, 2026-10-04 09:00] 🔁 every week 📅 2026-10-04'
    expect(ticked(line, 0, '2026-10-04').split('\n')[0]).toBe(
      '- [ ] Call [time:: 16:00] [remind:: 15m, 2026-10-11 09:00] 🔁 every week 📅 2026-10-11',
    )
  })

  test('a rule past its until is ticked and not repeated', () => {
    expect(ticked('- [ ] a 🔁 every day until 2026-10-04 📅 2026-10-04', 0, '2026-10-04')).toBe(
      '- [x] a 🔁 every day until 2026-10-04 📅 2026-10-04 ✅ 2026-10-04',
    )
  })

  test("the plugin's 🏁 delete: the done line goes", () => {
    expect(ticked('- [ ] a 🏁 delete\nb', 0, '2026-10-04')).toBe('b')
    expect(ticked('- [ ] a 🔁 every day 🏁 delete 📅 2026-10-04\nb', 0, '2026-10-04')).toBe(
      '- [ ] a 🔁 every day 🏁 delete 📅 2026-10-05\nb',
    )
  })

  test('a recurring task with no date makes its next line with none, as the plugin does', () => {
    expect(ticked('- [ ] a 🔁 every day', 0, '2026-10-04')).toBe(
      '- [ ] a 🔁 every day\n- [x] a 🔁 every day ✅ 2026-10-04',
    )
  })

  test('the created date, when asked for', () => {
    const note = '- [ ] a 🔁 every day 📅 2026-10-04'
    expect(appliedEdits(note, tick(note, 0, '2026-10-04', { created: true })).split('\n')[0]).toBe(
      '- [ ] a 🔁 every day ➕ 2026-10-04 📅 2026-10-05',
    )
  })

  test('is nothing on a line that is not a task', () => {
    expect(tick('words', 0, '2026-10-04')).toEqual([])
    expect(tick('words', 3, '2026-10-04')).toEqual([])
  })

  test('the edits are in order and never overlap, so they are one transaction', () => {
    const note = '- [ ] Clean 🔁 every week 📅 2026-10-04\n  - [ ] Kitchen'
    const edits = tick(note, 0, '2026-10-04')
    for (let at = 1; at < edits.length; at++) {
      expect(edits[at]?.from ?? 0).toBeGreaterThanOrEqual(edits[at - 1]?.to ?? 0)
    }
  })
})

describe('skip and finish', () => {
  test('skip moves the dates and ticks nothing', () => {
    const line = '- [ ] a 🔁 every week 📅 2026-10-04'
    expect(appliedEdits(line, skip(line, '2026-10-04'))).toBe('- [ ] a 🔁 every week 📅 2026-10-11')
  })

  test('finish ticks it and takes the rule off', () => {
    const line = '- [ ] a 🔁 every week 📅 2026-10-04'
    expect(appliedEdits(line, finish(line, '2026-10-04'))).toBe(
      '- [x] a 📅 2026-10-04 ✅ 2026-10-04',
    )
  })

  test('the next occurrence of a task that does not repeat is nothing', () => {
    const task = readTask('- [ ] a 📅 2026-10-04')
    expect(task && nextOccurrence(task, '2026-10-04')).toBeNull()
  })
})
