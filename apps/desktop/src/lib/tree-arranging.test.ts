import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import { shownNames } from './tree-order'
import { movedTo, placedBeside, stepped, trimmed } from './tree-arranging'

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
  const three = [file('a.md'), file('b.md'), file('c.md')]
  const mixed = [folder('A'), folder('B'), file('a.md'), file('b.md')]

  test('nothing at all while the order is the one it would have read in anyway', () => {
    expect(trimmed(three, ['a.md', 'b.md', 'c.md'])).toEqual([])
  })

  test('only as far as somebody actually arranged', () => {
    expect(trimmed(three, ['c.md', 'a.md', 'b.md'])).toEqual(['c.md'])
  })

  test('the whole of a reversed order', () => {
    expect(trimmed(three, ['c.md', 'b.md', 'a.md'])).toEqual(['c.md', 'b.md'])
  })

  test('and nothing where the folders lead, which is where they already were', () => {
    expect(trimmed(mixed, ['A', 'B', 'a.md', 'b.md'])).toEqual([])
  })

  test('the note somebody put above the folders', () => {
    expect(trimmed(mixed, ['a.md', 'A', 'B', 'b.md'])).toEqual(['a.md'])
  })

  test('what it keeps draws the order it was given', () => {
    const four = [file('a.md'), file('b.md'), file('c.md'), file('d.md')]
    const want = ['c.md', 'a.md', 'b.md', 'd.md']
    expect(shownNames(four, 'manual', trimmed(four, want))).toEqual(want)
  })

  test('and the same where a note sits between two folders', () => {
    const want = ['A', 'a.md', 'B', 'b.md']
    expect(shownNames(mixed, 'manual', trimmed(mixed, want))).toEqual(want)
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
    expect(placedBeside(children, [], ['c.md'], 'a.md', false)).toEqual(['Deep', 'c.md'])
  })

  test('below it, and the list runs only as far as the move reached', () => {
    // `Deep, b.md` is the whole of what was arranged: what follows it falls back to
    // where it already was, which puts `a.md` next and `c.md` after it.
    expect(placedBeside(children, [], ['a.md'], 'b.md', true)).toEqual(['Deep', 'b.md'])
    expect(shownNames(children, 'manual', ['Deep', 'b.md'])).toEqual([
      'Deep',
      'b.md',
      'a.md',
      'c.md',
    ])
  })

  test('a folder dropped among the notes stays where it was dropped', () => {
    // Emil: *"for the manual ordering mode in explorer, it should not be enforced
    // that directories display above files."* Every gap is a gap to drop in.
    expect(
      shownNames(children, 'manual', placedBeside(children, [], ['Deep'], 'b.md', true)),
    ).toEqual(['a.md', 'b.md', 'Deep', 'c.md'])
  })

  test('and a note dropped above the folder stays above it', () => {
    expect(
      shownNames(children, 'manual', placedBeside(children, [], ['c.md'], 'Deep', false)),
    ).toEqual(['c.md', 'Deep', 'a.md', 'b.md'])
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

  test('nothing for a name the list does not hold', () => {
    expect(stepped(three, 'gone.md', 1)).toBeNull()
  })

  test('over a folder as readily as over a note', () => {
    expect(stepped(['Deep', 'a.md'], 'a.md', -1)).toEqual(['a.md', 'Deep'])
  })
})
