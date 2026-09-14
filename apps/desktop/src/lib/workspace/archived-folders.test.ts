import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ArchivedFolders,
  archivedFolderMap,
  MOST_ARCHIVED_FOLDERS,
  STORAGE_KEY,
} from './archived-folders.svelte'

/** The folders of a space that have been put away, where those folders have no note.
 *
 *  A map kept beside the space, so the same obligations the folder icons have: read what
 *  storage answers rather than trust it, re-key when a folder moves, forget a key that has
 *  gone, and let the account's copy win after first contact. A folder standing for
 *  everything under it is the rule most of these are about.
 *
 *  Nothing is pushed anywhere under node: the push imports the account and the syncing
 *  loop, both of which answer with nothing signed out. */

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

const ROOT = '/space'
const at = (relative: string) => `${ROOT}/${relative}`
const WHEN = '2026-09-14T10:00:00.000Z'

let archived: ArchivedFolders

beforeEach(() => {
  localStorage.clear()
  archived = new ArchivedFolders(() => ROOT)
})

describe('putting a folder away', () => {
  test('is kept as the space speaks of it, not as this disk does', () => {
    archived.set(at('2019'), WHEN)

    expect(archived.of(ROOT)).toEqual({ '2019': WHEN })
  })

  test('and is asked by either path', () => {
    archived.set(at('2019'), WHEN)

    expect(archived.archivedAt(at('2019'))).toBe(WHEN)
    expect(archived.archivedAt('2019')).toBe(WHEN)
  })

  test('is named by the folder itself, not by what is inside it', () => {
    archived.set(at('2019'), WHEN)

    expect(archived.archivedAt(at('2019'))).toBe(WHEN)
    expect(archived.archivedAt(at('2019/March'))).toBeNull()
  })

  test('and taking it back leaves nothing behind', () => {
    archived.set(at('2019'), WHEN)
    archived.set(at('2019'), null)

    expect(archived.of(ROOT)).toEqual({})
    expect(archived.here).toEqual([])
  })

  test('a folder outside its space is not kept at all', () => {
    archived.set('/elsewhere/2019', WHEN)

    expect(archived.of(ROOT)).toEqual({})
  })

  test('and a folder inside one already away says nothing more', () => {
    // The outer folder already hides it, and two keys for one hidden branch is one of them
    // going stale.
    archived.set(at('2019'), WHEN)
    archived.set(at('2019/March'), '2026-09-15T10:00:00.000Z')

    expect(archived.here).toEqual(['2019'])
  })

  test('while a folder above one takes over from it', () => {
    archived.set(at('2019/March'), WHEN)
    archived.set(at('2019'), '2026-09-15T10:00:00.000Z')

    expect(archived.here).toEqual(['2019'])
  })

  test('and only so many folders of one space', () => {
    for (let one = 0; one < MOST_ARCHIVED_FOLDERS + 20; one++) archived.set(at(`f${one}`), WHEN)

    expect(Object.keys(archived.of(ROOT))).toHaveLength(MOST_ARCHIVED_FOLDERS)
  })

  test('though one already there may still be changed at the ceiling', () => {
    for (let one = 0; one < MOST_ARCHIVED_FOLDERS; one++) archived.set(at(`f${one}`), WHEN)
    archived.set(at('f0'), null)

    expect(Object.keys(archived.of(ROOT))).toHaveLength(MOST_ARCHIVED_FOLDERS - 1)
  })
})

describe('a folder that moved', () => {
  test('takes its key with it, and everything under it', () => {
    archived.set(at('2019'), WHEN)
    archived.set(at('Other'), WHEN)
    archived.moved(at('2019'), at('Old/2019'))

    expect(archived.here.sort()).toEqual(['Old/2019', 'Other'])
  })

  test('and a folder inside one that moved is re-keyed too', () => {
    archived.set(at('a/b/c'), WHEN)
    archived.moved(at('a'), at('z'))

    expect(archived.here).toEqual(['z/b/c'])
  })

  test('a move that changes nothing writes nothing', () => {
    archived.set(at('2019'), WHEN)
    archived.moved(at('Elsewhere'), at('Somewhere'))

    expect(archived.here).toEqual(['2019'])
  })
})

