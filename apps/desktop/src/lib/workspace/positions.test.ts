import { afterEach, describe, expect, test, vi } from 'vitest'
import { Positions } from './positions'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A clock that moves on with every reading, so "most recently" means
 *  something. */
function ticking() {
  let at = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => ++at)
}

describe('where a note was last looked at', () => {
  test('comes back for the note it was recorded against', () => {
    const places = new Positions()
    places.remember('/a.md', 12, 340, 5)

    expect(places.of('/a.md')).toEqual({ cursor: 12, scroll: 340, anchor: 5 })
  })

  test('is nothing at all for a note nobody has opened', () => {
    expect(new Positions().of('/never.md')).toEqual({})
  })

  test('remembers what was folded there, and hands it back', () => {
    const places = new Positions()
    places.remember('/a.md', 12, 340, 5, [
      [1, 8],
      [10, 14],
    ])

    expect(places.of('/a.md').folds).toEqual([
      [1, 8],
      [10, 14],
    ])
  })

  test('writes nothing at all where nothing is folded', () => {
    const places = new Positions()
    places.remember('/a.md', 1, 2, 0, [])

    expect(places.all['/a.md']).not.toHaveProperty('folds')
  })

  test('takes the newer reading of the same note', () => {
    const places = new Positions()
    places.remember('/a.md', 1, 1)
    places.remember('/a.md', 2, 2)

    expect(places.of('/a.md')).toMatchObject({ cursor: 2, scroll: 2 })
  })
})

describe('a note that moves', () => {
  const moved = (from: string, to: string, kind: 'file' | 'folder' = 'file') =>
    ({ op: 'moved', from, to, kind, root: '/' }) as const

  test('takes its place along and leaves none behind', () => {
    const places = new Positions()
    places.remember('/a.md', 3, 4)
    places.follow(moved('/a.md', '/f/a.md'))

    expect(places.of('/f/a.md')).toMatchObject({ cursor: 3, scroll: 4 })
    expect(places.of('/a.md')).toEqual({})
  })

  test('is left alone when there was nothing to move', () => {
    const places = new Positions()
    places.follow(moved('/a.md', '/f/a.md'))
    expect(places.all).toEqual({})
  })

  test('and every note in a folder that moves takes its own, and no note beside it', () => {
    const places = new Positions()
    places.remember('/Work/a.md', 1, 1)
    places.remember('/Work/deep/b.md', 2, 2)
    places.remember('/Workshop.md', 3, 3)
    places.follow(moved('/Work', '/Play', 'folder'))

    expect(Object.keys(places.all).sort()).toEqual([
      '/Play/a.md',
      '/Play/deep/b.md',
      '/Workshop.md',
    ])
  })
})

describe('the record as a whole', () => {
  test('stops growing, keeping the notes looked at most recently', () => {
    ticking()
    const places = new Positions()
    for (let index = 0; index < 340; index++) places.remember(`/${index}.md`, index, index)

    const kept = Object.keys(places.all)
    expect(kept).toHaveLength(300)
    expect(kept).toContain('/339.md')
    expect(kept).not.toContain('/0.md')
  })

  test('counts a note looked at again as recent', () => {
    ticking()
    const places = new Positions()
    places.remember('/old.md', 0, 0)
    for (let index = 0; index < 299; index++) places.remember(`/${index}.md`, index, index)

    // Back to it before the cap is reached, so it is no longer the oldest.
    places.remember('/old.md', 1, 1)
    places.remember('/last.md', 0, 0)

    expect(Object.keys(places.all)).toContain('/old.md')
    expect(Object.keys(places.all)).not.toContain('/0.md')
  })
})
