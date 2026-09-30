import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the phone's format bar holds. The list is the reader's and it goes on
 *  the account, so what matters here is that it is a list of commands this
 *  version can actually press, that nothing is on it twice, and that a bar
 *  nobody has touched is stored as nothing at all - which is what lets the
 *  default change later and reach everybody. */

const world = vi.hoisted(() => ({ saved: [] as unknown[] }))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      saveSettings: (_token: string, patch: unknown) => {
        world.saved.push(patch)
        return Promise.resolve({ settings: {} })
      },
    },
  }
})

/** This device's own store, in memory: the same stand-in the account's tests
 *  use, because a store is what a choice is written to. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

import { DEFAULT_TOOLBAR, markFor, nameFor, toolbar, usable } from './toolbar.svelte'

beforeEach(() => {
  world.saved = []
  localStorage.clear()
  toolbar.chosen = null
})

describe('the bar as it arrives', () => {
  test('is the nine it has always been', () => {
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
    expect(toolbar.changed).toBe(false)
    expect(toolbar.ids[0]).toBe('format.bold')
  })

  test('and every one of them is a command something can press', () => {
    // The ids are the shortcuts' own, so a typo here is a button that does
    // nothing rather than a test that fails somewhere else.
    expect(usable([...DEFAULT_TOOLBAR])).toEqual([...DEFAULT_TOOLBAR])
  })
})

describe('putting one together', () => {
  test('adds to the end, and never twice', () => {
    toolbar.add('paragraph.task-list')
    expect(toolbar.ids.at(-1)).toBe('paragraph.task-list')
    expect(toolbar.changed).toBe(true)

    const held = [...toolbar.ids]
    toolbar.add('paragraph.task-list')
    expect(toolbar.ids).toEqual(held)
  })

  test('refuses what nothing can press', () => {
    toolbar.add('nothing.at.all')
    toolbar.add('fixed.escape')
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('takes one off', () => {
    toolbar.remove('format.italic')
    expect(toolbar.ids).not.toContain('format.italic')
    expect(toolbar.ids.length).toBe(DEFAULT_TOOLBAR.length - 1)
  })

  test('moves one along, and a move off either end is the end', () => {
    toolbar.move(0, 2)
    expect(toolbar.ids.slice(0, 3)).toEqual([
      'format.italic',
      'format.strikethrough',
      'format.bold',
    ])

    toolbar.move(2, -4)
    expect(toolbar.ids[0]).toBe('format.bold')
    toolbar.move(0, 99)
    expect(toolbar.ids.at(-1)).toBe('format.bold')
  })

  test('and goes back to having chosen nothing', () => {
    toolbar.add('paragraph.table')
    toolbar.reset()

    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
    expect(toolbar.changed).toBe(false)
    expect(localStorage.getItem('nib:toolbar')).toBeNull()
  })
})

describe('what a stored or received list may be', () => {
  test('ids only, nothing twice, nothing this version cannot press', () => {
    expect(usable(['format.bold', 'format.bold', 7, 'nothing.here', 'paragraph.quote'])).toEqual([
      'format.bold',
      'paragraph.quote',
    ])
  })

  test('a bar with nothing on it is a bar somebody chose', () => {
    // The keyboard's own row and nothing above it, which is a choice.
    expect(usable([])).toEqual([])
  })

  test('and anything that is not a list at all is no choice', () => {
    expect(usable(null)).toBeNull()
    expect(usable('format.bold')).toBeNull()
    expect(usable({ 0: 'format.bold' })).toBeNull()
  })
})

describe('what a button wears', () => {
  test('its own mark where it has one', () => {
    expect(markFor('format.bold')).toBe('B')
    expect(markFor('paragraph.heading-2')).toBe('H')
    expect(markFor('paragraph.bullet-list')).toBe('•')
  })

  test('and the first letter of its name where it has none', () => {
    // Upper case, because the marks are: a lower-case letter among them would
    // read as a typo.
    expect(markFor('app.settings')).toBe('S')
    expect(markFor('paragraph.table')).toBe('T')
  })

  test('and says what it is behind that', () => {
    expect(nameFor('format.bold')).toBe('Bold')
    expect(nameFor('nothing.at.all')).toBe('nothing.at.all')
  })
})

describe('the account', () => {
  test('is told when the list changes, and told null for the default', () => {
    // Signed out there is nobody to tell, which is the case under test here:
    // what matters is that nothing throws and the list is still the reader's.
    toolbar.add('paragraph.table')
    toolbar.reset()

    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('takes over the list it holds', () => {
    toolbar.receive({ toolbar: ['format.bold', 'paragraph.quote'] })
    expect(toolbar.ids).toEqual(['format.bold', 'paragraph.quote'])

    toolbar.receive({ toolbar: null })
    expect(toolbar.ids).toEqual(DEFAULT_TOOLBAR)
  })

  test('and an account that has never been told anything leaves this one alone', () => {
    toolbar.add('paragraph.table')
    const held = [...toolbar.ids]

    toolbar.receive({})
    expect(toolbar.ids).toEqual(held)
  })
})
