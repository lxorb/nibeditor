import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { forTheCookie } from './local'
import { STORAGE_KEY as RECOVERY_KEY } from '../recovery.svelte'
import { STORAGE_KEY as MIRRORS_KEY } from '../sync.svelte'
import { STORAGE_KEY as FOLDER_ICONS_KEY } from '../workspace/folder-icons.svelte'
import { STORAGE_KEY as ARCHIVED_KEY } from '../workspace/archive.svelte'
import {
  EXPANDED_KEY,
  ICON_TINTS_KEY,
  ICONS_KEY,
  RECENT_KEY,
  TAGS_KEY,
} from '../workspace/device.svelte'

/** Device-local settings across launches of a packed plugin.
 *
 *  The plugin is served from `http://127.0.0.1:<port>` with a new port every
 *  launch, so the page's own `localStorage` is a different origin's each time
 *  and always empty. The cookie is the exception: cookies are scoped to the host
 *  and ignore the port, which is why on a real device it was the one page store
 *  that came back with anything. This is that, twice over. */

const phone = vi.hoisted(() => ({ held: new Map<string, string>(), reachable: false }))

vi.mock('./sdk', () => ({
  connectStore: async () => {
    while (!phone.reachable) await new Promise((resolve) => setTimeout(resolve, 20))

    return {
      read: (key: string) => Promise.resolve(phone.held.get(key) ?? ''),
      write: (key: string, value: string) => {
        phone.held.set(key, value)
        return Promise.resolve(true)
      },
    }
  },
}))

/** The one thing that outlives a launch on the page's side. */
let jar = ''

/** The module graph, compiled once and outside anybody's budget. Every launch
 *  below re-imports the store to get a fresh one, and the first of those would
 *  otherwise pay for compiling it inside a five second test; see
 *  docs/conventions.md. */
beforeAll(async () => {
  await import('./local')
})

/** A new port, so a new origin, so an empty `localStorage`. The cookie stays.
 *
 *  Real timers while the module loads: a dynamic import is not something to run
 *  the clock over. */
