import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import { shownNames } from './tree-order'
import { groupNames, keptOrder, movedTo, placedBeside, stepped, trimmed } from './tree-arranging'

/** Where a row lands when somebody drops it, and what the folder keeps afterwards.
 *
 *  The half of the order that only a drag asks for, tested beside the module it is in:
 *  see tree-order.test.ts for the comparator, which is the half every window runs
 *  before it draws a row. */

function file(name: string): Entry {
  return { name, path: `/s/${name}`, is_dir: false, modified: 0, created: 0, children: [] }
}

function folder(name: string): Entry {
  return { ...file(name), is_dir: true }
}

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
