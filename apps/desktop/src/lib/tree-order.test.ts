import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import {
  byName,
  isSortMode,
  ordered,
  orderedTree,
  renamedIn,
  SORT_MODES,
  withoutName,
} from './tree-order'

function file(name: string, times: { modified?: number; created?: number } = {}): Entry {
  return {
    name,
    path: `/s/${name}`,
    is_dir: false,
    modified: times.modified ?? 0,
    created: times.created ?? 0,
    children: [],
  }
}

function folder(name: string, children: Entry[] = []): Entry {
  return { ...file(name), path: `/s/${name}`, is_dir: true, children }
}

/** The names of what an order put where, so a whole answer reads in one line. */
const names = (entries: readonly Entry[]) => entries.map((one) => one.name)

describe('comparing two names the way a reader reads them', () => {
  test('counts the digits in a name rather than spelling them', () => {
    expect([...['Note 10', 'Note 2', 'Note 1'].sort(byName)]).toEqual([
      'Note 1',
      'Note 2',
      'Note 10',
    ])
  })

  test('ignores the case of the first letter', () => {
    expect([...['beta.md', 'Alpha.md'].sort(byName)]).toEqual(['Alpha.md', 'beta.md'])
  })

  test('still answers for two names that differ only in case, so an order is stable', () => {
    expect(byName('a.md', 'A.md')).not.toBe(0)
    expect(byName('a.md', 'A.md')).toBe(-byName('A.md', 'a.md'))
  })

  test('answers nothing only for the same name twice', () => {
    expect(byName('a.md', 'a.md')).toBe(0)
  })
})

describe('the order a folder is drawn in', () => {
  const tree = [
    file('b.md', { modified: 30, created: 1 }),
    folder('Zed'),
    file('a.md', { modified: 10, created: 3 }),
    folder('Alpha'),
    file('c.md', { modified: 20, created: 2 }),
  ]

  test('puts the folders first, whatever the key', () => {
    for (const mode of SORT_MODES) {
      // Manual as well, while nobody has moved a row: it falls back to where the
      // other six leave the list, so choosing it changes nothing on the screen.
      const shown = names(ordered(tree, mode, []))
      expect(shown.slice(0, 2).sort(byName), mode).toEqual(['Alpha', 'Zed'])
    }
  })

  test('by name, A to Z', () => {
    expect(names(ordered(tree, 'name', []))).toEqual(['Alpha', 'Zed', 'a.md', 'b.md', 'c.md'])
  })

  test('by name, Z to A', () => {
    expect(names(ordered(tree, 'name-desc', []))).toEqual(['Zed', 'Alpha', 'c.md', 'b.md', 'a.md'])
  })

  test('by the time it was last written in, newest first', () => {
    expect(names(ordered(tree, 'modified-desc', []))).toEqual([
      'Alpha',
      'Zed',
      'b.md',
      'c.md',
      'a.md',
    ])
  })

  test('and oldest first', () => {
    expect(names(ordered(tree, 'modified-asc', []))).toEqual([
      'Alpha',
      'Zed',
      'a.md',
      'c.md',
      'b.md',
    ])
  })

  test('by the time it was made, newest first', () => {
    expect(names(ordered(tree, 'created-desc', []))).toEqual([
      'Alpha',
      'Zed',
      'a.md',
      'c.md',
      'b.md',
    ])
  })

  test('and oldest first', () => {
    expect(names(ordered(tree, 'created-asc', []))).toEqual([
      'Alpha',
      'Zed',
      'b.md',
      'c.md',
      'a.md',
    ])
  })

  test('two files written in the same second fall back to their names', () => {
    const same = [file('z.md', { modified: 5 }), file('a.md', { modified: 5 })]
    expect(names(ordered(same, 'modified-desc', []))).toEqual(['a.md', 'z.md'])
  })

  test('leaves the listing it was given alone', () => {
    const given = [...tree]
    ordered(given, 'name-desc', [])
    expect(given).toEqual(tree)
  })
})

