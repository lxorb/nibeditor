import { readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'

import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'
import { readTable, rowNote, tableOf } from './table'

const CSV = [
  'Name,Status,Pages,Created,Notes',
  'Dune,Read,412,January 2 2026,"Long, and worth it"',
  'Ubik,Reading,224,March 4 2026,',
].join('\n')

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('a CSV as one table', () => {
  test('is one note holding every row', async () => {
    const plan = await readTable([file('Books.csv', CSV)])

    expect(plan.files).toHaveLength(1)
    const text = noteAt(plan, 'Books.md')
    expect(text).toContain('# Books')
    expect(text).toContain('| Name | Status | Pages | Created | Notes |')
    expect(text).toContain('| Dune | Read | 412 | January 2 2026 | Long, and worth it |')
  })

  test('a pipe inside a cell does not become a column', () => {
    const table = tableOf(['A'], [{ A: 'one | two' }])

    expect(table.split('\n')[2]).toBe('| one \\| two |')
  })
})

describe('a CSV as one note per row', () => {
  test('is a folder of notes with the columns as properties', async () => {
    const plan = await readTable([file('Books.csv', CSV)], 'notes')

    expect(plan.files.map((one) => one.path)).toEqual([
      'Books/Dune.md',
      'Books/Ubik.md',
      'Books.base',
    ])

    const text = noteAt(plan, 'Books/Dune.md')
    expect(text).toContain('# Dune')
    expect(text).toContain('status: Read')
    // Quoted, so the column stays the words it held rather than becoming a
    // number; single quotes, because those need no escapes inside them.
    expect(text).toContain("pages: '412'")
    expect(text).toContain('date: 2026-01-02')
    expect(text).not.toContain('name: Dune')
  })

  test('comes with a base that shows the folder as a table', async () => {
    const plan = await readTable([file('Books.csv', CSV)], 'notes')
    const base = readBase(noteAt(plan, 'Books.base'))

    expect(base.filters).toEqual({
      or: ['file.folder == "Books"', 'file.folder.endsWith("/Books")'],
    })
    expect(base.views[0]?.order).toEqual([
      'file.name',
      'note.status',
      'note.pages',
      'note.date',
      'note.notes',
    ])
  })

  test('a column holding a paragraph becomes words rather than a property', () => {
    const note = rowNote(['Name', 'Notes'], { Name: 'Dune', Notes: 'One line\nAnother line' })

    expect(note.text).toContain('## Notes')
    expect(note.text).toContain('One line\nAnother line')
  })

  test('a row with no name is still a note', () => {
    const note = rowNote(['Name', 'Status'], { Name: '', Status: 'Done' })

    expect(note.name).toBe('Untitled')
  })

  test('the column a row is named after is the one that says so', () => {
    const note = rowNote(['Ref', 'Title'], { Ref: '17', Title: 'The plan' })

    expect(note.name).toBe('The plan')
  })
})

describe('a file with no rows in it', () => {
  test('says so rather than making an empty note', async () => {
    const plan = await readTable([file('Empty.csv', '')])

    expect(plan.files).toHaveLength(0)
    expect(plan.lost).toHaveLength(1)
  })
})
