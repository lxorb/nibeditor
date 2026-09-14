import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import { entryAt, withComing, withEntry, withMove, withoutEntry } from './tree-edits'
import { orderedTree } from './tree-order'

function file(path: string): Entry {
  return {
    // Either separator, because a listing off a Windows disk speaks backslashes
    // and the browser build's speaks slashes.
    name: path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1),
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

function folder(path: string, children: Entry[] = []): Entry {
  return { ...file(path), is_dir: true, children }
}

function root(): Entry {
  return folder('/N', [
    folder('/N/Deep', [file('/N/Deep/inner.md')]),
    file('/N/a.md'),
    file('/N/c.md'),
  ])
}

/** The tree as paths, so a whole shape reads in one line. */
function shape(entry: Entry): string[] {
  return entry.children.flatMap((child) => [child.path, ...shape(child)])
}

describe('a row put into the tree before the disk answers', () => {
  /** Where in its folder a row lands is nobody's business here: the order the rows
   *  are drawn in is decided over the whole listing, once, for all seven orders at
   *  once - see tree-order.ts - so what this owes is the right folder. The last
   *  describe in the file is the two halves together. */
  test('lands in the folder it belongs to', () => {
    expect(shape(withEntry(root(), file('/N/b.md')))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/c.md',
      '/N/b.md',
    ])
  })

  test('inside a folder, not at the top', () => {
    expect(shape(withEntry(root(), file('/N/Deep/also.md')))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/Deep/also.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('a row that is already there is not doubled', () => {
    const again = withEntry(root(), file('/N/a.md'))
    expect(shape(again)).toHaveLength(shape(root()).length)
    expect(shape(again).filter((path) => path === '/N/a.md')).toEqual(['/N/a.md'])
  })

  test('the tree it was given is left alone', () => {
    const before = root()
    withEntry(before, file('/N/b.md'))
    expect(shape(before)).toEqual(shape(root()))
  })
})

describe('a row taken out before the disk answers', () => {
  test('goes, and nothing else moves', () => {
    expect(shape(withoutEntry(root(), '/N/a.md'))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/c.md',
    ])
  })

  test('a folder takes its contents with it', () => {
    expect(shape(withoutEntry(root(), '/N/Deep'))).toEqual(['/N/a.md', '/N/c.md'])
  })

  test('a row inside a folder', () => {
    expect(shape(withoutEntry(root(), '/N/Deep/inner.md'))).toEqual([
      '/N/Deep',
      '/N/a.md',
      '/N/c.md',
    ])
  })
})

describe('a row renamed or moved before the disk answers', () => {
  test('a rename is the row out and the row back under its new name', () => {
    expect(shape(withMove(root(), '/N/a.md', '/N/z.md'))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/c.md',
      '/N/z.md',
    ])
  })

  test('a move into a folder takes the row there', () => {
    expect(shape(withMove(root(), '/N/c.md', '/N/Deep/c.md'))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/Deep/c.md',
      '/N/a.md',
    ])
  })

  test('a folder takes its contents along, paths and all', () => {
    const moved = withMove(root(), '/N/Deep', '/N/Shallow')
    expect(shape(moved)).toEqual(['/N/a.md', '/N/c.md', '/N/Shallow', '/N/Shallow/inner.md'])
    expect(entryAt(moved, '/N/Shallow/inner.md')?.name).toBe('inner.md')
  })

  test('a row that is not there changes nothing', () => {
    expect(shape(withMove(root(), '/N/missing.md', '/N/b.md'))).toEqual(shape(root()))
  })

  test('the new name is the one shown', () => {
    expect(entryAt(withMove(root(), '/N/a.md', '/N/z.md'), '/N/z.md')?.name).toBe('z.md')
  })
})

describe('finding a row', () => {
  test('at the top, deep down, and not at all', () => {
    expect(entryAt(root(), '/N/a.md')?.path).toBe('/N/a.md')
    expect(entryAt(root(), '/N/Deep/inner.md')?.path).toBe('/N/Deep/inner.md')
    expect(entryAt(root(), '/N/nope.md')).toBeNull()
    expect(entryAt(null, '/N/a.md')).toBeNull()
  })
})

describe('rows for notes the account has named and not sent yet', () => {
  test('land beside the ones already listed', () => {
    expect(shape(withComing(root(), ['/N/b.md', '/N/d.md']))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/c.md',
      '/N/b.md',
      '/N/d.md',
    ])
  })

  test('bring their folders with them, however deep', () => {
    expect(shape(withComing(root(), ['/N/Work/Q3/plan.md']))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/c.md',
      '/N/Work',
      '/N/Work/Q3',
      '/N/Work/Q3/plan.md',
    ])
  })

  test('go into a folder that is already there rather than beside it', () => {
    expect(shape(withComing(root(), ['/N/Deep/other.md']))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/Deep/other.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('a note that has landed already is left exactly as it is', () => {
    expect(shape(withComing(root(), ['/N/a.md']))).toEqual(shape(root()))
  })

  test('a path in another space is not a row in this one', () => {
    expect(shape(withComing(root(), ['/Other/a.md']))).toEqual(shape(root()))
  })

  test('nothing coming leaves the listing alone', () => {
    expect(withComing(root(), [])).toEqual(root())
  })

  test('land under a Windows folder too, named the way a row is named', () => {
    const disk = folder('C:\\Notes\\N', [file('C:\\Notes\\N\\a.md')])
    const listed = withComing(disk, ['C:\\Notes\\N\\Work\\plan.md'])

    expect(shape(listed)).toEqual([
      'C:\\Notes\\N\\a.md',
      'C:\\Notes\\N\\Work',
      'C:\\Notes\\N\\Work\\plan.md',
    ])
    expect(entryAt(listed, 'C:\\Notes\\N\\Work\\plan.md')?.name).toBe('plan.md')
    expect(entryAt(listed, 'C:\\Notes\\N\\Work')?.name).toBe('Work')
  })

  test('a folder whose name only starts the same way is not the space', () => {
    expect(shape(withComing(root(), ['/Nine/a.md']))).toEqual(shape(root()))
  })

  test('the same listing lands the same way whatever order it arrives in', () => {
    const one = withComing(root(), ['/N/z.md', '/N/Work/b.md', '/N/b.md'])
    const other = withComing(root(), ['/N/b.md', '/N/Work/b.md', '/N/z.md'])

    expect(shape(one)).toEqual(shape(other))
  })
})

describe('the two halves together', () => {
  /** What the panel actually draws: a row put on the tree here, and then the tree
   *  read in the order the space is being read in. Where the row was appended says
   *  nothing about where it appears, which is the whole point of the split. */
  test('a row appended to its folder is drawn in the chosen order', () => {
    const grown = withEntry(root(), file('/N/b.md'))

    expect(shape(orderedTree(grown, 'name', () => []))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/b.md',
      '/N/c.md',
    ])
  })

  test('and in the order somebody arranged, where they arranged one', () => {
    const grown = withEntry(root(), file('/N/b.md'))
    const drawn = orderedTree(grown, 'manual', (folder) =>
      folder === '/N' ? ['c.md', 'b.md'] : [],
    )

    expect(shape(drawn)).toEqual(['/N/Deep', '/N/Deep/inner.md', '/N/c.md', '/N/b.md', '/N/a.md'])
  })
})
