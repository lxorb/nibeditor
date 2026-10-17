import { getDomain } from 'tldts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Visit } from './visits'

/** The stores the spaces kept, folded into the shared one once (#239): which stores, with
 *  which origins, what the crate is asked, and that it happens once and only once whole. */

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

const asked: { command: string; args: Record<string, unknown> }[] = []
let failing: string | null = null
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    return failing ? Promise.reject(new Error(failing)) : Promise.resolve({ cookies: 1 })
  },
}))

const { folded, mergeOld, MERGED, oldChoices, oldHistory, planned } = await import('./merged')
const { MOST_VISITS } = await import('./visits')
const NOW = Date.UTC(2026, 9, 13)

const registrable = (host: string) => getDomain(host, { allowPrivateDomains: true })

const visit = (url: string): Visit => ({ url, title: '', visits: 1, typed: 0, last: 1 })

beforeEach(() => {
  kept.clear()
  asked.length = 0
  failing = null
})

describe('which stores', () => {
  test('a space of its own is one store, with every origin its history went to', () => {
    const plan = planned(
      { w: 'space' },
      () => [
        visit('https://moodle.ethz.ch/my'),
        visit('https://moodle.ethz.ch/x'),
        visit('https://github.com/'),
      ],
      registrable,
    )
    expect(plan).toEqual([
      { from: 'space_w', origins: ['https://moodle.ethz.ch', 'https://github.com'] },
    ])
  })

  test('a space kept per site is a store per site, with that site’s origins', () => {
    const plan = planned(
      { h: 'site' },
      () => [
        visit('https://moodle-app2.let.ethz.ch/my/'),
        visit('https://aai-logon.ethz.ch/idp'),
        visit('https://github.com/lxorb'),
      ],
      registrable,
    )
    expect(plan).toEqual([
      {
        from: 'site_h_ethz.ch',
        origins: ['https://moodle-app2.let.ethz.ch', 'https://aai-logon.ethz.ch'],
      },
      { from: 'site_h_github.com', origins: ['https://github.com'] },
    ])
  })

  test('only the spaces that kept theirs apart, and nothing a choice could not be', () => {
    expect(oldChoices({ a: 'global', b: 'space', c: 'site', d: 'host', e: 3 })).toEqual({
      b: 'space',
      c: 'site',
    })
    expect(oldChoices(null)).toEqual({})
    expect(oldHistory('b')).toBe('nib:web-visits:b')
  })
})

describe('the merge', () => {
  test('asks the crate for each store, folds the history, and is done for good', async () => {
    kept.set('nib:web-data', JSON.stringify({ w: 'space' }))
    kept.set('nib:web-visits:w', JSON.stringify([visit('https://a.example/')]))
    kept.set('nib:web-visits', JSON.stringify([visit('https://b.example/')]))

    await mergeOld()

    expect(asked).toEqual([
      { command: 'web_merge', args: { from: 'space_w', origins: ['https://a.example'] } },
    ])
    expect(kept.has('nib:web-data')).toBe(false)
    expect(kept.has('nib:web-visits:w')).toBe(false)
    const history = JSON.parse(kept.get('nib:web-visits') ?? '[]') as Visit[]
    expect(history.map((one) => one.url).sort()).toEqual([
      'https://a.example/',
      'https://b.example/',
    ])
    expect(kept.get(MERGED)).toBeTruthy()

    // Never again.
    asked.length = 0
    kept.set('nib:web-data', JSON.stringify({ w: 'space' }))
    await mergeOld()
    expect(asked).toEqual([])
  })

  test('a computer that never kept a space apart is done at once', async () => {
    await mergeOld()
    expect(asked).toEqual([])
    expect(kept.get(MERGED)).toBeTruthy()
  })

  test('a store that could not be merged is tried again next launch, its choice kept', async () => {
    kept.set('nib:web-data', JSON.stringify({ w: 'space' }))
    failing = 'no page could be made to restore into'
    await mergeOld()
    expect(kept.has(MERGED)).toBe(false)
    expect(kept.has('nib:web-data')).toBe(true)
  })
})

describe('two histories as one', () => {
  const row = (url: string, visits: number, last: number, title = ''): Visit => ({
    url,
    title,
    visits,
    typed: 0,
    last,
  })

  test('a page in both is one row, counted up, as recent as its later side', () => {
    const into = [
      row('https://a.example/', 2, NOW - 1000, 'Old title'),
      row('https://b.example/', 1, NOW),
    ]
    const from = [row('https://a.example/', 3, NOW, 'New title'), row('https://c.example/', 1, NOW)]
    const both = folded(into, from)
    expect(both.map((one) => one.url).sort()).toEqual([
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
    ])
    expect(both.find((one) => one.url === 'https://a.example/')).toEqual(
      row('https://a.example/', 5, NOW, 'New title'),
    )
  })

  test('and no longer than a history may be', () => {
    const many = Array.from({ length: MOST_VISITS }, (_, at) =>
      row(`https://${at}.example/`, 1, at),
    )
    const more = [row('https://new.example/', 1, MOST_VISITS + 1)]
    const both = folded(many, more)
    expect(both).toHaveLength(MOST_VISITS)
    expect(both.some((one) => one.url === 'https://new.example/')).toBe(true)
    expect(both.some((one) => one.url === 'https://0.example/')).toBe(false)
  })
})
