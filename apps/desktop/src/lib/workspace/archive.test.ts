import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Archive, archiveMap, coveredBy, MOST_ARCHIVED, STORAGE_KEY } from './archive.svelte'
import { changed, merged, REMEMBERED, sameMap, stampAfter, trimmed } from './archive-map'

/** What each space has put away.
 *
 *  A map beside the space, so the obligations every such store has - read what
 *  storage answers rather than trust it, follow a row that moves - and the two that
 *  are the archive's own: a folder hides everything under it, and two machines'
 *  copies meet entry by entry with the later moment winning, so neither loses what
 *  the other did. Nothing is pushed under node; the timers are fake so nothing tries. */

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

let archive: Archive

/** A change made at a moment of this test's choosing. */
async function changeAt(put: string[], back: string[], now: number) {
  vi.setSystemTime(now)
  await archive.change(ROOT, put, back)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  localStorage.clear()
  archive = new Archive(() => ROOT)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('putting a row away', () => {
  test('keeps it as the space speaks of it, with the moment it went', async () => {
    await changeAt(['Plan.md'], [], 1000)

    expect(archive.of(ROOT)).toEqual({ 'Plan.md': 1000 })
    expect([...archive.keysOf(ROOT)]).toEqual(['Plan.md'])
  })

  test('is asked by either spelling of the path', async () => {
    await changeAt(['Plan.md'], [], 1000)

    expect(archive.has(at('Plan.md'))).toBe(true)
    expect(archive.has('Plan.md')).toBe(true)
    expect(archive.has(at('Other.md'))).toBe(false)
  })

  test('and a folder hides everything under it, but not a neighbour sharing its name', async () => {
    await changeAt(['Old'], [], 1000)

    expect(archive.has(at('Old/2019/Taxes.md'))).toBe(true)
    expect(archive.coverIn(ROOT, at('Old/2019/Taxes.md'))).toBe('Old')
    expect(archive.has(at('Older.md'))).toBe(false)
  })

  test('is written down, and read back by a store made later', async () => {
    await changeAt(['Plan.md'], [], 1000)

    expect(localStorage.getItem(STORAGE_KEY)).toContain('Plan.md')
    expect(new Archive(() => ROOT).has(at('Plan.md'))).toBe(true)
  })

  test('knows whether a folder holds something archived, which is what deleting asks', async () => {
    await changeAt(['Work/Old/Plan.md'], [], 1000)

    expect(archive.holdsIn(ROOT, at('Work'))).toBe(true)
    expect(archive.holdsIn(ROOT, at('Work/Old/Plan.md'))).toBe(true)
    expect(archive.holdsIn(ROOT, at('Work/New'))).toBe(false)
  })
})

describe('taking it back', () => {
  test('keeps the restore, later than the archive, so another machine hears it', async () => {
    await changeAt(['Plan.md'], [], 1000)
    await changeAt([], ['Plan.md'], 2000)

    expect(archive.has(at('Plan.md'))).toBe(false)
    expect(archive.of(ROOT)).toEqual({ 'Plan.md': -2000 })
    expect(archive.any).toBe(false)
  })

  test('always lands later than what it changes, whatever this clock says', async () => {
    await changeAt(['Plan.md'], [], 5000)
    await changeAt([], ['Plan.md'], 1000)

    expect(archive.of(ROOT)['Plan.md']).toBe(-5001)
  })

  test('of something that was never archived changes nothing', async () => {
    await changeAt([], ['Plan.md'], 1000)

    expect(archive.of(ROOT)).toEqual({})
  })
})

describe('a row that moves', () => {
  test('carries the archive to its new path, and takes it back at the old one', async () => {
    await changeAt(['Old'], [], 1000)
    vi.setSystemTime(3000)
    archive.moved(at('Old'), at('Older'))
    await vi.dynamicImportSettled()

    expect(archive.has(at('Older/Plan.md'))).toBe(true)
    expect(archive.has(at('Old/Plan.md'))).toBe(false)
    expect(archive.of(ROOT)).toEqual({ Older: 3000, Old: -3000 })
  })

  test('and everything archived inside a folder that moves goes with it', async () => {
    await changeAt(['Work/Old/Plan.md'], [], 1000)
    archive.moved(at('Work'), at('Jobs'))
    await vi.dynamicImportSettled()

    expect(archive.has(at('Jobs/Old/Plan.md'))).toBe(true)
  })

  test('a space renamed takes its archive along', async () => {
    await changeAt(['Plan.md'], [], 1000)
    archive.spaceMoved(ROOT, '/renamed')

    expect(archive.of('/renamed')).toEqual({ 'Plan.md': 1000 })
    expect(archive.of(ROOT)).toEqual({})
  })

  test('and a space that has gone is forgotten', async () => {
    await changeAt(['Plan.md'], [], 1000)
    archive.forget(ROOT)

    expect(archive.of(ROOT)).toEqual({})
  })
})

describe('the account', () => {
  test('meets this machine entry by entry, so both sides keep what they did', async () => {
    await changeAt(['Mine.md'], [], 1000)
    await archive.adopt(ROOT, { 'Theirs.md': 2000 }, 'account')

    expect(archive.of(ROOT)).toEqual({ 'Mine.md': 1000, 'Theirs.md': 2000 })
  })

  test('and a restore made later on another machine wins over this archive', async () => {
    await changeAt(['Plan.md'], [], 1000)
    await archive.adopt(ROOT, { 'Plan.md': -2000 }, 'account')

    expect(archive.has(at('Plan.md'))).toBe(false)
  })

  test('but not one made earlier', async () => {
    await changeAt(['Plan.md'], [], 3000)
    await archive.adopt(ROOT, { 'Plan.md': -2000 }, 'account')

    expect(archive.has(at('Plan.md'))).toBe(true)
  })

  test('is read rather than trusted', async () => {
    await archive.adopt(ROOT, 'not a map', 'account')
    await archive.adopt(ROOT, { '../outside': 5, 'Plan.md': 'soon' }, 'account')

    expect(archive.of(ROOT)).toEqual({})
  })
})

describe('the map', () => {
  test('keeps paths inside the space with whole moments, and nothing else', () => {
    expect(
      archiveMap({
        'Plan.md': 5,
        '/etc': 5,
        'C:/x': 5,
        '../x': 5,
        'Half.md': 1.5,
        'Zero.md': 0,
        'Word.md': 'soon',
      }),
    ).toEqual({ 'Plan.md': 5 })
    expect(archiveMap(null)).toEqual({})
    expect(archiveMap(['Plan.md'])).toEqual({})
  })

  test('meets another the same way round from either side', () => {
    const one = { a: 5, b: -7, c: 3 }
    const other = { a: -6, b: 6, d: 1 }

    expect(merged(one, other, 10)).toEqual(merged(other, one, 10))
    expect(merged(one, other, 10)).toEqual({ a: -6, b: -7, c: 3, d: 1 })
  })

  test('keeps a row archived on an exact tie', () => {
    expect(merged({ a: -5 }, { a: 5 }, 10)).toEqual({ a: 5 })
    expect(merged({ a: 5 }, { a: -5 }, 10)).toEqual({ a: 5 })
  })

  test('forgets a restore once every machine has had a month to hear it', () => {
    const now = 10 * REMEMBERED

    expect(trimmed({ old: -(now - REMEMBERED - 1), fresh: -(now - 5), kept: 1 }, now)).toEqual({
      fresh: -(now - 5),
      kept: 1,
    })
  })

  test('and past its ceiling drops the oldest restores before anything archived', () => {
    const map: Record<string, number> = { restored: -(REMEMBERED + 1) }
    for (let one = 0; one < MOST_ARCHIVED; one++) map[`n${one}`] = one + 1

    const cut = trimmed(map, REMEMBERED + 2)

    expect(Object.keys(cut)).toHaveLength(MOST_ARCHIVED)
    expect(cut.restored).toBeUndefined()
  })

  test('says which archived path hides a path', () => {
    const keys = new Set(['Old', 'Old/2019', 'Plan.md'])

    expect(coveredBy(keys, 'Old/2019/Taxes.md')).toBe('Old/2019')
    expect(coveredBy(keys, 'Old/2020')).toBe('Old')
    expect(coveredBy(keys, 'Older')).toBe(null)
    expect(coveredBy(new Set(), 'Plan.md')).toBe(null)
  })

  test('changes nothing, and says so, where nothing would change', () => {
    expect(changed({ a: -5 }, [], ['a', 'b'], 10)).toBe(null)
    expect(changed({}, ['../out'], [], 10)).toBe(null)
  })

  test('stamps a change later than what it replaced', () => {
    expect(stampAfter(undefined, 10)).toBe(10)
    expect(stampAfter(-50, 10)).toBe(51)
    expect(stampAfter(5, 10)).toBe(10)
  })

  test('says whether two maps are the same', () => {
    expect(sameMap({ a: 1 }, { a: 1 })).toBe(true)
    expect(sameMap({ a: 1 }, { a: -1 })).toBe(false)
    expect(sameMap({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})
