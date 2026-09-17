import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The chooser's memory, and the step round it.
 *
 *  Emil, 2026-09-17: *"The last chosen one should be selected already. While holding
 *  Ctrl, we can switch to the next one by pressing T."* Which is two sums and a word
 *  in storage; the hand on the keyboard is new-kind-chord.effect.test.ts. */

/** The store is read the moment it is asked, and there is none under node. */
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

const { rememberKind, standingAt, stepAt } = await import('./last-kind')

const DESKTOP = ['note', 'canvas', 'web', 'pages'] as const
const PHONE = ['note', 'canvas', 'pages'] as const

beforeEach(() => {
  localStorage.clear()
})

describe('what was chosen last', () => {
  test('is nothing until something is', () => {
    expect(standingAt(DESKTOP)).toBe(0)
  })

  test('is where the chooser opens', () => {
    rememberKind('canvas')
    expect(standingAt(DESKTOP)).toBe(1)

    rememberKind('pages')
    expect(standingAt(DESKTOP)).toBe(3)
  })

  /** A website is a bookmark on a phone and is not offered there, so a machine that
   *  made one on a desktop is not a phone that can open the chooser on it. */
  test('falls back to the first where it is not on offer', () => {
    rememberKind('web')
    expect(standingAt(PHONE)).toBe(0)
  })

  /** Storage is written by some version of this app and read by another. */
  test('and nonsense in storage is nothing chosen', () => {
    localStorage.setItem('nib:new-kind', 'hologram')
    expect(standingAt(DESKTOP)).toBe(0)
  })
})

describe('one kind along', () => {
  test('is the next of them', () => {
    expect(stepAt(0, 4)).toBe(1)
    expect(stepAt(2, 4)).toBe(3)
  })

  test('wraps at the end, which is what a switcher under a held key does', () => {
    expect(stepAt(3, 4)).toBe(0)
  })

  test('goes back under Shift, and wraps the other way', () => {
    expect(stepAt(2, 4, -1)).toBe(1)
    expect(stepAt(0, 4, -1)).toBe(3)
  })

  /** What a press that arrived before the chooser was drawn leaves owed. */
  test('takes several at once, forwards and back', () => {
    expect(stepAt(0, 4, 3)).toBe(3)
    expect(stepAt(0, 4, 5)).toBe(1)
    expect(stepAt(1, 4, -3)).toBe(2)
  })

  test('and a list with nothing in it steps nowhere', () => {
    expect(stepAt(0, 0)).toBe(0)
  })
})
