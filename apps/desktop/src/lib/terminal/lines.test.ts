import { beforeEach, describe, expect, test, vi } from 'vitest'
import { keepLines, linesOf } from './lines'

/** The last lines each terminal had, between runs. */

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

beforeEach(() => store.clear())

describe('a terminal’s last lines', () => {
  test('come back under the key the terminal was made with', () => {
    keepLines('a', 'npm run build\r\nfailed')
    expect(linesOf('a')).toBe('npm run build\r\nfailed')
    expect(linesOf('b')).toBeNull()
  })

  /** A terminal with no key is one written before keys existed, and has nothing to
   *  come back. */
  test('and a terminal with no key keeps nothing', () => {
    keepLines('', 'lost')
    expect(linesOf('')).toBeNull()
    expect(store.size).toBe(0)
  })

  /** Terminals closed for good leave their lines behind; the newest dozen are what
   *  stays, so storage does not fill with shells nobody will open again. */
  test('only for the dozen written most recently', () => {
    for (let at = 0; at < 15; at++) keepLines(`t${at}`, `screen ${at}`, at)

    expect(linesOf('t0')).toBeNull()
    expect(linesOf('t2')).toBeNull()
    expect(linesOf('t3')).toBe('screen 3')
    expect(linesOf('t14')).toBe('screen 14')
  })

  test('and storage that is not a record of them reads as nothing', () => {
    store.set('nib:terminal-lines', '["not", "a record"]')
    expect(linesOf('a')).toBeNull()

    store.set('nib:terminal-lines', '{"a": {"at": "soon", "text": 3}}')
    expect(linesOf('a')).toBeNull()
  })
})
