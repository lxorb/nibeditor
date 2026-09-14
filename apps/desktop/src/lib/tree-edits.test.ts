import { describe, expect, test } from 'vitest'
import type { Entry, TreeOptions } from './workspace.svelte'
import {
  entryAt,
  withComing,
  withEntry,
  withMove,
  withoutEntry,
  withoutLeftOut,
} from './tree-edits'

const BY_NAME: TreeOptions = { showHidden: false, sort: 'name', descending: false }

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
  test('lands where the listing would put it', () => {
    expect(shape(withEntry(root(), file('/N/b.md'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/b.md',
      '/N/c.md',
    ])
  })

  test('a folder goes above the notes, whatever its name', () => {
    expect(shape(withEntry(root(), folder('/N/zzz'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/zzz',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('descending order is followed too', () => {
    // The tree on show is already in the order it was listed in, so a
    // descending one is what a descending insert has to fit into.
    const down = { ...BY_NAME, descending: true }
    const listed = folder('/N', [file('/N/c.md'), file('/N/a.md')])
    expect(shape(withEntry(listed, file('/N/b.md'), down))).toEqual([
      '/N/c.md',
      '/N/b.md',
      '/N/a.md',
    ])
  })

  test('inside a folder, not at the top', () => {
    expect(shape(withEntry(root(), file('/N/Deep/also.md'), BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/also.md',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('a row that is already there is not doubled', () => {
    expect(shape(withEntry(root(), file('/N/a.md'), BY_NAME))).toEqual(shape(root()))
  })

  test('the tree it was given is left alone', () => {
    const before = root()
    withEntry(before, file('/N/b.md'), BY_NAME)
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
  test('a rename re-sorts it', () => {
    expect(shape(withMove(root(), '/N/a.md', '/N/z.md', BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/c.md',
      '/N/z.md',
    ])
  })

  test('a move into a folder takes the row there', () => {
    expect(shape(withMove(root(), '/N/c.md', '/N/Deep/c.md', BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/c.md',
      '/N/Deep/inner.md',
      '/N/a.md',
    ])
  })

  test('a folder takes its contents along, paths and all', () => {
    const moved = withMove(root(), '/N/Deep', '/N/Shallow', BY_NAME)
    expect(shape(moved)).toEqual(['/N/Shallow', '/N/Shallow/inner.md', '/N/a.md', '/N/c.md'])
    expect(entryAt(moved, '/N/Shallow/inner.md')?.name).toBe('inner.md')
  })

  test('a row that is not there changes nothing', () => {
    expect(shape(withMove(root(), '/N/missing.md', '/N/b.md', BY_NAME))).toEqual(shape(root()))
  })

  test('the new name is the one shown', () => {
    expect(entryAt(withMove(root(), '/N/a.md', '/N/z.md', BY_NAME), '/N/z.md')?.name).toBe('z.md')
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
    expect(shape(withComing(root(), ['/N/b.md', '/N/d.md'], BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/a.md',
      '/N/b.md',
      '/N/c.md',
      '/N/d.md',
    ])
  })

  test('bring their folders with them, however deep', () => {
    expect(shape(withComing(root(), ['/N/Work/Q3/plan.md'], BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/Work',
      '/N/Work/Q3',
      '/N/Work/Q3/plan.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('go into a folder that is already there rather than beside it', () => {
    expect(shape(withComing(root(), ['/N/Deep/other.md'], BY_NAME))).toEqual([
      '/N/Deep',
      '/N/Deep/inner.md',
      '/N/Deep/other.md',
      '/N/a.md',
      '/N/c.md',
    ])
  })

  test('a note that has landed already is left exactly as it is', () => {
    expect(shape(withComing(root(), ['/N/a.md'], BY_NAME))).toEqual(shape(root()))
  })

  test('a path in another space is not a row in this one', () => {
    expect(shape(withComing(root(), ['/Other/a.md'], BY_NAME))).toEqual(shape(root()))
  })

  test('nothing coming leaves the listing alone', () => {
    expect(withComing(root(), [], BY_NAME)).toEqual(root())
  })

  test('land under a Windows folder too, named the way a row is named', () => {
    const disk = folder('C:\\Notes\\N', [file('C:\\Notes\\N\\a.md')])
    const listed = withComing(disk, ['C:\\Notes\\N\\Work\\plan.md'], BY_NAME)

    expect(shape(listed)).toEqual([
      'C:\\Notes\\N\\Work',
      'C:\\Notes\\N\\Work\\plan.md',
      'C:\\Notes\\N\\a.md',
    ])
    expect(entryAt(listed, 'C:\\Notes\\N\\Work\\plan.md')?.name).toBe('plan.md')
    expect(entryAt(listed, 'C:\\Notes\\N\\Work')?.name).toBe('Work')
  })

  test('a folder whose name only starts the same way is not the space', () => {
    expect(shape(withComing(root(), ['/Nine/a.md'], BY_NAME))).toEqual(shape(root()))
  })

  test('the same listing lands the same way whatever order it arrives in', () => {
    const one = withComing(root(), ['/N/z.md', '/N/Work/b.md', '/N/b.md'], BY_NAME)
    const other = withComing(root(), ['/N/b.md', '/N/Work/b.md', '/N/z.md'], BY_NAME)

    expect(shape(one)).toEqual(shape(other))
  })
})

/** The rows the space is not showing, taken out of the tree once.
 *
 *  One filter for the whole file list. The panel mounts a slice of the rows and the arrow
 *  keys walk all of them, counting from the same list: a row hidden from one and not the
 *  other is Down landing on nothing. So the tree they are both drawn from is the filtered
 *  one; see `shownTree` in workspace.svelte.ts and docs/archive.md. */
describe('the rows the space is not showing', () => {
  test('are gone from the tree', () => {
    const kept = withoutLeftOut(root(), (path) => path === '/N/a.md')

    expect(shape(kept ?? root())).toEqual(['/N/Deep', '/N/Deep/inner.md', '/N/c.md'])
  })

  test('and a folder that is left out goes with everything under it', () => {
    const kept = withoutLeftOut(root(), (path) => path === '/N/Deep')

    expect(shape(kept ?? root())).toEqual(['/N/a.md', '/N/c.md'])
  })

  test('a row nested deep is taken out on its own', () => {
    const kept = withoutLeftOut(root(), (path) => path === '/N/Deep/inner.md')

    expect(shape(kept ?? root())).toEqual(['/N/Deep', '/N/a.md', '/N/c.md'])
  })

  test('the space’s own folder is never one of them', () => {
    // The space is the list, not a row in it: a predicate that says yes to everything still
    // leaves a tree to draw, empty.
    const kept = withoutLeftOut(root(), () => true)

    expect(kept?.path).toBe('/N')
    expect(shape(kept ?? root())).toEqual([])
  })

  test('and a tree with nothing left out is the same tree, not a copy of it', () => {
    // A space with nothing archived in it must not be rebuilt on every keystroke.
    const tree = root()

    expect(withoutLeftOut(tree, () => false)).toBe(tree)
  })

  test('filtering never changes the tree it was given', () => {
    const tree = root()
    withoutLeftOut(tree, (path) => path === '/N/a.md')

    expect(shape(tree)).toEqual(['/N/Deep', '/N/Deep/inner.md', '/N/a.md', '/N/c.md'])
  })

  test('and no tree at all is no tree', () => {
    expect(withoutLeftOut(null, () => true)).toBeNull()
  })
})