describe('the order somebody arranged', () => {
  const tree = [file('b.md'), file('a.md'), file('c.md')]

  test('follows the list', () => {
    expect(names(ordered(tree, 'manual', ['c.md', 'a.md']))).toEqual(['c.md', 'a.md', 'b.md'])
  })

  test('puts a name the list has not heard of at the end, in name order', () => {
    const four = [...tree, file('d.md')]
    expect(names(ordered(four, 'manual', ['c.md']))).toEqual(['c.md', 'a.md', 'b.md', 'd.md'])
  })

  test('is name order for a folder nobody has arranged', () => {
    expect(names(ordered(tree, 'manual', []))).toEqual(names(ordered(tree, 'name', [])))
  })

  test('ignores a name the folder no longer holds', () => {
    expect(names(ordered(tree, 'manual', ['gone.md', 'c.md']))).toEqual(['c.md', 'a.md', 'b.md'])
  })

  test('lets a note sit above a folder, which no other order does', () => {
    const mixed = [folder('Two'), file('b.md'), folder('One'), file('a.md')]
    expect(names(ordered(mixed, 'manual', ['b.md', 'Two']))).toEqual(['b.md', 'Two', 'One', 'a.md'])
  })

  test('but a name nobody arranged still falls where it was, which is folders first', () => {
    const mixed = [folder('Two'), file('b.md'), folder('One'), file('a.md')]
    expect(names(ordered(mixed, 'manual', ['a.md']))).toEqual(['a.md', 'One', 'Two', 'b.md'])
  })
})

describe('a name the tree no longer knows by that name', () => {
  test('a rename keeps the place it was arranged into', () => {
    expect(renamedIn(['c.md', 'a.md'], 'c.md', 'zebra.md')).toEqual(['zebra.md', 'a.md'])
  })

  test('a rename onto a name the list already holds leaves one of them', () => {
    expect(renamedIn(['c.md', 'a.md'], 'c.md', 'a.md')).toEqual(['a.md'])
  })

  test('a name nothing arranged is nothing to rewrite', () => {
    expect(renamedIn(['c.md'], 'a.md', 'b.md')).toBeNull()
  })

  test('a row that has gone leaves the list', () => {
    expect(withoutName(['c.md', 'a.md'], 'c.md')).toEqual(['a.md'])
  })

  test('a row nothing arranged leaves it alone', () => {
    expect(withoutName(['c.md'], 'a.md')).toBeNull()
  })
})

describe('the whole tree in the order it is read in', () => {
  test('every folder of it, however deep', () => {
    const tree = folder('s', [
      folder('Work', [file('b.md'), file('a.md')]),
      file('z.md'),
      file('c.md'),
    ])
    const out = orderedTree(tree, 'name', () => [])
    expect(names(out.children)).toEqual(['Work', 'c.md', 'z.md'])
    expect(names(out.children[0]?.children ?? [])).toEqual(['a.md', 'b.md'])
  })

  test('asks for the arranged names under the folder that holds them', () => {
    const tree = folder('s', [folder('Work', [file('b.md'), file('a.md')])])
    const asked: string[] = []
    orderedTree(tree, 'manual', (path) => {
      asked.push(path)
      return []
    })
    expect(asked).toEqual(['/s/s', '/s/Work'])
  })

  test('answers the same tree back where nothing about the order is a question', () => {
    const tree = folder('s', [file('a.md'), file('b.md')])
    expect(orderedTree(tree, 'name', () => [])).toEqual(tree)
  })
})

describe('reading a chosen order out of storage', () => {
  test('takes every order the menu offers', () => {
    for (const mode of SORT_MODES) expect(isSortMode(mode), mode).toBe(true)
  })

  test('and nothing else', () => {
    expect(isSortMode('sideways')).toBe(false)
    expect(isSortMode(7)).toBe(false)
    expect(isSortMode(undefined)).toBe(false)
  })
})
