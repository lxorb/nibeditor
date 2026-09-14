import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Arranged, arrangedMap, MOST_ARRANGED, MOST_NAMES, STORAGE_KEY } from './arranged.svelte'

/** The order somebody arranged a folder's rows into.
 *
 *  Kept beside the space rather than in a file inside it, which buys the same one
 *  obligation the folder icons buy: a row that is renamed, moved or deleted has to
 *  say so, or the list quietly names files that are not there. That is most of what
 *  is tested here, along with the one thing the icons never had to answer - the top
 *  of the space is a folder too, and its key is the empty one.
 *
 *  Nothing is pushed anywhere under node: the push imports the account and the
 *  syncing loop, both of which answer with nothing signed out. It waits for the
 *  dragging to stop, so the clock is held here rather than left to fire after this
 *  file has finished. */

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

let arranged: Arranged

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  arranged = new Arranged(() => ROOT)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('what a folder keeps', () => {
  test('is kept under the folder s path as the space speaks it', () => {
    arranged.set('/space/Work', ['b.md', 'a.md'])

    expect(arranged.of(ROOT)).toEqual({ Work: ['b.md', 'a.md'] })
    expect(arranged.listOf('/space/Work')).toEqual(['b.md', 'a.md'])
  })

  test('the top of the space is a folder too, under the empty key', () => {
    arranged.set(ROOT, ['z.md', 'a.md'])

    expect(arranged.of(ROOT)).toEqual({ '': ['z.md', 'a.md'] })
    expect(arranged.listOf(ROOT)).toEqual(['z.md', 'a.md'])
  })

  test('is nothing for a folder nobody arranged, which reads in name order', () => {
    expect(arranged.listOf('/space/Work')).toEqual([])
  })

  test('and an order dragged back to name order takes the key with it', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.set('/space/Work', [])

    expect(arranged.of(ROOT)).toEqual({})
  })

  test('holds a name once, however many times it was written', () => {
    arranged.set('/space/Work', ['a.md', 'a.md', 'b.md'])

    expect(arranged.listOf('/space/Work')).toEqual(['a.md', 'b.md'])
  })

  test('drops a name that is a path rather than a name', () => {
    arranged.set('/space/Work', ['../out.md', 'deep/in.md', 'a.md'])

    expect(arranged.listOf('/space/Work')).toEqual(['a.md'])
  })

  test('refuses a folder outside its own space', () => {
    arranged.set('/elsewhere/Work', ['a.md'])

    expect(arranged.of(ROOT)).toEqual({})
  })
})

describe('a drag that has not been dropped yet', () => {
  test('is the order the list is drawn in while it is showing', () => {
    arranged.show('/space/Work', ['c.md', 'a.md'])

    expect(arranged.listOf('/space/Work')).toEqual(['c.md', 'a.md'])
    expect(arranged.dragging).toBe(true)
    // Nothing is written until it lands.
    expect(arranged.of(ROOT)).toEqual({})
  })

  test('leaves every other folder alone', () => {
    arranged.set('/space/Other', ['b.md'])
    arranged.show('/space/Work', ['c.md'])

    expect(arranged.listOf('/space/Other')).toEqual(['b.md'])
  })

  test('slides back where the drag ends nowhere', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.show('/space/Work', ['c.md', 'b.md'])
    arranged.unshow()

    expect(arranged.listOf('/space/Work')).toEqual(['b.md'])
    expect(arranged.dragging).toBe(false)
  })

  test('is what the folder keeps once it lands', () => {
    arranged.show('/space/Work', ['c.md', 'a.md'])
    arranged.drop()

    expect(arranged.of(ROOT)).toEqual({ Work: ['c.md', 'a.md'] })
    expect(arranged.dragging).toBe(false)
  })

  test('a drop with nothing showing writes nothing', () => {
    arranged.drop()

    expect(arranged.of(ROOT)).toEqual({})
  })
})

describe('a row that has been renamed', () => {
  test('keeps the place it was arranged into', () => {
    arranged.set('/space/Work', ['c.md', 'a.md'])
    arranged.moved('/space/Work/c.md', '/space/Work/zebra.md')

    expect(arranged.listOf('/space/Work')).toEqual(['zebra.md', 'a.md'])
  })

  test('at the top of the space as well as inside a folder', () => {
    arranged.set(ROOT, ['c.md', 'a.md'])
    arranged.moved('/space/c.md', '/space/zebra.md')

    expect(arranged.listOf(ROOT)).toEqual(['zebra.md', 'a.md'])
  })

  test('costs nothing where the folder it sits in arranged nothing', () => {
    arranged.moved('/space/Work/c.md', '/space/Work/zebra.md')

    expect(arranged.of(ROOT)).toEqual({})
  })
})

describe('a row that has moved to another folder', () => {
  test('leaves the list it was in', () => {
    arranged.set(ROOT, ['c.md', 'a.md'])
    arranged.moved('/space/c.md', '/space/Work/c.md')

    expect(arranged.listOf(ROOT)).toEqual(['a.md'])
  })

  test('and falls to the end of the one it arrives in, which is no list at all', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.moved('/space/c.md', '/space/Work/c.md')

    expect(arranged.listOf('/space/Work')).toEqual(['b.md'])
  })
})

