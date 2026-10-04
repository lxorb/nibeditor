import { describe, expect, test } from 'vitest'
import type { Entry } from '../workspace.svelte'
import { todayRows, widgetRows } from './widgets.svelte'

/** Which notes the home screen lists.
 *
 *  A widget is drawn by the launcher out of what the page last handed over, so
 *  this is the whole of the decision and there is no home screen in it: the notes
 *  kept open first, then the rest by when they were last written in, five at most
 *  because five is how many rows the layout has. */

function note(name: string, modified: number, path = `/Notes/${name}`): Entry {
  return { name, path, is_dir: false, modified, created: 0, children: [] }
}

describe('the rows', () => {
  const notes = [
    note('Plan.md', 300),
    note('Diary.md', 500),
    note('Kit.md', 100),
    note('Trip.md', 400),
  ]

  test('are the notes last written in, newest first', () => {
    expect(widgetRows(notes, [])).toEqual([
      { name: 'Diary', path: '/Notes/Diary.md' },
      { name: 'Trip', path: '/Notes/Trip.md' },
      { name: 'Plan', path: '/Notes/Plan.md' },
      { name: 'Kit', path: '/Notes/Kit.md' },
    ])
  })

  test('with what is kept open at the top, in the order it was pinned', () => {
    expect(widgetRows(notes, ['/Notes/Kit.md', '/Notes/Plan.md']).map((one) => one.name)).toEqual([
      'Kit',
      'Plan',
      'Diary',
      'Trip',
    ])
  })

  test('never twice, and never more than the layout has rows for', () => {
    const many = [...notes, note('A.md', 900), note('B.md', 800), note('C.md', 700)]
    const rows = widgetRows(many, ['/Notes/Kit.md', '/Notes/Kit.md'])

    expect(rows).toHaveLength(5)
    expect(rows.map((one) => one.name)).toEqual(['Kit', 'A', 'B', 'C', 'Diary'])
  })

  test('leave out a pinned note that is not in the space any more', () => {
    expect(widgetRows([note('Plan.md', 1)], ['/Notes/Gone.md']).map((one) => one.name)).toEqual([
      'Plan',
    ])
  })

  test('are named the way every other list names a note', () => {
    // The extension is the file's, not the document's; see note-name.ts.
    expect(widgetRows([note('Read me.markdown', 1)], [])[0]?.name).toBe('Read me')
  })

  test('are nothing at all in a space with nothing in it', () => {
    expect(widgetRows([], [])).toEqual([])
    expect(widgetRows([], ['/Notes/Gone.md'])).toEqual([])
  })

  test('do not reorder the list they were given', () => {
    const given = [note('Plan.md', 300), note('Diary.md', 500)]
    widgetRows(given, [])

    expect(given.map((one) => one.name)).toEqual(['Plan.md', 'Diary.md'])
  })
})

describe('today', () => {
  test('the first five, each with where its note is on this phone', () => {
    const tasks = Array.from({ length: 7 }, (_, at) => ({
      text: `Task ${String(at)}`,
      at: `Work/Plan.md#${String(at)}:abc`,
      space: at === 0 ? 'Gone' : 'Notes',
    }))
    const rows = todayRows(tasks, (space) => (space === 'Notes' ? '/Notes' : undefined))
    expect(rows).toHaveLength(5)
    expect(rows[1]).toEqual({
      text: 'Task 1',
      at: 'Work/Plan.md#1:abc',
      space: 'Notes',
      path: '/Notes/Work/Plan.md',
    })
    // A space this phone does not have opens nothing.
    expect(rows[0]?.path).toBe('')
  })
})
