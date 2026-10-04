import { beforeEach, describe, expect, test, vi } from 'vitest'
import { rowsOfText } from '@nib/bases/rows'

/** The reader's own hands on their to-dos: a line added to the inbox, a box ticked the
 *  way the Tasks plugin ticks one, and Today. Against a space of fake files, written
 *  through the replacement every note edit takes. */

const files = new Map<string, string>()
const home = { name: 'Home', root: '/s/Home' }

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [home],
    activeSpace: home,
    noteText: (path: string) => Promise.resolve(files.get(path) ?? null),
  },
}))

vi.mock('./workspace/note-text', () => ({
  replaceInNotes: (_ws: unknown, changes: { path: string; after: string }[]) => {
    for (const one of changes) files.set(one.path, one.after)
    return Promise.resolve()
  },
}))

vi.mock('./rows/rows.svelte', () => ({
  rows: {
    of: () =>
      [...files].flatMap(([path, text]) => rowsOfText('Home', path.slice('/s/Home/'.length), text)),
    inboxes: () => [{ space: 'Home', path: 'Inbox.md' }],
    inbox: (root: string) => {
      const path = `${root}/Inbox.md`
      if (!files.has(path)) files.set(path, '')
      return Promise.resolve(path)
    },
  },
}))

const { addTask, listed, tickTask } = await import('./task-actions')

const today = new Date().toISOString().slice(0, 10)

beforeEach(() => {
  files.clear()
  files.set('/s/Home/Plan.md', `# Plan\n- [ ] Water the plants 🔁 every day 📅 ${today}\n`)
})

describe("the reader's own task actions", () => {
  test('a line in the inbox, made the first time, its marks read', async () => {
    expect(await addTask('Call Mum ⏫')).toEqual({ path: '/s/Home/Inbox.md', line: 0 })
    expect(files.get('/s/Home/Inbox.md')).toBe('- [ ] Call Mum ⏫\n')
    expect(await addTask('  ')).toBeNull()
  })

  test('a recurring task ticked writes its next line above, in one edit', async () => {
    const { tasks } = await listed()
    expect(tasks.map((one) => one.text)).toEqual(['Water the plants'])
    expect(await tickTask(tasks[0]?.at ?? '', 'Home', true)).toBe(true)
    const lines = files.get('/s/Home/Plan.md')?.split('\n') ?? []
    expect(lines[1]).toMatch(/^- \[ \] Water the plants 🔁 every day 📅 \d{4}-\d{2}-\d{2}$/)
    expect(lines[2]).toBe(`- [x] Water the plants 🔁 every day 📅 ${today} ✅ ${today}`)
  })

  test('nothing ticked where the task or the space is not there', async () => {
    expect(await tickTask('Plan.md#1:nothing', 'Home', true)).toBe(false)
    expect(await tickTask('Plan.md#1:nothing', 'Elsewhere', true)).toBe(false)
  })
})
