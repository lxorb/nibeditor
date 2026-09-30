import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The space a random note is chosen from, stood in for: which notes it lists,
 *  which is open, and what it leaves out. The real store reads a disk and an
 *  account, and what is under test here is only the choosing. */
const space = {
  notes: [] as { path: string }[],
  active: null as { path: string | null } | null,
  excluded: new Set<string>(),
  archived: new Set<string>(),
  opened: [] as string[],
}

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get notes() {
      return space.notes
    },
    get active() {
      return space.active
    },
    excluded: { has: (path: string) => space.excluded.has(path) },
    archive: { has: (path: string) => space.archived.has(path) },
    open: (path: string) => {
      space.opened.push(path)
      return Promise.resolve()
    },
  },
}))

const { openRandomNote, pickOne, randomChoices } = await import('./random-note')

const ROOT = '/spaces/Work'
const at = (name: string) => `${ROOT}/${name}`

beforeEach(() => {
  space.notes = ['Plan.md', 'Ideas.md', 'Old.md', 'Hidden.md', 'Paper.pdf', 'Board.canvas'].map(
    (name) => ({ path: at(name) }),
  )
  space.active = { path: at('Plan.md') }
  space.excluded = new Set([at('Hidden.md')])
  space.archived = new Set([at('Old.md')])
  space.opened = []
})

describe('choosing one', () => {
  test('evenly, across the whole of what there is', () => {
    const choices = ['a', 'b', 'c', 'd']

    expect(pickOne(choices, 0)).toBe('a')
    expect(pickOne(choices, 0.25)).toBe('b')
    expect(pickOne(choices, 0.5)).toBe('c')
    expect(pickOne(choices, 0.999999)).toBe('d')
  })

  test('nothing, from nothing', () => {
    expect(pickOne([], 0.5)).toBeNull()
  })
})

describe('a random note of the space', () => {
  test('is never the open note, a file that is not a note, or one left out', () => {
    // Plan is open, Hidden is excluded, Old is archived, and the PDF and the plane
    // are files beside the notes.
    expect(randomChoices()).toEqual([at('Ideas.md')])
  })

  test('opens the note it chose', () => {
    space.excluded = new Set()
    space.archived = new Set()

    openRandomNote(0)
    openRandomNote(0.99)

    expect(space.opened).toEqual([at('Ideas.md'), at('Hidden.md')])
  })

  test('opens nothing where there is nothing else to open', () => {
    space.notes = [{ path: at('Plan.md') }]

    expect(randomChoices()).toEqual([])
    openRandomNote(0.5)
    expect(space.opened).toEqual([])
  })

  test('with nothing open, every note is a choice', () => {
    space.active = null
    space.excluded = new Set()
    space.archived = new Set()

    expect(randomChoices()).toEqual(['Plan.md', 'Ideas.md', 'Old.md', 'Hidden.md'].map(at))
  })
})