async function launch() {
  vi.useRealTimers()
  vi.resetModules()

  vi.stubGlobal('document', {
    get cookie() {
      return jar
    },
    set cookie(one: string) {
      const [pair = ''] = one.split(';')
      const [name = ''] = pair.split('=')
      const rest = jar
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`))

      jar = [...rest, pair].join('; ')
    },
  })

  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })

  const module = await import('./local')
  vi.useFakeTimers()

  return module
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  jar = ''
  phone.held.clear()
  phone.reachable = true
})

describe('settings across launches', () => {
  test('a setting written in one launch is there in the next', async () => {
    const first = await launch()
    const one = first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    // The write settles rather than going out per keystroke.
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(one.getItem('nib:theme')).toBe('dark')
  })

  test('it is there at the first paint, without waiting for the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    // The channel never arrives this launch. The cookie is synchronous, so what
    // decides the first paint is known before anything is painted.
    phone.reachable = false
    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('nib:theme')).toBe('dark')
  })

  test('what the cookie could not hold comes back from the phone', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    // Far past what a cookie will take, so only the phone app can hold it.
    localStorage.setItem('nib:layouts', 'x'.repeat(6000))
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    // The small one rode the cookie and is here already.
    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(localStorage.getItem('nib:layouts')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:layouts')).toHaveLength(6000)
  })

  test('a setting changed this launch is not undone by the phone answering late', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    // Somebody changes it before the channel arrives.
    localStorage.setItem('nib:theme', 'light')

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:theme')).toBe('light')
  })

  test('the page keeps working when there is no cookie and no phone', async () => {
    phone.reachable = false
    const only = await launch()
    only.installLocal()

    localStorage.setItem('nib:theme', 'dark')
    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(localStorage.getItem('nothing')).toBeNull()
  })
})

/** Which store a key belongs in.
 *
 *  Measured on Emil's own account: `nib:mirrors` - what the syncing knows about every
 *  note it has seen - is 133 bytes plus the path per note. That is 4,408 bytes for his
 *  twenty notes, 7,706 once the cookie's own URI encoding is counted, against a 3,500
 *  byte cookie. It stopped fitting at about fourteen notes, and because the cookie was
 *  filled smallest first it was the first thing dropped: read back as nothing, written
 *  back as nothing, and the syncing then believed it had never seen those notes.
 *
 *  So size does not decide it any more. Bookkeeping rides the phone app's own store,
 *  which is unbounded; the cookie carries what the first paint is made of. */
describe('which store a key rides in', () => {
  /** A mirrors map about the size of Emil's: twenty notes of bookkeeping. */
  function mirrors(notes: number): string {
    const held: Record<string, unknown> = {}
    for (let at = 0; at < notes; at++) {
      held[`/Notes/A note ${String(at)}.md`] = {
        id: `note-${String(at)}`,
        hash: 'f'.repeat(64),
        at: 1_788_000_000_000,
        rev: at,
      }
    }

    return JSON.stringify({ mirrors: { '/Notes': { spaceId: 's', notes: held, files: {} } } })
  }

  test('is decided by what it is for, not by how big it is', async () => {
    // Bigger than the cookie on its own, measured the way the cookie measures it -
    // URI encoded, which is where Emil's 4,408 bytes became 7,706. This is the case
    // that was losing notes.
    expect(encodeURIComponent(mirrors(20)).length).toBeGreaterThan(3500)

    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:theme', 'dark')
    localStorage.setItem('nib:language', 'de')
    localStorage.setItem('nib:mirrors', mirrors(20))
    localStorage.setItem('nib:recent', JSON.stringify(['/Notes/One.md', '/Notes/Two.md']))
    await vi.advanceTimersByTimeAsync(1000)

    // A launch the phone app never answers in: the cookie is the whole of what is
    // known, and every first-paint key is on it.
    phone.reachable = false
    const second = await launch()
    second.installLocal()

    expect(localStorage.getItem('nib:theme')).toBe('dark')
    expect(localStorage.getItem('nib:language')).toBe('de')
    expect(localStorage.getItem('nib:mirrors')).toBeNull()
    expect(localStorage.getItem('nib:recent')).toBeNull()
  })

  /** The whole point: what the cookie will not carry is late rather than lost. */
  test('and the bookkeeping comes back whole when the phone answers', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:mirrors', mirrors(20))
    await vi.advanceTimersByTimeAsync(1000)

    const second = await launch()
    const local = second.installLocal()
    expect(localStorage.getItem('nib:mirrors')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:mirrors')).toBe(mirrors(20))
  })

  /** A cookie an older build wrote still has a cut-down mirrors map in it, and half a
   *  map is worse than none: `fillFrom` leaves alone whatever is already held, so the
   *  short one would stand and the phone app's full copy would never land. */
  test('and one an older build truncated into the cookie is not read at all', async () => {
    const first = await launch()
    first.installLocal()
    localStorage.setItem('nib:mirrors', mirrors(20))
    await vi.advanceTimersByTimeAsync(1000)

    const short = JSON.stringify({ 'nib:mirrors': mirrors(3) })
    jar = `nib:local=${encodeURIComponent(short)}`

    const second = await launch()
    const local = second.installLocal()
    expect(localStorage.getItem('nib:mirrors')).toBeNull()

    await second.fillLocal(local)
    expect(localStorage.getItem('nib:mirrors')).toBe(mirrors(20))
  })

  test('leaves everything else where it was, so nothing moved by accident', () => {
    const kept = forTheCookie({
      'nib:theme': 'dark',
      'nib:accent': 'violet',
      'nib:session': 'a-token',
      'nib:workspace': '{"panes":[]}',
      'nib:modes': '{"vim":true}',
      'nib:mirrors': '{}',
      'nib:recovery': '{"every":5}',
    })

    expect(Object.keys(kept).sort()).toEqual([
      'nib:accent',
      'nib:modes',
      'nib:session',
      'nib:theme',
      'nib:workspace',
    ])
  })

  /** The list in local.ts is written out rather than imported, because that file runs
   *  before any store exists and an import would build the store graph too early - the
   *  bug that hid the space icons. So the names are held to the modules that own them
   *  here instead. */
  test('names the keys those stores actually use', () => {
    const owned = [
      MIRRORS_KEY,
      RECOVERY_KEY,
      RECENT_KEY,
      EXPANDED_KEY,
      TAGS_KEY,
      ICONS_KEY,
      ICON_TINTS_KEY,
      FOLDER_ICONS_KEY,
      ARCHIVED_KEY,
    ]

    expect(forTheCookie(Object.fromEntries(owned.map((one) => [one, 'x'])))).toEqual({})
  })
})
