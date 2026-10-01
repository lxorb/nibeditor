import { describe, expect, test } from 'vitest'
import { flatRows, heldRows, rowIndex } from './tree-flat'
import type { Entry } from './workspace.svelte'

const file = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})

const folder = (path: string, children: Entry[]): Entry => ({
  ...file(path),
  is_dir: true,
  children,
})

/** A space with a note that holds notes, a note that holds one of those, and a
 *  folder out of somebody's vault with no note of its own:
 *
 *      Work            a note holding notes, drawn as Work/Work.md
 *        Notes         another, drawn as Work/Notes/Notes.md
 *          deep.md
 *        plan.md
 *      Projects        a folder nobody has written in
 *        one.md
 *      Read me.md      */
const WORK = folder('/s/Work', [
  file('/s/Work/Work.md'),
  folder('/s/Work/Notes', [file('/s/Work/Notes/Notes.md'), file('/s/Work/Notes/deep.md')]),
  file('/s/Work/plan.md'),
])
const PROJECTS = folder('/s/Projects', [file('/s/Projects/one.md')])
const READ_ME = file('/s/Read me.md')

const SPACE = folder('/s', [WORK, PROJECTS, READ_ME])

const open = (...paths: string[]) => {
  const held = new Set(paths)
  return (path: string) => held.has(path)
}

const shown = (...paths: string[]) =>
  flatRows(SPACE, open(...paths)).map((one) => `${'  '.repeat(one.depth)}${one.entry.path}`)

describe('the file list as one flat list of rows', () => {
  test('shows the top of the space while nothing is open', () => {
    expect(shown()).toEqual(['/s/Work', '/s/Projects', '/s/Read me.md'])
  })

  /** A note that holds notes is one row, not a folder and a note: the note the
   *  folder is named after is the row, so the walk steps past it the way the eye
   *  does. See folder-notes.ts. */
  test('and never the note a row is itself drawn as', () => {
    expect(shown('/s/Work')).toEqual([
      '/s/Work',
      '  /s/Work/Notes',
      '  /s/Work/plan.md',
      '/s/Projects',
      '/s/Read me.md',
    ])
  })

  test('one step in per note that holds the one under it', () => {
    expect(shown('/s/Work', '/s/Work/Notes')).toEqual([
      '/s/Work',
      '  /s/Work/Notes',
      '    /s/Work/Notes/deep.md',
      '  /s/Work/plan.md',
      '/s/Projects',
      '/s/Read me.md',
    ])
  })

  /** A folder out of a vault has no note of its own, so everything in it is a row,
   *  including a note of the folder's own name would be if there were one. */
  test('and a folder nobody has written in shows all of what it holds', () => {
    expect(shown('/s/Projects')).toEqual([
      '/s/Work',
      '/s/Projects',
      '  /s/Projects/one.md',
      '/s/Read me.md',
    ])
  })

  test('a shut note holds nothing open, however deep it goes', () => {
    expect(shown('/s/Work/Notes')).toEqual(['/s/Work', '/s/Projects', '/s/Read me.md'])
  })

  test('and a space nobody has listed yet is no rows at all', () => {
    expect(flatRows(null, open())).toEqual([])
  })
})

/** What a twist's slide is measured in: how many rows appear or go when it turns. */
describe('how many rows a note holds open', () => {
  test('counts what the row discloses and not the note it is drawn as', () => {
    expect(heldRows(WORK, open('/s/Work'))).toBe(2)
  })

  test('and everything under it that is open too', () => {
    expect(heldRows(WORK, open('/s/Work', '/s/Work/Notes'))).toBe(3)
  })

  test('nothing for a row that holds nothing', () => {
    expect(heldRows(READ_ME, open())).toBe(0)
  })
})

describe('where each row is', () => {
  test('is the number the window and the walk both speak in', () => {
    const at = rowIndex(flatRows(SPACE, open('/s/Work')))

    expect(at.get('/s/Work')).toBe(0)
    expect(at.get('/s/Work/plan.md')).toBe(2)
    expect(at.get('/s/Read me.md')).toBe(4)
    expect(at.get('/s/Work/Work.md')).toBeUndefined()
  })
})
