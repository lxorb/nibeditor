/** What a device remembers about a site: Chrome's "Mute site", and the size a site was
 *  zoomed to. Both by site, both only for what somebody chose. See sites.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

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

const { isMuted, keepZoom, reread, setMuted, zoomOf } = await import('./sites')

beforeEach(() => {
  localStorage.clear()
  reread()
})

test('a site is heard until somebody mutes it, and after they unmute it', () => {
  expect(isMuted('example.com')).toBe(false)
  setMuted('example.com', true)
  expect(isMuted('example.com')).toBe(true)
  expect(isMuted('other.example')).toBe(false)
  setMuted('example.com', false)
  expect(isMuted('example.com')).toBe(false)
})

test('a muted site stays muted the next time the app opens', () => {
  setMuted('example.com', true)
  reread()
  expect(isMuted('example.com')).toBe(true)
})

test('no site is the empty one', () => {
  setMuted('', true)
  expect(isMuted('')).toBe(false)
})

test('a site opens at the size it was left at, and every other at a hundred per cent', () => {
  keepZoom('example.com', 1.25)
  reread()
  expect(zoomOf('example.com')).toBe(1.25)
  expect(zoomOf('other.example')).toBe(1)
})

test('the engine s doubles land on the rung they meant', () => {
  keepZoom('example.com', 1.1000000238418579)
  expect(zoomOf('example.com')).toBe(1.1)
})

test('a hundred per cent is nothing kept', () => {
  keepZoom('example.com', 1.5)
  keepZoom('example.com', 1)
  expect(localStorage.getItem('nib:web-zooms')).toBe('{}')
})

test('nonsense is not a size', () => {
  keepZoom('example.com', 0)
  keepZoom('example.com', Number.NaN)
  expect(zoomOf('example.com')).toBe(1)
})
