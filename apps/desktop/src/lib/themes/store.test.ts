import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The gallery's state: what the grid shows for what was typed, and where a
 *  theme stands once it has been installed, updated and removed again.
 *
 *  Run against the real theme store rather than a stand-in for it, with the
 *  themes folder and the network the only things replaced. Under node there is
 *  no storage, no document and no folder, so all three are stood in for before
 *  the stores are imported. */

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

/** Storage and a page, fresh for every test: the theme store is a singleton, so
 *  what one test chose is still chosen when the next one starts. */
function stubs() {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {},
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', remove: () => undefined }),
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

stubs()

/** The themes folder, as the commands see it: one stylesheet per id. */
const folder = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock('../tauri', () => ({
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'list_themes') {
      return Promise.resolve(
        [...folder.files.keys()].map((id) => ({
          id: `file:${id}`,
          name: id,
          path: `/themes/${id}.css`,
        })),
      )
    }

    if (command === 'read_theme') {
      const id = /\/themes\/(.*)\.css$/.exec(String(args.path))?.[1] ?? ''
      return Promise.resolve(folder.files.get(id) ?? '')
    }

    if (command === 'write_theme') {
      folder.files.set(String(args.id), String(args.css))
      return Promise.resolve(`/themes/${String(args.id)}.css`)
    }

    if (command === 'remove_theme') {
      folder.files.delete(String(args.id))
      return Promise.resolve(undefined)
    }

    // `read_custom_css`, which the reload asks for after the themes.
    return Promise.resolve('')
  },
}))

const { arrange, store } = await import('./store.svelte')
const { theme } = await import('../theme.svelte')

/** One catalogue entry, with only what the test cares about spelled out. */
function entry(patch: Record<string, unknown> = {}) {
  return {
    id: 'warm-paper',
    name: 'Warm Paper',
    author: 'Nib',
    version: '1.0.0',
    description: 'Ink on cream.',
    tags: ['light', 'warm'],
    licence: 'MIT',
    variants: ['light'],
    updated: '2026-09-07',
    palettes: { light: { '--bg': '#faf6ee' }, dark: {} },
    ...patch,
  }
}

/** The stylesheet the registry serves for a theme. */
const sheet = (colour: string) => `[data-theme='light'] { color-scheme: light; --bg: ${colour}; }`

/** One that states both schemes, which is what makes a theme a pair. */
const PAIR = `[data-theme='light'] { --bg: #fff; }
[data-theme='dark'] { --bg: #000; }`

/** Answers the catalogue and the stylesheets, and counts what was asked for. */
function serving(themes: unknown[], css = sheet('#faf6ee')) {
  const asked: string[] = []

  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)

    const body = url.endsWith('index.json') ? JSON.stringify({ themes }) : css
    return Promise.resolve(new Response(body, { status: 200 }))
  })

  return asked
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubs()

  folder.files.clear()
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  store.themes = []
  store.query = ''
  store.order = 'newest'
  store.error = null
  store.refused = { id: '', notes: [] }
})

