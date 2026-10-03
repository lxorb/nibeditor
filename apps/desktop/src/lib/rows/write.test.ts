import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row } from '@nib/bases'
import { readTask } from '@nib/markdown/task-line'
import { rowsOf } from './build'
import { scanNote } from '../scan-note'
import { scanRows } from '../scan-rows'

/** The one write path: a property of a note and a field of a task, as edits of the
 *  note's words, written the way every write across a space is. */

const disk = new Map<string, string>()
const sent: string[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'snapshot_note') sent.push(`keep ${path}`)
    if (command === 'write_note' && typeof args?.content === 'string') {
      disk.set(path, args.content)
      sent.push(`write ${path}`)
    }
    return Promise.resolve('')
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: { noteSaved: (path: string) => void sent.push(`saved ${path}`) },
}))

vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

const { changed, taskLine, writeRow } = await import('./write')
const { FileActions } = await import('../workspace/undo.svelte')
const { NoteDoc } = await import('../workspace/documents.svelte')
type HoldsNotes = import('../workspace/note-text').HoldsNotes

const PATH = '/space/Plan.md'

/** The rows of a note as the store would hold them. */
function rowsFor(text: string): Row[] {
  return rowsOf('Space', {
    ...scanNote('Plan.md', text),
    ...scanRows(text),
    stamp: null,
  })
}

const noteRow = (text: string) => {
  const [found] = rowsFor(text)
  if (!found) throw new Error('no note row')
  return found
}

const taskRow = (text: string, words: string) => {
  const found = rowsFor(text).find((row) => row.task?.text === words)
  if (!found) throw new Error(`no task ${words}`)
  return found
}

/** A store with one note on the disk and, optionally, open with other words. */
function holding(text: string, open?: string) {
  disk.clear()
  disk.set(PATH, text)
  const note =
    open === undefined
      ? null
      : new NoteDoc(
          { kind: 'note', path: PATH, name: 'Plan.md', text: open, dirty: true },
          () => undefined,
        )

  const ws = {
    activeSpace: { id: 's', name: 'Space', root: '/space' },
    notes: [{ path: PATH }],
    documents: note ? [note] : [],
    documentAt: (path: string) => (note && path === PATH ? note : null),
    undone: new FileActions(),
    tags: [],
    flush: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }
  return { ws: ws as unknown as HoldsNotes, note, undone: ws.undone }
}

beforeEach(() => {
  sent.length = 0
  // Ticking writes today's date, so today is held still.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a property written from a view', () => {
  const note = noteRow('---\nstatus: open\n---\n# Plan\n')

  test('sets, adds and takes away keys in the front matter', () => {
    const text = '---\nstatus: open\n---\n# Plan\n'
    expect(changed(text, note, { note: { status: 'done' } })).toBe(
      '---\nstatus: done\n---\n# Plan\n',
    )
    expect(
      changed(text, note, { note: { due: { kind: 'date', iso: '2026-10-06' }, done: true } }),
    ).toBe('---\nstatus: open\ndue: 2026-10-06\ndone: true\n---\n# Plan\n')
    expect(changed(text, note, { note: { status: null } })).toBe('# Plan\n')
    expect(
      changed(text, note, {
        note: { tags: ['a', 'b'], project: { kind: 'link', target: 'Thesis' } },
      }),
    ).toBe("---\nstatus: open\ntags: [a, b]\nproject: '[[Thesis]]'\n---\n# Plan\n")
  })

  test('opens a block in a note that has none', () => {
    expect(changed('# Plan\n', note, { note: { priority: 2 } })).toBe(
      '---\npriority: 2\n---\n# Plan\n',
    )
  })
})

describe('a task field written from a view', () => {
  const text = '# Plan\n- [ ] Call the bank 📅 2026-10-06\n- [ ] Water the plants\n'

  test('changes only the characters of its own line', () => {
    const row = taskRow(text, 'Call the bank')
    const after = changed(text, row, { task: { due: '2026-10-08' } })

    expect(after).toBe('# Plan\n- [ ] Call the bank 📅 2026-10-08\n- [ ] Water the plants\n')
  })

  test('finds its line again where lines above it moved, by its words', () => {
    const row = taskRow(text, 'Water the plants')
    const moved = `Two new lines\nabove it\n${text}`

    const after = changed(moved, row, { task: { priority: 1 } }) ?? ''
    expect(readTask(after.split('\n')[4] ?? '')?.priority).toBe(1)
    expect(taskLine(moved, row.anchor ?? { line: 0, hash: '' })?.from).toBe(
      moved.indexOf('- [ ] Water'),
    )
  })

  test('writes nothing for a task that is no longer there', () => {
    const row = taskRow(text, 'Call the bank')
    expect(changed('# Plan\n- [ ] Something else\n', row, { task: { done: true } })).toBeNull()
  })

  test('ticks the way the engine ticks: the done date, and a recurring task comes back above', () => {
    const plants = '- [ ] Water the plants 🔁 every 3 days 📅 2026-10-06\n'
    expect(changed(plants, taskRow(plants, 'Water the plants'), { task: { done: true } })).toBe(
      '- [ ] Water the plants 🔁 every 3 days 📅 2026-10-09\n' +
        '- [x] Water the plants 🔁 every 3 days 📅 2026-10-06 ✅ 2026-10-07\n',
    )
  })

  test('opens a done task again, its done date taken off', () => {
    const done = '- [x] Go ✅ 2026-10-01\n'
    expect(changed(done, taskRow(done, 'Go'), { task: { done: false } })).toBe('- [ ] Go\n')
  })

  test('a field and the tick in one change', () => {
    const go = '- [ ] Go\n'
    expect(changed(go, taskRow(go, 'Go'), { task: { done: true, priority: 1 } })).toBe(
      '- [x] Go 🔺 ✅ 2026-10-07\n',
    )
  })

  test('keeps the line break a Windows file wrote', () => {
    const crlf = text.replace(/\n/g, '\r\n')
    const row = taskRow(text, 'Call the bank')
    expect(changed(crlf, row, { task: { scheduled: '2026-10-05' } })?.split('\r\n')).toHaveLength(4)
  })
})

describe('the write itself', () => {
  test('a note nobody has open is written once, kept first, and is one thing to undo', async () => {
    const text = '- [ ] Go\n'
    const { ws, undone } = holding(text)

    expect(await writeRow(ws, PATH, taskRow(text, 'Go'), { task: { done: true } })).toBe(true)
    expect(readTask(disk.get(PATH) ?? '')?.done).toBe(true)
    expect(sent).toEqual([`keep ${PATH}`, `write ${PATH}`, `saved ${PATH}`])
    expect(undone.last?.kind).toBe('replace')
  })

  test('a note open with unsaved words keeps them, and takes the edit in its own document', async () => {
    const { ws, note } = holding('- [ ] Go\n', '- [ ] Go\nwords typed since\n')

    expect(await writeRow(ws, PATH, taskRow('- [ ] Go\n', 'Go'), { task: { done: true } })).toBe(
      true,
    )
    expect(note?.text).toBe('- [x] Go ✅ 2026-10-07\nwords typed since\n')
    expect(disk.get(PATH)).toBe('- [x] Go ✅ 2026-10-07\nwords typed since\n')
  })

  test('a change the note already says writes nothing', async () => {
    const text = '---\nstatus: open\n---\n'
    const { ws } = holding(text)
    expect(await writeRow(ws, PATH, noteRow(text), { note: { status: 'open' } })).toBe(false)
    expect(sent).toEqual([])
  })
})