describe('a folder that has gone', () => {
  test('is forgotten, with everything under it', () => {
    // A folder that is away cannot be deleted - that is the promise - so this is for the
    // folder above one, and for a space whose files somebody moved from under the app.
    archived.set(at('Old/2019'), WHEN)
    archived.set(at('Other'), WHEN)
    archived.gone(at('Old'))

    expect(archived.here).toEqual(['Other'])
  })
})

describe('a space', () => {
  test('that was renamed keeps its map, under the new root', () => {
    archived.set(at('2019'), WHEN)
    archived.spaceMoved(ROOT, '/renamed')

    expect(archived.of('/renamed')).toEqual({ '2019': WHEN })
    expect(archived.of(ROOT)).toEqual({})
  })

  test('that is no longer here is forgotten', () => {
    archived.set(at('2019'), WHEN)
    archived.forget(ROOT)

    expect(archived.of(ROOT)).toEqual({})
  })
})

describe('reading the map back', () => {
  test('keeps what reads as a folder and a date, and drops the rest', () => {
    expect(
      archivedFolderMap({
        '2019': WHEN,
        '/absolute': WHEN,
        'no value': 42,
        blank: '   ',
        long: 'x'.repeat(200),
      }),
    ).toEqual({ '2019': WHEN })
  })

  test('and anything that is not a map at all is no map', () => {
    expect(archivedFolderMap(null)).toEqual({})
    expect(archivedFolderMap(['2019'])).toEqual({})
    expect(archivedFolderMap('2019')).toEqual({})
  })

  test('survives being written and read again', () => {
    archived.set(at('2019'), WHEN)

    expect(new ArchivedFolders(() => ROOT).of(ROOT)).toEqual({ '2019': WHEN })
  })

  test('and a storage key holding rubbish is an empty map rather than a crash', () => {
    localStorage.setItem(STORAGE_KEY, 'not json')

    expect(new ArchivedFolders(() => ROOT).of(ROOT)).toEqual({})
  })
})

describe('the account’s copy', () => {
  test('is folded into this machine’s the first time it is seen', () => {
    archived.set(at('mine'), WHEN)
    archived.adopt(ROOT, { theirs: WHEN }, 'account-1')

    expect(archived.here.sort()).toEqual(['mine', 'theirs'])
  })

  test('and wins outright on every pass after that', () => {
    // A union run on every pass would put back a folder another machine had deliberately
    // taken out. Exactly what the excluded list does, and for the same reason.
    archived.adopt(ROOT, { theirs: WHEN }, 'account-1')
    archived.set(at('mine'), WHEN)
    archived.adopt(ROOT, { theirs: WHEN }, 'account-1')

    expect(archived.here).toEqual(['theirs'])
  })

  test('a different account signing in folds again', () => {
    // First contact with an account is a fold, whichever account it is: what this machine
    // holds has not been said to that one yet, so it cannot be the one copy of it.
    archived.adopt(ROOT, { theirs: WHEN }, 'account-1')
    archived.set(at('mine'), WHEN)
    archived.adopt(ROOT, {}, 'account-2')

    expect(archived.here.sort()).toEqual(['mine', 'theirs'])
  })

  test('and a service that answers with nothing takes nothing away', () => {
    archived.set(at('mine'), WHEN)
    archived.adopt(ROOT, undefined, 'account-1')

    expect(archived.here).toEqual(['mine'])
  })
})

describe('storage that answers late', () => {
  test('is read again without losing what this launch wrote', () => {
    archived.set(at('mine'), WHEN)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '/other': { folders: { theirs: WHEN }, account: null } }),
    )
    archived.reread()

    expect(archived.here).toEqual(['mine'])
    expect(archived.of('/other')).toEqual({ theirs: WHEN })
  })
})
