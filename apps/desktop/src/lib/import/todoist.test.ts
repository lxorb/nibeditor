/** Todoist, from a recorded API answer and from its documented CSV: never the real API
 *  with anybody's account. The answer's shapes are the API's own (`/api/v1`, its OpenAPI
 *  examples: `{results, next_cursor}` pages, `due {date, string, is_recurring,
 *  timezone}`, `deadline {date}`, `duration {amount, unit}`, priority 4 as p1). */

import { describe, expect, test } from 'vitest'
import { sourceOf } from './sources'
import {
  csvProject,
  type Fetch,
  isTodoistCsv,
  planOf,
  readTodoistAccount,
  readTodoistFiles,
  ruleOf,
  tagOf,
} from './todoist'

/** The account, as the API answered it, page by page. */
const RECORDED: Record<string, unknown[]> = {
  '/projects': [
    {
      results: [
        { id: 'p-in', name: 'Inbox', inbox_project: true, parent_id: null, is_shared: false },
        { id: 'p-work', name: 'Work', inbox_project: false, parent_id: null, is_shared: true },
      ],
      next_cursor: 'c1',
    },
    {
      results: [
        { id: 'p-thesis', name: 'Thesis', parent_id: 'p-work', is_shared: false },
        { id: 'p-old', name: 'Old', is_archived: true },
      ],
      next_cursor: null,
    },
  ],
  '/sections': [
    {
      results: [{ id: 's-1', project_id: 'p-work', name: 'Errands', section_order: 1 }],
      next_cursor: null,
    },
  ],
  '/tasks': [
    {
      results: [
        {
          id: 't-1',
          project_id: 'p-work',
          section_id: null,
          parent_id: null,
          content: 'Call the bank',
          description: 'Their number is on the card.',
          priority: 4,
          due: {
            date: '2026-10-06T16:00:00',
            string: 'Oct 6 4pm',
            is_recurring: false,
            lang: 'en',
          },
          deadline: { date: '2026-10-10', lang: 'en' },
          duration: { amount: 30, unit: 'minute' },
          labels: ['admin', 'phone calls'],
          child_order: 1,
          checked: false,
          note_count: 1,
          responsible_uid: 'u-2',
        },
        {
          id: 't-2',
          project_id: 'p-work',
          parent_id: 't-1',
          content: 'Find the card',
          description: '',
          priority: 1,
          labels: [],
          child_order: 1,
          checked: false,
          note_count: 0,
        },
        {
          id: 't-3',
          project_id: 'p-work',
          section_id: 's-1',
          content: 'Water the plants',
          description: '',
          priority: 2,
          due: { date: '2026-10-04', string: 'every! 3 days', is_recurring: true, lang: 'en' },
          labels: [],
          child_order: 2,
          checked: false,
          note_count: 0,
        },
        {
          id: 't-4',
          project_id: 'p-in',
          content: 'Renew the gym',
          description: '',
          priority: 3,
          due: {
            date: '2026-10-08T07:00:00Z',
            string: 'every other tuesday starting oct 8',
            is_recurring: true,
            timezone: 'Europe/Zurich',
          },
          labels: [],
          child_order: 1,
          checked: false,
          note_count: 0,
        },
      ],
      next_cursor: null,
    },
  ],
  '/reminders': [
    {
      results: [
        { id: 'r-1', item_id: 't-1', type: 'relative', minute_offset: 15 },
        { id: 'r-2', item_id: 't-1', type: 'absolute', due: { date: '2026-10-06T09:00:00' } },
      ],
      next_cursor: null,
    },
  ],
  '/projects/p-work/collaborators': [
    { results: [{ id: 'u-2', name: 'Lucile', email: 'l@example.com' }], next_cursor: null },
  ],
  '/comments?task_id=t-1': [
    {
      results: [
        {
          id: 'n-1',
          content: 'Asked at the counter',
          posted_at: '2026-10-01T10:00:00Z',
          file_attachment: {
            file_name: 'card.png',
            file_url: 'https://files.todoist.com/card.png',
          },
        },
      ],
      next_cursor: null,
    },
  ],
  '/tasks/completed/by_completion_date': [
    {
      items: [
        {
          id: 't-5',
          project_id: 'p-in',
          content: 'Pay rent',
          description: '',
          priority: 1,
          labels: [],
          child_order: 2,
          checked: true,
          completed_at: '2026-10-01T08:00:00Z',
          note_count: 0,
        },
      ],
      next_cursor: null,
    },
  ],
}

/** A fetch that answers from the recording, and says what it was asked with. */
function recorded() {
  const asked: { url: string; auth: string }[] = []
  const served = new Map<string, number>()
  const get: Fetch = (url, init) => {
    asked.push({ url, auth: init.headers.Authorization ?? '' })
    const path = url
      .replace('https://api.todoist.com/api/v1', '')
      .replace(/[?&](limit|cursor|since|until)=[^&]*/g, '')
    const key = Object.keys(RECORDED).find((one) => one === path || one === path.replace(/\?$/, ''))
    const pages = key ? RECORDED[key] : undefined
    const at = served.get(path) ?? 0
    served.set(path, at + 1)
    const page = pages?.[at]
    return Promise.resolve({
      ok: !!page,
      status: init.headers.Authorization === 'Bearer wrong' ? 401 : page ? 200 : 404,
      json: () => Promise.resolve(page),
    })
  }
  return { get, asked }
}

