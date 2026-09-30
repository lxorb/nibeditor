import { describe, expect, test } from 'vitest'
import { standing, toArchive, toRestore } from './archive-plan'

/** Which entries one gesture touches: the two rules the archive's promises rest on. */

describe('archiving a selection', () => {
  test('puts each row away once, in the order it was picked', () => {
    expect(toArchive(['b.md', 'a.md', 'b.md'], new Set())).toEqual(['b.md', 'a.md'])
  })

  test('and a row inside another row of the selection goes with that one', () => {
    expect(toArchive(['Old/Plan.md', 'Old', 'Older.md'], new Set())).toEqual(['Old', 'Older.md'])
  })

  test('and leaves alone what an archived folder already hides', () => {
    expect(toArchive(['Old/Plan.md', 'New.md'], new Set(['Old']))).toEqual(['New.md'])
  })
})

describe('what the archive lists', () => {
  test('is every archived row that is not inside another archived folder', () => {
    expect(standing(new Set(['Old', 'Old/2019/Taxes.md', 'Plan.md', 'Older']))).toEqual([
      'Old',
      'Plan.md',
      'Older',
    ])
  })
})

describe('taking a row back', () => {
  const tree: Record<string, string[]> = {
    Old: ['Old/2019', 'Old/Notes.md'],
    'Old/2019': ['Old/2019/Taxes.md', 'Old/2019/Trip.md', 'Old/2019/Kept.md'],
  }
  const childrenOf = (folder: string) => tree[folder] ?? []

  test('that was put away on its own takes back just that row', () => {
    expect(toRestore(new Set(['Plan.md']), 'Plan.md', childrenOf)).toEqual({
      restore: ['Plan.md'],
      archive: [],
    })
  })

  test('from inside an archived folder brings the folder back around it, and nothing else', () => {
    expect(toRestore(new Set(['Old']), 'Old/2019/Taxes.md', childrenOf)).toEqual({
      restore: ['Old'],
      archive: ['Old/Notes.md', 'Old/2019/Trip.md', 'Old/2019/Kept.md'],
    })
  })

  test('takes back every archived folder on the way down, and the row itself', () => {
    const keys = new Set(['Old', 'Old/2019', 'Old/2019/Taxes.md', 'Old/2019/Kept.md'])

    expect(toRestore(keys, 'Old/2019/Taxes.md', childrenOf)).toEqual({
      restore: ['Old', 'Old/2019', 'Old/2019/Taxes.md'],
      // What was archived on its own already stays archived without a new entry.
      archive: ['Old/Notes.md', 'Old/2019/Trip.md'],
    })
  })

  test('that nothing hides touches nothing', () => {
    expect(toRestore(new Set(['Other.md']), 'Plan.md', childrenOf)).toEqual({
      restore: [],
      archive: [],
    })
  })
})
