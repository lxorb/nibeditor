import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import {
  byName,
  groupNames,
  keptOrder,
  movedTo,
  ordered,
  orderedTree,
  placedBeside,
  renamedIn,
  shownNames,
  isSortMode,
  SORT_MODES,
  stepped,
  trimmed,
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

  test('arranges the folders among the folders and the files among the files', () => {
    const mixed = [folder('Two'), file('b.md'), folder('One'), file('a.md')]
    expect(names(ordered(mixed, 'manual', ['b.md', 'Two']))).toEqual(['Two', 'One', 'b.md', 'a.md'])
  })
})

describe('what a folder keeps of the order it is drawn in', () => {
  test('nothing at all while the order is name order', () => {
    expect(trimmed(['a.md', 'b.md', 'c.md'])).toEqual([])
  })

  test('only as far as somebody actually arranged', () => {
    expect(trimmed(['c.md', 'a.md', 'b.md'])).toEqual(['c.md'])
  })

  test('the whole of a reversed order', () => {
    expect(trimmed(['c.md', 'b.md', 'a.md'])).toEqual(['c.md', 'b.md'])
  })

  test('the folders and the files each on their own', () => {
    const children = [folder('B'), folder('A'), file('b.md'), file('a.md')]
    expect(keptOrder(children, ['B', 'A', 'b.md', 'a.md'])).toEqual(['B', 'b.md'])
  })

  test('and nothing where neither group was arranged', () => {
    const children = [folder('A'), folder('B'), file('a.md'), file('b.md')]
    expect(keptOrder(children, ['A', 'B', 'a.md', 'b.md'])).toEqual([])
  })

  test('what it keeps draws the order it was given', () => {
    const children = [file('a.md'), file('b.md'), file('c.md'), file('d.md')]
    const want = ['c.md', 'a.md', 'b.md', 'd.md']
    expect(shownNames(children, 'manual', keptOrder(children, want))).toEqual(want)
  })
})

describe('a row put somewhere by hand', () => {
  const four = ['a.md', 'b.md', 'c.md', 'd.md']

  test('lands above the row it was dropped on', () => {
    expect(movedTo(four, ['d.md'], 1)).toEqual(['a.md', 'd.md', 'b.md', 'c.md'])
  })

  test('lands below it', () => {
    expect(movedTo(four, ['a.md'], 3)).toEqual(['b.md', 'c.md', 'a.md', 'd.md'])
  })

  test('takes the whole selection with it, in the order the list had them', () => {
    expect(movedTo(four, ['d.md', 'b.md'], 0)).toEqual(['b.md', 'd.md', 'a.md', 'c.md'])
  })

  test('goes to the end for an index past it', () => {
    expect(movedTo(four, ['a.md'], 99)).toEqual(['b.md', 'c.md', 'd.md', 'a.md'])
  })

  test('changes nothing when it lands where it already was', () => {
    expect(movedTo(four, ['b.md'], 1)).toEqual(four)
  })

  test('ignores a name the list does not hold', () => {
    expect(movedTo(four, ['gone.md'], 0)).toEqual(four)
  })
})

describe('dropping a row beside another', () => {
  const children = [folder('Deep'), file('a.md'), file('b.md'), file('c.md')]

  test('above the row it was dropped on', () => {
    expect(placedBeside(children, [], ['c.md'], 'a.md', false)).toEqual(['c.md'])
  })

  test('below it, and the list runs only as far as the move reached', () => {
    // `b.md` first is the whole of what was arranged: what follows it falls back
    // to name order, which puts `a.md` next and `c.md` after it.
    expect(placedBeside(children, [], ['a.md'], 'b.md', true)).toEqual(['b.md'])
    expect(shownNames(children, 'manual', ['b.md'])).toEqual(['Deep', 'b.md', 'a.md', 'c.md'])
  })

  test('a folder cannot be dropped among the files, so it stays in its own group', () => {
    // The gap only ever opens inside the group the row belongs to, which is why
    // dropping the only folder beside a note leaves the order as it was.
    expect(
      shownNames(children, 'manual', placedBeside(children, [], ['Deep'], 'b.md', true)),
    ).toEqual(['Deep', 'a.md', 'b.md', 'c.md'])
  })
})

describe('one step with a key', () => {
  const three = ['a.md', 'b.md', 'c.md']

  test('up', () => {
    expect(stepped(three, 'c.md', -1)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  test('down', () => {
    expect(stepped(three, 'a.md', 1)).toEqual(['b.md', 'a.md', 'c.md'])
  })

  test('nothing off the top', () => {
    expect(stepped(three, 'a.md', -1)).toBeNull()
  })

  test('nothing off the bottom', () => {
    expect(stepped(three, 'c.md', 1)).toBeNull()
  })

  test('nothing for a name the group does not hold', () => {
    expect(stepped(three, 'gone.md', 1)).toBeNull()
  })
})

describe('which names sit in the same group', () => {
  const children = [folder('B'), folder('A'), file('b.md'), file('a.md')]

  test('the folders', () => {
    expect(groupNames(children, ['B', 'A', 'b.md', 'a.md'], true)).toEqual(['B', 'A'])
  })

  test('the files', () => {
    expect(groupNames(children, ['B', 'A', 'b.md', 'a.md'], false)).toEqual(['b.md', 'a.md'])
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
