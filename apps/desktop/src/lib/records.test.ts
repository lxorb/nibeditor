import { beforeEach, describe, expect, test, vi } from 'vitest'
import { filledIn, type Folding, meet, readSpaces } from './records'

describe('a map filled in from storage that answered late', () => {
  test('takes the keys it did not have, and keeps its own for the ones it did', () => {
    const held = { a: 'written this launch' }

    expect(filledIn(held, { a: 'stale', b: 'late' })).toEqual({
      a: 'written this launch',
      b: 'late',
    })
  })

  test('is nothing at all when storage said nothing new, so nothing is reassigned', () => {
    expect(filledIn({ a: 1 }, { a: 2 })).toBeNull()
    expect(filledIn({ a: 1 }, {})).toBeNull()
  })
})

/** The part of every per-space store that is about the account: reading each space's
 *  value back with the account it was folded into, and the rule for meeting the
 *  account's copy. What each store keeps and how it folds are that store's tests. */

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

const KEY = 'nib:test'

beforeEach(() => localStorage.clear())

describe('reading every space back', () => {
  test('keeps each value as its store reads it, with the account it was folded into', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ '/a': { n: 1, account: 'acc' }, '/b': { n: 'two', account: 7 } }),
    )

    const read = readSpaces(KEY, (one) => ({ n: typeof one.n === 'number' ? one.n : 0 }))

    expect(read).toEqual({ '/a': { n: 1, account: 'acc' }, '/b': { n: 0, account: null } })
  })

  test('drops an entry that is not a record, and reads nothing out of nothing', () => {
    localStorage.setItem(KEY, JSON.stringify({ '/a': 'loose', '/b': [1], '/c': {} }))
    expect(readSpaces(KEY, () => ({}))).toEqual({ '/c': { account: null } })

    localStorage.setItem(KEY, '[1, 2]')
    expect(readSpaces(KEY, () => ({}))).toEqual({})
    expect(readSpaces('nib:never-written', () => ({}))).toEqual({})
  })
})

/** Sets of letters, folded as a union. */
const LETTERS: Folding<string[]> = {
  fold: (theirs, mine) => [...theirs, ...mine.filter((one) => !theirs.includes(one))],
  same: (one, other) => one.join() === other.join(),
}

describe("meeting the account's copy", () => {
  test('folds this machine in the first time an account sees the space, and tells it', () => {
    const held = { account: null }

    expect(meet(held, 'acc', ['a', 'b'], ['a'], LETTERS)).toEqual({
      value: ['a', 'b'],
      tell: true,
    })
  })

  test('says nothing back when the fold added nothing', () => {
    expect(meet(undefined, 'acc', [], ['a'], LETTERS)).toEqual({ value: ['a'], tell: false })
  })

  test('folds again for another account signing in on this machine', () => {
    expect(meet({ account: 'other' }, 'acc', ['b'], ['a'], LETTERS)).toEqual({
      value: ['a', 'b'],
      tell: true,
    })
  })

  test("takes the account's copy outright after that, dropping what another machine took back", () => {
    expect(meet({ account: 'acc' }, 'acc', ['a', 'b'], ['a'], LETTERS)).toEqual({
      value: ['a'],
      tell: false,
    })
  })

  test('and is nothing at all when the two already agree', () => {
    expect(meet({ account: 'acc' }, 'acc', ['a'], ['a'], LETTERS)).toBeNull()
  })

  test('folds while a push has not landed, since the account never heard it', () => {
    expect(meet({ account: 'acc', sent: false }, 'acc', ['b'], ['a'], LETTERS)).toEqual({
      value: ['a', 'b'],
      tell: true,
    })
    expect(meet({ account: 'acc', sent: true }, 'acc', ['b'], ['a'], LETTERS)).toEqual({
      value: ['a'],
      tell: false,
    })
  })
})
