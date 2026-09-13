/** What a site is told, and when it is asked.
 *
 *  The behaviour worth being sure of is Chrome's: a site is asked **once**, at the
 *  moment it asks, and every request after that is answered before anything appears on
 *  screen. A request the reader never sees is a request that was answered from what
 *  they said last time - which is the whole difference between this and the menu row it
 *  replaced. See permissions.svelte.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const answered: { id: number; allow: boolean }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_answer') {
      answered.push({ id: Number(args.id), allow: args.allow === true })
    }
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

const { grants, readAsked, siteOf } = await import('./permissions.svelte')

let next = 1

/** One request from a site, as the crate sends it. */
function asked(site: string, kind: string, tab = 'a') {
  const said = readAsked({ tab, id: next++, origin: `https://${site}/page`, kind })
  expect(said).not.toBe(null)
  return said!
}

beforeEach(() => {
  answered.length = 0
  grants.asking = []
  for (const site of ['a.example', 'b.example']) grants.forget(site)
})

test('reads a request and throws out anything that is not one', () => {
  expect(readAsked({ tab: 'a', id: 1, origin: 'https://a.example/', kind: 'camera' })).toEqual({
    tab: 'a',
    id: 1,
    site: 'a.example',
    ask: 'camera',
  })

  expect(readAsked({ tab: 'a', id: 1, origin: 'https://a.example/', kind: 'usb' })).toBe(null)
  expect(readAsked({ tab: 'a', origin: 'https://a.example/', kind: 'camera' })).toBe(null)
  expect(readAsked(null)).toBe(null)
})

test('the first request puts the bubble up and the answer is remembered', () => {
  const one = asked('a.example', 'camera')
  grants.heard(one)

  expect(grants.asking).toHaveLength(1)
  expect(answered).toHaveLength(0)

  grants.answer(one, true)

  expect(grants.asking).toHaveLength(0)
  expect(answered).toEqual([{ id: one.id, allow: true }])
  expect(grants.said('a.example', 'camera')).toBe('allow')
})

test('the same site asking again is answered without a bubble', () => {
  const one = asked('a.example', 'camera')
  grants.heard(one)
  grants.answer(one, true)
  answered.length = 0

  const again = asked('a.example', 'camera')
  grants.heard(again)

  expect(grants.asking).toHaveLength(0)
  expect(answered).toEqual([{ id: again.id, allow: true }])
})

test('a grant is about one site and one thing', () => {
  const one = asked('a.example', 'camera')
  grants.heard(one)
  grants.answer(one, true)

  // Another site that links to it is another site.
  grants.heard(asked('b.example', 'camera'))
  expect(grants.asking).toHaveLength(1)

  // And the microphone is not the camera.
  grants.asking = []
  grants.heard(asked('a.example', 'microphone'))
  expect(grants.asking).toHaveLength(1)
})

test('one press answers every request it was about', () => {
  const one = asked('a.example', 'camera')
  const twice = asked('a.example', 'camera')
  grants.heard(one)
  grants.heard(twice)
  expect(grants.asking).toHaveLength(2)

  grants.answer(one, false)

  expect(grants.asking).toHaveLength(0)
  expect(answered).toEqual([
    { id: one.id, allow: false },
    { id: twice.id, allow: false },
  ])
})

test('a bubble somebody dismissed decides nothing about the site', () => {
  const one = asked('a.example', 'camera')
  grants.heard(one)
  grants.dismiss(one)

  expect(grants.asking).toHaveLength(0)
  expect(answered).toEqual([{ id: one.id, allow: false }])
  // Nothing remembered, so the site is asked again the next time it asks.
  expect(grants.said('a.example', 'camera')).toBe(null)

  const again = asked('a.example', 'camera')
  grants.heard(again)
  expect(grants.asking).toHaveLength(1)
})

test('a tab that closes lets go of the questions it was holding', () => {
  grants.heard(asked('a.example', 'camera', 'a'))
  grants.heard(asked('b.example', 'location', 'b'))

  grants.dropped('a')

  expect(grants.asking.map((one) => one.tab)).toEqual(['b'])
  expect(answered).toHaveLength(1)
  expect(answered[0]?.allow).toBe(false)
})

test('resetting a site forgets everything it was told', () => {
  const one = asked('a.example', 'camera')
  grants.heard(one)
  grants.answer(one, true)
  const two = asked('a.example', 'location')
  grants.heard(two)
  grants.answer(two, false)

  expect(Object.keys(grants.of('a.example'))).toHaveLength(2)

  grants.forget('a.example')

  expect(grants.of('a.example')).toEqual({})
  expect(grants.said('a.example', 'camera')).toBe(null)
})

test('what is written down survives being read back', () => {
  const one = asked('a.example', 'notifications')
  grants.heard(one)
  grants.answer(one, false)

  const kept = localStorage.getItem('nib:web-grants')
  expect(kept).toContain('a.example')
  expect(kept).toContain('block')
})

test('the site is the host as the bar shows it', () => {
  expect(siteOf('https://www.a.example/page?a=1')).toBe('a.example')
  expect(siteOf(null)).toBe('')
})
