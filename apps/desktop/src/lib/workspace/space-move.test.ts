import { describe, expect, test } from 'vitest'
import { carried, spaceOfTab, spacesFor } from './space-move'

/** Move to space, decided: what a move takes with the tab, and where a tab may go. */

const spaces = [
  { id: 'work', name: 'Work', root: '/spaces/Work' },
  { id: 'home', name: 'Home', root: '/spaces/Home' },
  { id: 'uni', name: 'Uni', root: '/spaces/Uni' },
]
const where = { spaces, activeSpaceId: 'work' }
const anywhere = () => true

const note = { path: '/spaces/Work/Plan.md', home: null, shared: null }
const draft = { path: null, home: 'work', shared: null }
const terminal = { path: null, home: 'home', shared: null }
const css = { path: '/app/custom.css', home: null, shared: null }
const sharedNote = { path: null, home: null, shared: 'n-1' }

describe('what moves with the tab', () => {
  test('a file in a space moves with it', () => {
    expect(carried(note, spaces)).toBe('file')
    expect(carried({ ...note, path: '/spaces/Work/Reading/Paper.pdf' }, spaces)).toBe('file')
  })

  test('a tab with no file takes the space as its home', () => {
    expect(carried(draft, spaces)).toBe('home')
    expect(carried(terminal, spaces)).toBe('home')
  })

  test('a file in no space, and a note shared on its own, move as the tab alone', () => {
    expect(carried(css, spaces)).toBe('tab')
    expect(carried(sharedNote, spaces)).toBe('tab')
  })
})

describe('the space a tab is in', () => {
  test('the one holding its file, else its home, else the one on screen', () => {
    expect(spaceOfTab(note, spaces, 'uni')).toBe('work')
    expect(spaceOfTab(terminal, spaces, 'uni')).toBe('home')
    expect(spaceOfTab(css, spaces, 'uni')).toBe('uni')
    expect(spaceOfTab(sharedNote, spaces, 'uni')).toBe('uni')
  })
})

describe('where a tab may go', () => {
  test('every other space, in the switcher’s order', () => {
    expect(spacesFor([note], where, anywhere).map((one) => one.id)).toEqual(['home', 'uni'])
    expect(spacesFor([terminal], where, anywhere).map((one) => one.id)).toEqual(['work', 'uni'])
  })

  test('tabs from two spaces may go to either', () => {
    expect(spacesFor([note, terminal], where, anywhere).map((one) => one.id)).toEqual([
      'work',
      'home',
      'uni',
    ])
  })

  test('nowhere with one space, or no tab', () => {
    expect(
      spacesFor([note], { spaces: spaces.slice(0, 1), activeSpaceId: 'work' }, anywhere),
    ).toEqual([])
    expect(spacesFor([], where, anywhere)).toEqual([])
  })

  test('never into a space that may not be written in', () => {
    const readOnly = (path: string) => !path.startsWith('/spaces/Uni')
    expect(spacesFor([draft], where, readOnly).map((one) => one.id)).toEqual(['home'])
  })

  test('and a file is not taken out of a space it may not be written in', () => {
    const readOnly = (path: string) => !path.startsWith('/spaces/Work')
    expect(spacesFor([note], where, readOnly)).toEqual([])
    // A terminal opened there has nothing in the space to take.
    expect(spacesFor([{ ...draft, home: 'work' }], where, readOnly).map((one) => one.id)).toEqual([
      'home',
      'uni',
    ])
  })
})
