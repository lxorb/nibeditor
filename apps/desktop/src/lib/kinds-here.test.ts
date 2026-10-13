import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Settings › Note types: which kinds anything offers to make, and the account that
 *  carries the choice. Emil, 2026-10-12: *"if they're disabled they won't be shown e.g.
 *  in the Ctrl + T menu BUT when they exist already they are ofc still fully usable"*. */

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

/** The account, writing down what it was told. */
const saved = vi.hoisted(() => [] as [string, unknown][])
vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  api: {
    saveSettings: (token: string, patch: unknown) => {
      saved.push([token, patch])
      return Promise.resolve({ settings: {} })
    },
  },
}))

const { hiddenOf, kindsHere, mayHide, shownOf } = await import('./kinds-here')
const { hiddenKinds } = await import('./hidden-kinds.svelte')
const { offeredKinds, newKinds } = await import('./new-kinds')
const { newFileRows } = await import('./file-kinds')
const { account } = await import('./account.svelte')
const { viewport } = await import('./viewport.svelte')

/** Who is signed in, which the account works out for itself; held here instead. */
let token: string | null = null
Object.defineProperty(account, 'accountToken', { get: () => token, configurable: true })

let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  store.clear()
  saved.length = 0
  hiddenKinds.restore()
})

afterEach(() => {
  viewport.device = was
  token = null
  vi.restoreAllMocks()
})

describe('the kinds offered', () => {
  const here = ['note', 'canvas', 'pages', 'web'] as const

  test('are every kind here that nobody turned off', () => {
    expect(shownOf(here, [])).toEqual(['note', 'canvas', 'pages', 'web'])
    expect(shownOf(here, ['canvas', 'web'])).toEqual(['note', 'pages'])
  })

  /** Turned off on a desktop that had a shell, leaving only the shell; on a page in a
   *  browser there is none, and a chooser with nothing in it is not one. */
  test('keep the first when another device turned all of these off', () => {
    expect(shownOf(here, ['note', 'canvas', 'pages', 'web'])).toEqual(['note'])
  })

  test('let any but the last one offered be turned off', () => {
    expect(mayHide('canvas', here, [])).toBe(true)
    expect(mayHide('note', here, ['canvas', 'pages'])).toBe(true)
    expect(mayHide('note', here, ['canvas', 'pages', 'web'])).toBe(false)
    // One already off is not turned off again.
    expect(mayHide('web', here, ['web'])).toBe(false)
  })
})

describe('a stored list of kinds turned off', () => {
  test('keeps words, once each, in the order written', () => {
    expect(hiddenOf(['canvas', 'web', 'canvas'])).toEqual(['canvas', 'web'])
  })

  /** A kind a newer build has, turned off there, stays off when this one writes the
   *  list back. */
  test('keeps a kind this version has never heard of', () => {
    expect(hiddenOf(['something-new'])).toEqual(['something-new'])
  })

  test('drops what could be no kind', () => {
    expect(hiddenOf(['Canvas', 3, '', 'web note', null, 'web'])).toEqual(['web'])
    expect(hiddenOf('canvas')).toEqual([])
    expect(hiddenOf(null)).toEqual([])
  })
})

describe('the kinds a device has', () => {
  test('are what is written and the online terminal on a page in a browser', () => {
    expect(kindsHere()).toEqual(['note', 'canvas', 'pages', 'online', 'web'])
  })

  test('take the chat in with an account', () => {
    token = 'token'
    expect(kindsHere()).toContain('chat')
  })

  test('leave the web out on a phone', () => {
    viewport.device = 'phone'
    expect(kindsHere()).not.toContain('web')
  })
})

describe('turning a kind off', () => {
  test('takes it out of the chooser and the file list, and nothing else', () => {
    hiddenKinds.set('canvas', false)

    expect(offeredKinds().map((one) => one.kind)).toEqual(['note', 'pages', 'online', 'web'])
    expect(newFileRows().map((one) => one?.label)).toEqual([
      'New note',
      'New page note',
      'New web note',
    ])
    // Settings still lists it, so it can be turned back on.
    expect(newKinds().map((one) => one.kind)).toContain('canvas')
  })

  test('is undone by turning it on, and the default is stored as nothing', () => {
    hiddenKinds.set('canvas', false)
    expect(JSON.parse(store.get('nib:hidden-kinds') ?? '[]')).toEqual(['canvas'])

    hiddenKinds.set('canvas', true)
    expect(hiddenKinds.offers('canvas')).toBe(true)
    expect(store.has('nib:hidden-kinds')).toBe(false)
  })

  test('is refused for the last kind offered', () => {
    for (const kind of ['note', 'canvas', 'pages', 'online'] as const) hiddenKinds.set(kind, false)
    expect(hiddenKinds.shown).toEqual(['web'])

    hiddenKinds.set('web', false)
    expect(hiddenKinds.shown).toEqual(['web'])
    expect(hiddenKinds.mayHide('web')).toBe(false)
  })

  test('is read back by the next run', () => {
    hiddenKinds.set('pages', false)
    hiddenKinds.hidden = []

    hiddenKinds.restore()
    expect(hiddenKinds.offers('pages')).toBe(false)
  })
})

describe('the account', () => {
  test('is told, and told null for every kind back on', () => {
    token = 'token'

    hiddenKinds.set('web', false)
    hiddenKinds.set('web', true)

    expect(saved.map(([, patch]) => patch)).toEqual([
      { hiddenKinds: ['web'] },
      { hiddenKinds: null },
    ])
  })

  test('is followed, the last machine to change it winning', () => {
    hiddenKinds.receive({ hiddenKinds: ['canvas', 'something-new'] })
    expect(hiddenKinds.offers('canvas')).toBe(false)
    expect(hiddenKinds.hidden).toEqual(['canvas', 'something-new'])

    hiddenKinds.receive({ hiddenKinds: null })
    expect(hiddenKinds.offers('canvas')).toBe(true)
    expect(store.has('nib:hidden-kinds')).toBe(false)
  })

  test('that never heard of it takes this machine’s list', () => {
    hiddenKinds.set('pages', false)
    token = 'token'

    hiddenKinds.receive({})
    expect(saved).toEqual([['token', { hiddenKinds: ['pages'] }]])
  })
})
