/** What the engine says about a page, read and landed: the speaker on the tab, a page
 *  holding the screen, a zoom made inside the page, and a find's tally. See heard.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const muted: { tab: string; muted: boolean }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_mute') muted.push({ tab: String(args.tab), muted: args.muted === true })
    return Promise.resolve(undefined)
  },
}))

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

const { found, heard, readFound, readSaid } = await import('./heard')
const { Page } = await import('./pages.svelte')
const sites = await import('./sites')

function on(url: string) {
  const page = new Page()
  page.url = url
  return page
}

beforeEach(() => {
  muted.length = 0
  localStorage.clear()
  sites.reread()
})

test('reads the three things a page is said to be doing, and nothing else', () => {
  expect(readSaid({ tab: 'a', said: 'sound', playing: true, muted: false })).toEqual({
    tab: 'a',
    said: 'sound',
    playing: true,
    muted: false,
  })
  expect(readSaid({ tab: 'a', said: 'fill', on: true })).toEqual({ tab: 'a', said: 'fill', on: true })
  expect(readSaid({ tab: 'a', said: 'zoom', factor: 1.5 })).toEqual({
    tab: 'a',
    said: 'zoom',
    factor: 1.5,
  })

  expect(readSaid({ tab: 'a', said: 'zoom', factor: 0 })).toBe(null)
  expect(readSaid({ tab: 'a', said: 'shout' })).toBe(null)
  expect(readSaid({ said: 'fill', on: true })).toBe(null)
  expect(readSaid('fill')).toBe(null)
})

test('a find with nothing found lights nothing', () => {
  expect(readFound({ tab: 'a', count: 3, at: 1 })).toEqual({ tab: 'a', count: 3, at: 1 })
  expect(readFound({ tab: 'a', count: 0, at: 0 })).toEqual({ tab: 'a', count: 0, at: -1 })
  expect(readFound({ tab: 'a', count: '3', at: 1 })).toBe(null)

  const page = on('https://example.com/')
  found(page, { tab: 'a', count: 4, at: 2 })
  expect([page.find.count, page.find.at]).toEqual([4, 2])
})

test('a page playing puts the speaker on its tab, and falling quiet takes it off', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'sound', playing: true, muted: false })
  expect(page.playing).toBe(true)
  heard(page, { tab: 'a', said: 'sound', playing: false, muted: false })
  expect(page.playing).toBe(false)
  expect(muted).toEqual([])
})

/** Chrome's Mute site: a muted site is quiet in whichever tab it starts playing in. */
test('a muted site is muted the moment it plays', () => {
  sites.setMuted('example.com', true)
  const page = on('https://www.example.com/watch')

  heard(page, { tab: 'a', said: 'sound', playing: true, muted: false })
  expect(muted).toEqual([{ tab: 'a', muted: true }])
  expect(page.muted).toBe(true)
})

/** And a tab muted for the last site is heard on the next one. */
test('a site nobody muted is heard, whatever the tab was told before', () => {
  const page = on('https://other.example/')

  heard(page, { tab: 'a', said: 'sound', playing: true, muted: true })
  expect(muted).toEqual([{ tab: 'a', muted: false }])
})

test('a page holding the screen says so on its tab', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'fill', on: true })
  expect(page.filling).toBe(true)
  heard(page, { tab: 'a', said: 'fill', on: false })
  expect(page.filling).toBe(false)
})

/** Ctrl and the wheel inside the page: the menu's percentage follows, and the site
 *  opens at that size next time. */
test('a zoom made inside the page is the size the site is kept at', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'zoom', factor: 1.25 })
  expect(page.zoom).toBe(1.25)
  expect(sites.zoomOf('example.com')).toBe(1.25)
})