describe('what the grid shows', () => {
  const catalogue = [
    entry({ id: 'a', name: 'Zinc', updated: '2026-01-01', tags: ['dark'], description: 'Cold.' }),
    entry({
      id: 'b',
      name: 'Amber',
      updated: '2026-08-01',
      tags: ['light', 'warm'],
      description: 'Ink on cream.',
    }),
    entry({
      id: 'c',
      name: 'Mono',
      updated: '2026-08-01',
      author: 'Emil',
      tags: ['grey'],
      description: 'No hue at all.',
    }),
  ].map((one) => ({ ...one, variants: ['light' as const], palettes: { light: {}, dark: {} } }))

  test('newest first, and ties by name so the order is the same everywhere', () => {
    expect(arrange(catalogue, '', 'newest').map((one) => one.name)).toEqual([
      'Amber',
      'Mono',
      'Zinc',
    ])
  })

  test('by name is by name', () => {
    expect(arrange(catalogue, '', 'name').map((one) => one.name)).toEqual(['Amber', 'Mono', 'Zinc'])
  })

  test('searches the name, the author, the tags and what it says', () => {
    expect(arrange(catalogue, 'mono', 'name').map((one) => one.id)).toEqual(['c'])
    expect(arrange(catalogue, 'Emil', 'name').map((one) => one.id)).toEqual(['c'])
    expect(arrange(catalogue, 'warm', 'name').map((one) => one.id)).toEqual(['b'])
    expect(arrange(catalogue, 'cream', 'name').map((one) => one.id)).toEqual(['b'])
  })

  test('the case of what was typed does not matter', () => {
    expect(arrange(catalogue, 'ZINC', 'name').map((one) => one.id)).toEqual(['a'])
  })

  test('what was searched for is still sorted', () => {
    // Both are by the same author; the newer one comes first, which is what the
    // choice of order is for. A search narrows the shelf without reordering it
    // by a score nobody can see.
    const found = arrange(catalogue, 'Nib', 'newest')
    expect(found.map((one) => one.name)).toEqual(['Amber', 'Zinc'])
  })

  test('nothing typed shows everything, and does not reorder the catalogue', () => {
    expect(arrange(catalogue, '   ', 'newest')).toHaveLength(3)
    expect(catalogue.map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  test('nothing matching shows nothing', () => {
    expect(arrange(catalogue, 'chartreuse', 'name')).toEqual([])
  })
})

describe('the catalogue', () => {
  test('is read once and not again while it is fresh', async () => {
    const asked = serving([entry()])

    await store.load()
    await store.load()

    expect(asked).toEqual([expect.stringContaining('index.json')])
    expect(store.themes).toHaveLength(1)
  })

  test('is read again when it is asked for outright', async () => {
    const asked = serving([entry()])

    await store.load()
    await store.load(true)

    expect(asked).toHaveLength(2)
  })

  test('a registry that will not answer says so and shows nothing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))

    await store.load()

    expect(store.themes).toEqual([])
    expect(store.error).toBe('could not reach the theme store')
  })
})

describe('installing, updating and removing', () => {
  test('writes the theme, stamps it, and puts the app on it', async () => {
    serving([entry()])
    await store.load()

    expect(store.installed('warm-paper')).toBe(false)
    await store.install(entry({}) as never)

    expect(folder.files.get('warm-paper')).toContain('--bg: #faf6ee;')
    expect(folder.files.get('warm-paper')).toContain('"version":"1.0.0"')
    expect(store.installed('warm-paper')).toBe(true)
    expect(store.using('warm-paper')).toBe(true)
    expect(theme.active.name).toBe('Warm Paper')
  })

  test('a pair opens on the side the app was already showing', async () => {
    serving([entry({ variants: ['light', 'dark'] })], PAIR)
    await store.load()
    theme.setScheme('dark')

    await store.install(entry({ variants: ['light', 'dark'] }) as never)

    expect(theme.current).toBe('dark')
    expect(theme.active.variants).toEqual(['light', 'dark'])
  })

  test('a pair is switched inside itself rather than swapped for a built-in', async () => {
    serving([entry({ variants: ['light', 'dark'] })], PAIR)
    await store.load()
    theme.setScheme('light')
    await store.install(entry({ variants: ['light', 'dark'] }) as never)

    theme.toggle()
    expect(theme.current).toBe('dark')
    expect(store.using('warm-paper')).toBe(true)

    theme.toggle()
    expect(theme.current).toBe('light')
    expect(store.using('warm-paper')).toBe(true)
  })

  test('a theme that brings an accent keeps it, and one that does not lets it go', async () => {
    // The card in the gallery showed the theme's own accent, so what the app
    // looks like afterwards has to be what the card showed.
    serving([entry()], `[data-theme='light'] { --bg: #fff; --accent: #a0522d; }`)
    await store.load()
    await store.install(entry({}) as never)
    expect(theme.accentIsTheme).toBe(true)

    await store.remove('warm-paper')
    expect(theme.accentIsTheme).toBe(false)
  })

  test('offers an update only when the catalogue is ahead', async () => {
    serving([entry()])
    await store.load()
    await store.install(entry({}) as never)

    expect(store.updatable(entry() as never)).toBe(false)
    expect(store.updatable(entry({ version: '1.0.1' }) as never)).toBe(true)
    expect(store.updatable(entry({ version: '0.9.0' }) as never)).toBe(false)
  })

  test('an update replaces the file and the version with it', async () => {
    serving([entry()])
    await store.load()
    await store.install(entry({}) as never)

    serving([entry({ version: '2.0.0' })], sheet('#111111'))
    await store.install(entry({ version: '2.0.0' }) as never)

    expect(folder.files.size).toBe(1)
    expect(folder.files.get('warm-paper')).toContain('--bg: #111111;')
    expect(store.updatable(entry({ version: '2.0.0' }) as never)).toBe(false)
  })

  test('removing takes the file away and the app off it', async () => {
    serving([entry()])
    await store.load()
    await store.install(entry({}) as never)

    await store.remove('warm-paper')

    expect(folder.files.size).toBe(0)
    expect(store.installed('warm-paper')).toBe(false)
    expect(store.using('warm-paper')).toBe(false)
    // Whatever it was showing is gone, so it goes back to the built-in rather
    // than to a theme that is not there.
    expect(theme.id).toBe('default')
  })

  test('what the theme asked for and did not get is kept to be said', async () => {
    serving([entry()], `${sheet('#faf6ee')}\n.sidebar { display: none; }`)
    await store.load()
    await store.install(entry({}) as never)

    expect(store.refused).toEqual({
      id: 'warm-paper',
      notes: ['.sidebar is not a selector a theme may set'],
    })
    expect(folder.files.get('warm-paper')).not.toContain('sidebar')
  })

  test('a theme with nothing a theme may set is not installed', async () => {
    serving([entry()], '.sidebar { display: none; }')
    await store.load()
    await store.install(entry({}) as never)

    expect(folder.files.size).toBe(0)
    expect(store.error).toBe('that theme has nothing a theme may set')
  })

  test('a stylesheet that will not arrive leaves the folder alone', async () => {
    serving([entry()])
    await store.load()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })))

    await store.install(entry({}) as never)

    expect(folder.files.size).toBe(0)
    expect(store.error).toBe('could not fetch that theme')
  })

  test('a theme somebody dropped in by hand does not belong to the store', async () => {
    folder.files.set('night-owl', sheet('#001122'))
    await theme.reload()

    expect(theme.files).toHaveLength(1)
    expect(store.installed('night-owl')).toBe(false)
  })
})

