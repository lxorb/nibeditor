import { describe, expect, test } from 'vitest'
import type { Entry } from '../workspace.svelte'
import { noteRows } from './notes'

const ROOT = '/Space'

const note = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path: `${ROOT}/${path}`,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})

const FILES = [note('Plan.md'), note('Uni/Lecture 3.md'), note('Uni/Plan.md'), note('Home/Tax.md')]

/** Each row as the path under the space and the folder it says it is in. */
const shown = (term: string, recent: string[] = []) =>
  noteRows(term, FILES, recent, ROOT).map((row) => [
    row.entry.path.slice(ROOT.length + 1),
    row.folder,
  ])

describe('the notes the palette lists', () => {
  test('with nothing typed, the ones opened lately first', () => {
    expect(shown('', [`${ROOT}/Home/Tax.md`]).map(([path]) => path)).toEqual([
      'Home/Tax.md',
      'Plan.md',
      'Uni/Lecture 3.md',
      'Uni/Plan.md',
    ])
  })

  test('finds a note by its folder, and says which folder', () => {
    expect(shown('uni/lec')).toEqual([['Uni/Lecture 3.md', 'Uni']])
  })

  test('says where a note is only when another shares its name', () => {
    expect(shown('lecture')).toEqual([['Uni/Lecture 3.md', null]])
    expect(shown('plan')).toEqual([
      ['Plan.md', null],
      ['Uni/Plan.md', 'Uni'],
    ])
  })
})