describe('a folder that has moved', () => {
  test('takes its own list and every list under it along', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.set('/space/Work/Deep', ['inner.md'])
    arranged.moved('/space/Work', '/space/Archive')

    expect(arranged.of(ROOT)).toEqual({ Archive: ['b.md'], 'Archive/Deep': ['inner.md'] })
  })

  test('and is renamed in the list of the folder that holds it', () => {
    arranged.set(ROOT, ['Work', 'Alpha'])
    arranged.moved('/space/Work', '/space/Archive')

    expect(arranged.listOf(ROOT)).toEqual(['Archive', 'Alpha'])
  })
})

describe('a row that has gone', () => {
  test('leaves the list of the folder it sat in', () => {
    arranged.set('/space/Work', ['c.md', 'a.md'])
    arranged.gone('/space/Work/c.md')

    expect(arranged.listOf('/space/Work')).toEqual(['a.md'])
  })

  test('and a folder takes every list under it with it', () => {
    arranged.set(ROOT, ['Work'])
    arranged.set('/space/Work', ['b.md'])
    arranged.set('/space/Work/Deep', ['inner.md'])
    arranged.gone('/space/Work')

    expect(arranged.of(ROOT)).toEqual({})
  })

  test('a row nothing arranged is nothing to forget', () => {
    arranged.set('/space/Work', ['c.md'])
    arranged.gone('/space/Work/a.md')

    expect(arranged.of(ROOT)).toEqual({ Work: ['c.md'] })
  })
})

describe('a space that moved or went', () => {
  test('a renamed space folder re-keys the whole map', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.spaceMoved(ROOT, '/elsewhere')

    expect(arranged.of('/elsewhere')).toEqual({ Work: ['b.md'] })
    expect(arranged.of(ROOT)).toEqual({})
  })

  test('a space that is no longer here is forgotten', () => {
    arranged.set('/space/Work', ['b.md'])
    arranged.forget(ROOT)

    expect(arranged.of(ROOT)).toEqual({})
  })
})

describe('what survives a relaunch', () => {
  test('the map is read back as it was written', () => {
    arranged.set('/space/Work', ['c.md', 'a.md'])
    arranged.set(ROOT, ['Work'])

    const again = new Arranged(() => ROOT)
    expect(again.of(ROOT)).toEqual({ Work: ['c.md', 'a.md'], '': ['Work'] })
  })

  test('an order showing under a drag is not written down', () => {
    arranged.show('/space/Work', ['c.md'])

    expect(new Arranged(() => ROOT).of(ROOT)).toEqual({})
  })

  test('nonsense in storage reads as nothing arranged', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json')

    expect(new Arranged(() => ROOT).of(ROOT)).toEqual({})
  })
})

describe('the account s copy', () => {
  test('is folded into this machine s the first time the account sees the space', async () => {
    arranged.set('/space/Work', ['b.md'])
    await arranged.adopt(ROOT, { Other: ['z.md'] }, 'account-1')

    expect(arranged.of(ROOT)).toEqual({ Work: ['b.md'], Other: ['z.md'] })
  })

  test('and this machine s wins for a folder both of them arranged', async () => {
    arranged.set('/space/Work', ['b.md'])
    await arranged.adopt(ROOT, { Work: ['z.md'] }, 'account-1')

    expect(arranged.listOf('/space/Work')).toEqual(['b.md'])
  })

  test('is taken outright on every pass after the first', async () => {
    await arranged.adopt(ROOT, { Work: ['b.md'] }, 'account-1')
    await arranged.adopt(ROOT, {}, 'account-1')

    expect(arranged.of(ROOT)).toEqual({})
  })

  test('a different account signing in folds again', async () => {
    await arranged.adopt(ROOT, { Work: ['b.md'] }, 'account-1')
    await arranged.adopt(ROOT, { Other: ['z.md'] }, 'account-2')

    expect(arranged.of(ROOT)).toEqual({ Work: ['b.md'], Other: ['z.md'] })
  })

  test('nothing at all from a service that has never heard of the column', async () => {
    arranged.set('/space/Work', ['b.md'])
    await arranged.adopt(ROOT, undefined, 'account-1')

    expect(arranged.of(ROOT)).toEqual({ Work: ['b.md'] })
  })
})

describe('reading a map out of an unknown', () => {
  test('keeps what reads as a folder with names in it', () => {
    expect(arrangedMap({ Work: ['b.md'], '': ['a.md'] })).toEqual({
      Work: ['b.md'],
      '': ['a.md'],
    })
  })

  test('drops a folder whose value is not a list of names', () => {
    expect(arrangedMap({ Work: 'b.md', Other: [1, 2], Third: ['a.md'] })).toEqual({
      Third: ['a.md'],
    })
  })

  test('drops a key that is not a path inside the space', () => {
    expect(arrangedMap({ '/etc': ['a.md'], '../up': ['a.md'], 'C:/x': ['a.md'] })).toEqual({})
  })

  test('holds no more folders than a space may', () => {
    const many: Record<string, string[]> = {}
    for (let at = 0; at < MOST_ARRANGED + 20; at++) many[`Folder ${at}`] = ['a.md']

    expect(Object.keys(arrangedMap(many))).toHaveLength(MOST_ARRANGED)
  })

  test('holds no more names in one folder than a folder may', () => {
    const names = Array.from({ length: MOST_NAMES + 20 }, (_unused, at) => `note ${at}.md`)

    expect(arrangedMap({ Work: names }).Work).toHaveLength(MOST_NAMES)
  })

  test('nothing at all for what is not a map', () => {
    expect(arrangedMap(null)).toEqual({})
    expect(arrangedMap(['a.md'])).toEqual({})
  })
})