const NOW = new Date('2026-10-04T12:00:00Z')

describe('from the account', () => {
  test('every project a note, in its parent', async () => {
    const { get, asked } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { completed: true, now: NOW }))
    expect(plan.files.map((one) => one.path)).toEqual(['Inbox.md', 'Work.md', 'Work/Thesis.md'])
    expect(plan.inbox).toBe('Inbox.md')
    // Every request carried the token, and nothing else was told it.
    expect(asked.every((one) => one.auth === 'Bearer secret')).toBe(true)
    expect(asked.some((one) => one.url.includes('cursor=c1'))).toBe(true)
  })

  test('a task with all it carries, priority turned round, sub-task under it', async () => {
    const { get } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { now: NOW }))
    const work = plan.files.find((one) => one.path === 'Work.md')
    expect(work?.kind === 'note' ? work.text : '').toBe(
      [
        '- [ ] Call the bank [time:: 16:00] [duration:: 30m] [deadline:: 2026-10-10] [remind:: 15m, 2026-10-06 09:00] [assignee:: Lucile] #admin #phone-calls 🔺 📅 2026-10-06',
        '  Their number is on the card.',
        '  2026-10-01: Asked at the counter [card.png](https://files.todoist.com/card.png)',
        '  - [ ] Find the card',
        '',
        '## Errands',
        '',
        '- [ ] Water the plants 🔼 🔁 every 3 days when done 📅 2026-10-04',
        '',
      ].join('\n'),
    )
  })

  test('a fixed time in its zone, a rule with a start, done tasks if asked', async () => {
    const { get } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { completed: true, now: NOW }))
    const inbox = plan.files.find((one) => one.path === 'Inbox.md')
    const text = inbox?.kind === 'note' ? inbox.text : ''
    expect(text).toContain(
      '- [ ] Renew the gym [time:: 09:00 Europe/Zurich] ⏫ 🔁 every 2 weeks on Tuesday 📅 2026-10-08',
    )
    expect(text).toContain('- [x] Pay rent ✅ 2026-10-01')
    expect(plan.lost).toEqual([])
  })

  test('a token Todoist does not take says so, and nothing is planned', async () => {
    const { get } = recorded()
    await expect(readTodoistAccount(get, 'wrong')).rejects.toThrow(
      'Todoist did not take that token.',
    )
  })
})

/** Todoist's documented CSV, as a project export writes it. */
const CSV = [
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG',
  'task,Plan the launch @work,Everything for Monday,1,1,Evan (14781400),,2026-10-06,en,Europe/Zurich,60,minute,2026-10-09,en',
  'note,Remember the slides,,,,Evan (14781400),,,,,,,,',
  'task,Book the room,,4,2,Evan (14781400),Lucile (14781401),,en,,,,,',
  'section,Later,,,,,,,,,,,,',
  'task,Water the plants,,3,1,Evan (14781400),,every monday,en,,,,,',
  'task,Clean up,,4,1,Evan (14781400),,every other fortnight-ish,en,,,,,',
].join('\n')

describe('from a CSV', () => {
  test('is known by its header', () => {
    expect(isTodoistCsv(CSV)).toBe(true)
    expect(isTodoistCsv('Name,Status\nA,B\n')).toBe(false)
  })

  test('nests by indent, a section a heading, a note a comment, priorities as people count', () => {
    const plan = planOf(csvProject('Launch', CSV, 0))
    expect(plan.lost).toEqual([{ text: 'Some repeating dates stay as words under their tasks' }])
    const note = plan.files[0]
    expect(note?.path).toBe('Launch.md')
    expect(note?.kind === 'note' ? note.text : '').toBe(
      [
        '- [ ] Plan the launch #work [duration:: 1h] [deadline:: 2026-10-09] 🔺 📅 2026-10-06',
        '  Everything for Monday',
        '  Remember the slides',
        '  - [ ] Book the room [assignee:: Lucile]',
        '',
        '## Later',
        '',
        '- [ ] Water the plants 🔼 🔁 every week on Monday',
        '- [ ] Clean up',
        '  Todoist: every other fortnight-ish',
        '',
      ].join('\n'),
    )
  })

  test('a backup zip of them: a project a file, the Inbox the inbox', async () => {
    const encoded = (text: string) => new TextEncoder().encode(text)
    const plan = await readTodoistFiles([
      sourceOf('Inbox [2203306140].csv', encoded(CSV)),
      sourceOf('Work [2203306141].csv', encoded(CSV)),
      sourceOf('readme.txt', encoded('not a project')),
    ])
    expect(plan.files.map((one) => one.path)).toEqual(['Inbox.md', 'Work.md'])
    expect(plan.inbox).toBe('Inbox.md')
  })
})

describe('the words', () => {
  test("Todoist's rules in the Tasks plugin's words", () => {
    expect(ruleOf('every day')).toBe('every day')
    expect(ruleOf('every! 2 weeks')).toBe('every 2 weeks when done')
    expect(ruleOf('every other week')).toBe('every 2 weeks')
    expect(ruleOf('every workday')).toBe('every weekday')
    expect(ruleOf('every 3rd friday')).toBeNull()
  })

  test('a label as a tag', () => {
    expect(tagOf('phone calls')).toBe('phone-calls')
    expect(tagOf('@urgent!')).toBe('urgent')
  })
})
