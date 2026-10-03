import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Delete browsing data: what reaches the engine, and what of the history goes. */

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

const asked: { command: string; args: Record<string, unknown> }[] = []
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    return Promise.resolve(undefined)
  },
}))

const { clearData, keptApart, reach, sinceFor } = await import('./clearing')
const { visited } = await import('./visited')
const { webData } = await import('./web-data.svelte')
const { placeKept, placeOf } = await import('./place')

const NOW = Date.UTC(2026, 9, 3, 12)
const HOUR = 3_600_000

beforeEach(() => {
  asked.length = 0
})

describe("Chrome's time ranges", () => {
  test('reach back from now, and all time is from the start', () => {
    expect(sinceFor('quarter', NOW)).toBe(NOW - 15 * 60_000)
    expect(sinceFor('hour', NOW)).toBe(NOW - HOUR)
    expect(sinceFor('month', NOW)).toBe(NOW - 28 * 24 * HOUR)
    expect(sinceFor('all', NOW)).toBe(0)
  })
})

describe('whose data', () => {
  test('a space on Global clears the store every space shares', async () => {
    expect(await reach('s1', ['s1', 's2'], false)).toEqual({
      stores: [null],
      books: ['nib:web-visits'],
    })
    expect(keptApart(['s1', 's2'])).toBe(false)
  })

  test("a space kept apart clears its own store and history, or every space's", async () => {
    webData.set('s2', 'space')
    expect(keptApart(['s1', 's2'])).toBe(true)
    expect(await reach('s2', ['s1', 's2'], false)).toEqual({
      stores: ['space_s2'],
      books: ['nib:web-visits:s2'],
    })
    expect(await reach('s1', ['s1', 's2'], true)).toEqual({
      stores: [null, 'space_s2'],
      books: ['nib:web-visits', 'nib:web-visits:s2'],
    })
    webData.set('s2', 'global')
  })

  test("a space kept per site clears each site's store its history names", async () => {
    webData.set('s3', 'site')
    const book = webData.history('s3')
    visited.saw(book, 't1', 'https://moodle-app2.let.ethz.ch/my/', 'Moodle')
    visited.saw(book, 't2', 'https://github.com/lxorb', 'GitHub')
    const { stores } = await reach('s3', ['s3'], false)
    expect(stores).toEqual(
      expect.arrayContaining(['space_s3', 'site_s3_ethz.ch', 'site_s3_github.com']),
    )
    webData.set('s3', 'global')
  })
})

describe('the clearing', () => {
  test("asks the engine for the range's sites, then forgets the range's history", async () => {
    const book = 'nib:web-visits'
    visited.saw(book, 'old', 'https://old.example/page', 'Old')
    visited.saw(book, 'new', 'https://new.example/page', 'New')
    // Back-date the old one by a day, as if it was last open yesterday.
    const rows = visited
      .all(book)
      .map((one) =>
        one.url.includes('old') ? { ...one, last: NOW - 24 * HOUR } : { ...one, last: NOW },
      )
    localStorage.setItem(book, JSON.stringify(rows))
    vi.resetModules()
    const fresh = await import('./clearing')
    const { visited: again } = await import('./visited')
    const places = await import('./place')
    places.placeKept('/Notes/New.url', { url: 'https://new.example/page', x: 0, y: 40 })
    places.placeKept('/Notes/Old.url', { url: 'https://old.example/page', x: 0, y: 80 })

    await fresh.clearData(
      { range: 'hour', history: true, site: true, cache: false, everywhere: false },
      null,
      [],
      NOW,
    )

    const call = asked.find((one) => one.command === 'web_clear')
    expect(call?.args).toEqual({
      stores: [null],
      clearing: { since: NOW - HOUR, site: true, cache: false },
      sites: ['https://new.example'],
    })
    expect(again.all(book).map((one) => one.url)).toEqual(['https://old.example/page'])
    expect(places.placeOf('/Notes/New.url')).toBeNull()
    expect(places.placeOf('/Notes/Old.url')?.y).toBe(80)
  })

  test('history alone never reaches the engine, and all time forgets every place', async () => {
    placeKept('/Notes/A.url', { url: 'https://a.example/', x: 0, y: 1 })
    await clearData(
      { range: 'all', history: true, site: false, cache: false, everywhere: false },
      null,
      [],
      NOW,
    )
    expect(asked.some((one) => one.command === 'web_clear')).toBe(false)
    expect(visited.all('nib:web-visits')).toEqual([])
    expect(placeOf('/Notes/A.url')).toBeNull()
  })
})
