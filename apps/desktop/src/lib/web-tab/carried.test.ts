/** What travels with a site's login besides its storage: the zoom and what each host
 *  was allowed, and where each web note was left, named by space and path so another
 *  computer that keeps the space in another folder finds the same note. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const { carriedIn, carriedOut } = await import('./carried')
const { grants } = await import('./permissions.svelte')
const { placeKept, placeOf } = await import('./place')
const { keepZoom, reread, zoomOf } = await import('./sites')

const HERE = [{ id: 'space-1', root: 'C:\\Users\\a\\Notes' }]
const THERE = [{ id: 'space-1', root: '/home/a/Nib/Notes' }]

beforeEach(() => {
  localStorage.clear()
  reread()
})

describe('what travels with a site', () => {
  test('goes out as the site’s zooms, grants and the places of its notes, and comes back in', () => {
    keepZoom('moodle.ethz.ch', 1.25)
    grants.remember('moodle.ethz.ch', 'notifications', 'allow')
    const note = 'C:\\Users\\a\\Notes\\Uni\\Moodle.url'
    placeKept(note, { url: 'https://moodle.ethz.ch/my', x: 0, y: 420, trail: ['a', 'b'], at: 1 })

    const out = carriedOut(['https://moodle.ethz.ch'], [note], note, HERE)
    expect(out).toEqual({
      v: 1,
      zooms: { 'moodle.ethz.ch': 1.25 },
      grants: { 'moodle.ethz.ch': { notifications: 'allow' } },
      places: [
        {
          space: 'space-1',
          path: 'Uni/Moodle.url',
          place: { url: 'https://moodle.ethz.ch/my', x: 0, y: 420, trail: ['a', 'b'], at: 1 },
        },
      ],
      tab: { space: 'space-1', path: 'Uni/Moodle.url' },
    })

    // The other computer, which keeps the space somewhere else.
    localStorage.clear()
    reread()
    grants.forget('moodle.ethz.ch')
    const tab = carriedIn(JSON.parse(JSON.stringify(out)), THERE)

    expect(zoomOf('moodle.ethz.ch')).toBe(1.25)
    expect(grants.said('moodle.ethz.ch', 'notifications')).toBe('allow')
    expect(tab).toMatch(/Uni[\\/]Moodle\.url$/)
    expect(placeOf(tab)).toMatchObject({ url: 'https://moodle.ethz.ch/my', y: 420 })
  })

  test('what does not read as it should is left out', () => {
    expect(carriedIn(null, THERE)).toBeNull()
    expect(carriedIn({ v: 2 }, THERE)).toBeNull()
    expect(
      carriedIn(
        {
          v: 1,
          zooms: { 'a.example': 'big' },
          grants: { 'a.example': { camera: 'maybe', flying: 'allow' } },
          places: [{ space: 'elsewhere', path: 'x.url', place: { url: 'u', x: 0, y: 0 } }],
          tab: { space: 'elsewhere', path: 'x.url' },
        },
        THERE,
      ),
    ).toBeNull()
    expect(zoomOf('a.example')).toBe(1)
    expect(grants.of('a.example')).toEqual({})
  })
})
