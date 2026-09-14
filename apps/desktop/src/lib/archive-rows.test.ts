import { describe, expect, test } from 'vitest'
import { archiveGroups, insideFolder } from './archive-rows'

/** How the archive reads. The ordering is the whole of what the list promises - where each
 *  thing was, and the most recent decision first - so it is said here, without a screen. */

const row = (at: string, when: number | null) => ({ at, when })

describe('the archive, grouped', () => {
  test('puts each thing under the folder it was in', () => {
    const groups = archiveGroups([
      row('Old/Last year.md', 3),
      row('Drafts/Plan.md', 2),
      row('Old/Notes.md', 1),
    ])

    expect(groups.map((group) => group.at)).toEqual(['Drafts', 'Old'])
    expect(groups[1]?.rows.map((one) => one.at)).toEqual(['Old/Last year.md', 'Old/Notes.md'])
  })

  test('newest first inside a group', () => {
    const groups = archiveGroups([row('A.md', 1), row('B.md', 3), row('C.md', 2)])

    expect(groups[0]?.rows.map((one) => one.at)).toEqual(['B.md', 'C.md', 'A.md'])
  })

  test('and a file that says a word rather than a date sorts last', () => {
    // Which is the honest answer: the file does not say when. A note ticked `archived: true`
    // in Obsidian is one of these.
    const groups = archiveGroups([row('Ticked.md', null), row('Dated.md', 1)])

    expect(groups[0]?.rows.map((one) => one.at)).toEqual(['Dated.md', 'Ticked.md'])
  })

  test('with the groups themselves in the file list’s own order', () => {
    const groups = archiveGroups([row('z/A.md', 1), row('a/B.md', 1), row('m/C.md', 1)])

    expect(groups.map((group) => group.at)).toEqual(['a', 'm', 'z'])
  })

  test('and a thing at the space’s own floor in a group with no name', () => {
    const groups = archiveGroups([row('Top.md', 1), row('Under/Deep.md', 1)])

    expect(groups.map((group) => group.at)).toEqual(['', 'Under'])
  })

  test('leaves the rows it was given exactly as they were', () => {
    // The list is drawn from the predicate's own answer, and sorting that in place would be
    // this view reordering what every other list reads.
    const rows = [row('A.md', 1), row('B.md', 3)]
    archiveGroups(rows)

    expect(rows.map((one) => one.at)).toEqual(['A.md', 'B.md'])
  })

  test('and nothing archived is no groups at all', () => {
    expect(archiveGroups([])).toEqual([])
  })
})

describe('narrowed to one folder', () => {
  test('keeps what is inside it, at any depth', () => {
    const groups = archiveGroups(
      [row('2019/March/A.md', 1), row('2019/B.md', 1), row('Other/C.md', 1)],
      '2019',
    )

    expect(groups.map((group) => group.at)).toEqual(['2019', '2019/March'])
  })

  test('and the folder itself where the folder is what was archived', () => {
    expect(insideFolder('2019', '2019')).toBe(true)
    expect(insideFolder('2019/March/A.md', '2019')).toBe(true)
  })

  test('but not a name that only starts the same', () => {
    expect(insideFolder('2019 plans.md', '2019')).toBe(false)
    expect(insideFolder('Older/A.md', 'Old')).toBe(false)
  })

  test('and no narrowing is the whole archive', () => {
    expect(insideFolder('anywhere/at/all.md', null)).toBe(true)
    expect(archiveGroups([row('A.md', 1)], null)).toHaveLength(1)
  })
})