/** The one control a theme can take away. Its own block because the answer is
 *  the theme's rather than the store's: what the switch does depends entirely on
 *  how many schemes the theme in force states. */
describe('the light and dark switch', () => {
  test('is live on the built-in, which states both schemes', () => {
    expect(theme.switchable).toBe(true)

    theme.setScheme('dark')
    expect(theme.switchable).toBe(true)

    theme.toggle()
    expect(theme.current).toBe('light')
  })

  test('is dead on a theme file that states one scheme, and switches nothing', async () => {
    serving([entry()])
    await store.load()
    await store.install(entry({}) as never)

    expect(theme.switchable).toBe(false)

    theme.toggle()

    // Above all not swapped for the built-in dark: somebody who chose this theme
    // did not ask for ours.
    expect(store.using('warm-paper')).toBe(true)
    expect(theme.current).toBe('light')
  })

  test('is live on a theme file that states both', async () => {
    const pair = entry({ variants: ['light', 'dark'] })
    serving([pair], PAIR)
    await store.load()
    await store.install(pair as never)

    expect(theme.switchable).toBe(true)

    // Whichever side it opened on, the switch shows the other one, and the theme
    // is still the theme.
    const was = theme.current
    theme.toggle()

    expect(theme.current).not.toBe(was)
    expect(store.using('warm-paper')).toBe(true)
  })

  test('comes back when a theme with one scheme is removed', async () => {
    serving([entry()])
    await store.load()
    await store.install(entry({}) as never)
    expect(theme.switchable).toBe(false)

    await store.remove('warm-paper')

    expect(theme.switchable).toBe(true)
  })
})
