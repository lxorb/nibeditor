import { describe, expect, test, vi } from 'vitest'
import * as taskLine from '@nib/markdown/task-line'
import { scanNote, type ScannedNote } from '../scan-note'
import { scanRows } from '../scan-rows'
import { type Host, RowsStore } from './store'

/** What the rows of a big space cost: 5,000 notes and 10,000 tasks (docs/tasks.md 5.3).
 *
 *  Counted where a count says it, timed where only a clock can, and the clock held to a
 *  line well above what was measured, for the reason scan-note.perf.test.ts gives: the
 *  suite runs beside other files, and a pass descheduled halfway says nothing. The shape
 *  is what is held: a save costs the note that was saved and nothing of the space, and
 *  every row of a note shares the note's one `file` and one `note`. Measured on the
 *  reference machine as this was written: the space made into rows in 115 to 160 ms of a
 *  test worker, in breaths of 250 notes; one note's rows read again after a save in
 *  0.06 ms (median of fifty); and 11.5 MB of heap for the 15,000 rows, measured with
 *  `--expose-gc`, of which the engine's task fields are 6.2, the notes' `file.*` 1.8,
 *  their front matter 1.1 and the rows themselves 1.3. */

vi.mock('@nib/markdown/task-line', { spy: true })

const NOTES = 5_000
const TASKS_EACH = 2

/** A note with front matter, two headings and two tasks with fields. */
function note(at: number): string {
  return [
    '---',
    `status: ${at % 3 ? 'open' : 'done'}`,
    `priority: ${at % 4}`,
    `tags: [work, n${at % 50}]`,
    '---',
    `# Note ${at}`,
    'Some words about the thing, with a [[link]] in them.',
    '## Errands',
    `- [ ] Call number ${at} [time:: 16:00] #admin ⏫ 📅 2026-10-0${(at % 9) + 1}`,
    `  - [${at % 2 ? 'x' : ' '}] Find the card for ${at} 🔁 every week ✅ 2026-10-01`,
    'And a closing paragraph.',
  ].join('\n')
}

const scanned: ScannedNote[] = Array.from({ length: NOTES }, (_, at) => {
  const text = note(at)
  return {
    ...scanNote(`folder ${at % 20}/Note ${at}.md`, text),
    ...scanRows(text),
    stamp: { size: text.length, mtime: 1, ctime: 1 },
  }
})

function store(): RowsStore {
  const host: Host = {
    scan: () => Promise.resolve(null),
    read: () => Promise.resolve(null),
    open: () => ({ root: '/big', scanned: () => Promise.resolve(), notes: () => scanned }),
    breathe: () => Promise.resolve(),
    now: () => 2,
  }
  return new RowsStore(host)
}

async function read(rows: RowsStore) {
  rows.spacesAre([{ root: '/big', name: 'Big' }])
  for (let turn = 0; turn < 100 && !rows.ready; turn++) await new Promise((go) => setTimeout(go, 0))
}

describe('the rows of a space of 5,000 notes and 10,000 tasks', () => {
  test('are made in one pass, sharing each note across its rows', async () => {
    const rows = store()
    const started = performance.now()
    await read(rows)
    const took = performance.now() - started

    const all = rows.of()
    expect(all).toHaveLength(NOTES * (1 + TASKS_EACH))
    expect(all.filter((row) => row.task?.done)).toHaveLength(NOTES / 2)
    // One `file` and one `note` per note, however many tasks it has.
    expect(new Set(all.map((row) => row.file)).size).toBe(NOTES)
    expect(new Set(all.map((row) => row.note)).size).toBe(NOTES)
    expect(took).toBeLessThan(2_000)
  })

  test('and a save reads the note saved and nothing else of the space', async () => {
    const rows = store()
    await read(rows)
    const readTask = vi.mocked(taskLine.readTask)

    readTask.mockClear()
    const text = note(7)
    const times: number[] = []
    for (let round = 0; round < 50; round++) {
      const started = performance.now()
      rows.saved('/big/folder 7/Note 7.md', text)
      times.push(performance.now() - started)
    }

    // Two task lines, read once a save: the space's 10,000 are not read again.
    expect(readTask.mock.calls).toHaveLength(50 * TASKS_EACH)
    times.sort((one, other) => one - other)
    expect(times[25]).toBeLessThan(2)
  })

  test('and nothing at all happens while nobody saves', async () => {
    const rows = store()
    await read(rows)
    const heard: unknown[] = []
    rows.watch((change) => heard.push(change))
    const readTask = vi.mocked(taskLine.readTask)
    readTask.mockClear()

    // Asked for its rows as often as a view redraws: the same list, nothing read.
    const first = rows.of('Big')
    for (let ask = 0; ask < 1_000; ask++) expect(rows.of('Big')).toBe(first)
    expect(readTask).not.toHaveBeenCalled()
    expect(heard).toEqual([])
  })
})
