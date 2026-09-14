import { beforeEach, describe, expect, test } from 'vitest'
import { LeftOut } from './left-out.svelte'

/** The one question every list that speaks for the space asks, and its two sources.
 *
 *  What is worth holding here is that the two sources are one answer: a list that honours
 *  this honours both, which is the whole reason it exists rather than each list learning
 *  about the archive the way it had already learnt about exclusion.
 *
 *  And that the two are still told apart where the reader can tell: an excluded note may be
 *  deleted and offers to be searched again, an archived one may never be deleted and offers
 *  to be taken back. `has` folds them together; `isArchived` does not.
 *
 *  Nothing is stubbed. The sources are functions the workspace hands in, which is what lets
 *  this be said without a workspace, a scan or a store behind it. */

const ROOT = '/space'
const at = (relative: string) => `${ROOT}/${relative}`

let chosen: string[]
let files: string[]
let folders: string[]
let root: string | null
let leftOut: LeftOut

beforeEach(() => {
  chosen = []
  files = []
  folders = []
  root = ROOT
  leftOut = new LeftOut({
    root: () => root,
    chosen: () => chosen,
    archivedFiles: () => files,
    archivedFolders: () => folders,
  })
})

describe('what the space leaves out', () => {
  test('is a reader’s own exclusions and the archive, as one list', () => {
    chosen = ['Drafts']
    files = ['Old/Last year.md']
    folders = ['2019']

    expect(leftOut.of(ROOT).sort()).toEqual(['2019', 'Drafts', 'Old/Last year.md'])
  })

  test('with a path said once, however many sources say it', () => {
    // A reader may well have left out the folder a note they then archived sits in, and a
    // path said twice is a comparison done twice on every note the search walks.
    chosen = ['Old/Last year.md']
    files = ['Old/Last year.md']

    expect(leftOut.of(ROOT)).toEqual(['Old/Last year.md'])
  })

  test('and nothing at all while there is no space', () => {
    root = null
    files = ['A.md']

    expect(leftOut.here).toEqual([])
    expect(leftOut.has(at('A.md'))).toBe(false)
  })

  test('is only what another space left out by hand', () => {
    // The archive answers for the space the index has been built for, which is the only one
    // any list is drawn from. Another space gets what it held before archiving existed.
    chosen = ['Drafts']
    files = ['A.md']

    expect(leftOut.of('/elsewhere')).toEqual(['Drafts'])
  })
})

describe('asking about one path', () => {
  test('takes it as the app holds one, or as the space speaks it', () => {
    files = ['Old/Last year.md']

    expect(leftOut.has(at('Old/Last year.md'))).toBe(true)
    expect(leftOut.has('Old/Last year.md')).toBe(true)
  })

  test('and a folder stands for everything under it', () => {
    folders = ['2019']

    expect(leftOut.has(at('2019'))).toBe(true)
    expect(leftOut.has(at('2019/March/Notes.md'))).toBe(true)
    expect(leftOut.has(at('2019 plans.md'))).toBe(false)
  })

  test('but a name that only starts the same is not inside it', () => {
    folders = ['Old']

    expect(leftOut.has(at('Older/A.md'))).toBe(false)
  })
})

describe('archived, as against left out by hand', () => {
  test('are the same to a list and different to the reader', () => {
    chosen = ['Drafts']
    files = ['Old/Last year.md']

    expect(leftOut.has(at('Drafts/A.md'))).toBe(true)
    expect(leftOut.isArchived(at('Drafts/A.md'))).toBe(false)

    expect(leftOut.has(at('Old/Last year.md'))).toBe(true)
    expect(leftOut.isArchived(at('Old/Last year.md'))).toBe(true)
  })

  test('and only the exact row is the one that can be taken back', () => {
    // A note inside an archived folder is hidden by the folder, not by its own mark, so the
    // folder's row is where Unarchive belongs. A row that said it and left the note hidden
    // would be a row that lied.
    folders = ['2019']

    expect(leftOut.isArchived(at('2019/March/Notes.md'))).toBe(true)
    expect(leftOut.namesArchived(at('2019/March/Notes.md'))).toBe(false)
    expect(leftOut.namesArchived(at('2019'))).toBe(true)
  })

  test('with the files and the folders in one list', () => {
    files = ['A.md']
    folders = ['2019']

    expect(leftOut.archived.sort()).toEqual(['2019', 'A.md'])
  })
})

describe('what is archived inside a folder', () => {
  test('is everything under it, and the folder itself where it is the archived one', () => {
    files = ['2019/March/Notes.md', '2019/April/Plan.md', 'Elsewhere/A.md']

    expect(leftOut.archivedInside(at('2019')).sort()).toEqual([
      '2019/April/Plan.md',
      '2019/March/Notes.md',
    ])
    expect(leftOut.archivedInside(at('Nothing here'))).toEqual([])
  })
})

describe('whether a row may be deleted', () => {
  test('an archived note may not, which is the whole promise', () => {
    files = ['Old/Last year.md']

    expect(leftOut.refusesDeleting(at('Old/Last year.md'))).toEqual({
      itself: true,
      inside: ['Old/Last year.md'],
    })
  })

  test('nor a note inside an archived folder', () => {
    folders = ['2019']

    expect(leftOut.refusesDeleting(at('2019/March/Notes.md'))?.itself).toBe(true)
  })

  test('nor the folder above an archived note, which would take it along', () => {
    files = ['2019/March/Notes.md', '2019/April/Plan.md']

    const refused = leftOut.refusesDeleting(at('2019'))
    expect(refused?.itself).toBe(false)
    expect(refused?.inside).toHaveLength(2)
  })

  test('but an ordinary note may, and so may a folder with nothing archived in it', () => {
    files = ['Old/Last year.md']

    expect(leftOut.refusesDeleting(at('Plan.md'))).toBeNull()
    expect(leftOut.refusesDeleting(at('Drafts'))).toBeNull()
  })

  test('and a note left out of the search by hand may be deleted like any other', () => {
    // Leaving a folder out of the search says nothing about whether its notes are wanted.
    // Archiving says they are kept, and that is the only one of the two this refuses.
    chosen = ['Drafts']

    expect(leftOut.has(at('Drafts/A.md'))).toBe(true)
    expect(leftOut.refusesDeleting(at('Drafts/A.md'))).toBeNull()
  })
})
