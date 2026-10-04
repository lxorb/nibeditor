import { describe, expect, test } from 'vitest'
import { readTask } from './task-line'
import { momentOf, plainWords, reminderId, remindTimes } from './task-reminders'

const task = (line: string) => {
  const read = readTask(line)
  if (!read) throw new Error(`not a task: ${line}`)
  return read
}

describe('remindTimes', () => {
  test('a task with a time rings at it, less the automatic offset', () => {
    const one = task('- [ ] Call the bank [time:: 16:00] 📅 2026-10-06')
    expect(remindTimes(one, 0)).toEqual([{ date: '2026-10-06', time: '16:00' }])
    expect(remindTimes(one, 15)).toEqual([{ date: '2026-10-06', time: '15:45' }])
    expect(remindTimes(one, null)).toEqual([])
  })

  test('every written reminder rings, each once, earliest first', () => {
    const one = task(
      '- [ ] Call the bank [time:: 16:00] [remind:: 15m, 2026-10-05 09:00, 8:30] 📅 2026-10-06',
    )
    expect(remindTimes(one, 15)).toEqual([
      { date: '2026-10-05', time: '09:00' },
      { date: '2026-10-06', time: '08:30' },
      { date: '2026-10-06', time: '15:45' },
    ])
  })

  test('counting back crosses midnight on the wall clock', () => {
    const one = task('- [ ] Night train [time:: 00:10] [remind:: 1h] 📅 2026-10-06')
    expect(remindTimes(one, null)).toEqual([{ date: '2026-10-05', time: '23:10' }])
  })

  test('the scheduled day stands in for a due one', () => {
    const one = task('- [ ] Draft [remind:: 9:00] ⏳ 2026-10-08')
    expect(remindTimes(one, 0)).toEqual([{ date: '2026-10-08', time: '09:00' }])
  })

  test('no day and no time is no relative reminder, and no automatic one', () => {
    expect(remindTimes(task('- [ ] Someday [remind:: 15m, 9:00]'), 0)).toEqual([])
    expect(remindTimes(task('- [ ] All day 📅 2026-10-06'), 0)).toEqual([])
    expect(remindTimes(task('- [ ] Fixed [remind:: 2026-10-06 09:00]'), 0)).toEqual([
      { date: '2026-10-06', time: '09:00' },
    ])
  })

  test('a done or cancelled task rings nothing', () => {
    expect(remindTimes(task('- [x] Done [time:: 16:00] 📅 2026-10-06 ✅ 2026-10-06'), 0)).toEqual(
      [],
    )
    expect(remindTimes(task('- [-] Dropped [time:: 16:00] 📅 2026-10-06'), 0)).toEqual([])
  })

  test('a zone on the line stays with every reminder of it', () => {
    const one = task('- [ ] Standup [time:: 09:00 America/New_York] [remind:: 10m] 📅 2026-10-06')
    expect(remindTimes(one, null)).toEqual([
      { date: '2026-10-06', time: '08:50', zone: 'America/New_York' },
    ])
  })
})

describe('momentOf', () => {
  test('a zone is read on its own clock, summer time included', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00', zone: 'Europe/Zurich' })).toBe(
      Date.UTC(2026, 9, 6, 7, 0),
    )
    expect(momentOf({ date: '2026-12-06', time: '09:00', zone: 'Europe/Zurich' })).toBe(
      Date.UTC(2026, 11, 6, 8, 0),
    )
    expect(momentOf({ date: '2026-10-06', time: '09:00' }, 'UTC')).toBe(Date.UTC(2026, 9, 6, 9))
  })

  test('the zone on the line wins over the one asked in', () => {
    expect(
      momentOf({ date: '2026-10-06', time: '09:00', zone: 'Asia/Tokyo' }, 'Europe/Zurich'),
    ).toBe(Date.UTC(2026, 9, 6, 0, 0))
  })

  test('a floating time is this machine\u2019s clock', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00' })).toBe(
      new Date(2026, 9, 6, 9, 0).getTime(),
    )
  })

  test('a zone nobody knows is no moment', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00', zone: 'Mars/Olympus' })).toBeNaN()
  })
})

test('reminderId is sixteen hex digits, the same for the same reminder', () => {
  const wall = { date: '2026-10-06', time: '16:00' }
  const id = reminderId('Work', 'Plan.md', 'abc', wall)
  expect(id).toMatch(/^[0-9a-f]{16}$/)
  expect(reminderId('Work', 'Plan.md', 'abc', wall)).toBe(id)
  expect(reminderId('Work', 'Plan.md', 'abc', { ...wall, time: '16:01' })).not.toBe(id)
  expect(reminderId('Home', 'Plan.md', 'abc', wall)).not.toBe(id)
})

test('plainWords says a task the way a person reads it', () => {
  expect(plainWords('Read **the** [paper](https://x.org) about [[Notes/Rust#Traits]] `now`')).toBe(
    'Read the paper about Notes/Rust now',
  )
  expect(plainWords('_Call_ mum')).toBe('Call mum')
})
