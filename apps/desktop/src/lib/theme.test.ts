import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The theme and the scheme, which are two choices and not one.
 *
 *  A theme has a dark side or a light one or both; which of them the app is
 *  showing is a choice beside it. These are about that separation: what the
 *  dropdown offers, what the scheme is when the theme in force cannot show the one
 *  that was asked for, what an older device's storage means, and what happens to
 *  the list when the themes folder will not answer.
 *
 *  Run against the real store with the folder, the storage and the page stood in
 *  for: under node there is none of the three. */

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

let kept = memoryStorage()

/** What the system is asking for, and whoever asked to be told when it changes.
 *  Two questions and not one: a room that is light and a reader who needs more
 *  contrast have nothing to do with each other, and the stub answered both with
 *  `light` until the second one had a consequence. */
const media = {
  light: false,
  contrast: false,
  listeners: [] as ((event: { matches: boolean }) => void)[],
}

/** What the page says it is wearing. Held here rather than reached for through
 *  the stubbed document, so a test can read it the way it reads the storage. */
let dataset: Record<string, string> = {}
/** The last `<style>` the app made, so a test can read what it put on the page. */
let style: { id: string; textContent: string; remove: () => void } | null = null

/** The system changes its mind, which is what following it has to notice. */
function systemPrefers(light: boolean) {
  media.light = light
  for (const listener of media.listeners) listener({ matches: light })
}

function stubs() {
  kept = memoryStorage()
  media.light = false
  media.contrast = false
  media.listeners = []
  dataset = {}
  style = null

  vi.stubGlobal('localStorage', kept)
  vi.stubGlobal('window', {
    // Answered by which question was asked. A blind stub made every test that
    // arranged a light room into a test of the contrast query as well.
    matchMedia: (query: string) => ({
      get matches() {
        return query.includes('contrast') ? media.contrast : media.light
      },
      addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) =>
        void media.listeners.push(listener),
    }),
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal('document', {
    documentElement: {
      dataset,
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => {
      style = { id: '', textContent: '', remove: () => undefined }
      return style
    },
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

/** The stylesheet the app put on the page, which is how a built-in theme that brings
 *  its own palette is told from one that has a file to read. */
function injected(): string {
  return style?.textContent ?? ''
}

stubs()

/** The themes folder, as the commands see it, and whether reading it works at
 *  all: a browser that refuses storage and a page asking for a chunk that is no
 *  longer served both come back here as a rejection. */
const folder = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listing: true,
  reading: true,
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'list_themes') {
      if (!folder.listing) return Promise.reject(new Error('no such folder'))

      return Promise.resolve(
        [...folder.files.keys()].map((id) => ({
          id: `file:${id}`,
          name: id,
          path: `/themes/${id}.css`,
        })),
      )
    }

    if (command === 'read_theme') {
      if (!folder.reading) return Promise.reject(new Error('cannot read'))

      const id = /\/themes\/(.*)\.css$/.exec(String(args.path))?.[1] ?? ''
      return Promise.resolve(folder.files.get(id) ?? '')
    }

    return Promise.resolve('')
  },
}))

vi.mock('./insets', () => ({ tintSystemBars: () => undefined }))

const { theme } = await import('./theme.svelte')
const { stamped } = await import('./themes/validate')

/** A theme that states both schemes, and one that states a single one. */
const PAIR = `[data-theme=light] { --bg: #fff; }\n[data-theme=dark] { --bg: #000; }`
const ONLY_LIGHT = `[data-theme=light] { color-scheme: light; --bg: #fff; }`

function installed(id: string, name: string, css: string, version = '1.0.0') {
  folder.files.set(id, stamped({ id, name, author: 'Nib', version }, css))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubs()

  folder.files.clear()
  folder.listing = true
  folder.reading = true
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  theme.offerContrast = false
})

describe('what the dropdown offers', () => {
  test('is the two the app ships with, and then what is installed', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    expect(theme.all.map((one) => one.id)).toEqual([
      'default',
      'contrast',
      'file:rose',
      'file:warm-paper',
    ])
    expect(theme.all[0]?.name).toBe('Default')
    expect(theme.all[1]?.name).toBe('High contrast')
  })

  test('and never a Dark or a Light, which were the scheme wearing a theme name', async () => {
    await theme.reload()

    expect(theme.all.map((one) => one.id)).not.toContain('dark')
    expect(theme.all.map((one) => one.id)).not.toContain('light')
    expect(theme.all).toHaveLength(2)
  })

  /** High contrast is a mode in every sense that matters and a theme in the way it is
   *  built, which is what keeps it out of every other theme's way. It carries its own
   *  stylesheet, so a first launch with no network can still be answered with it. */
  test('the built-in contrast theme brings its own palette rather than a file', () => {
    const found = theme.all.find((one) => one.id === 'contrast')

    expect(found?.path).toBeUndefined()
    expect(found?.css).toContain("[data-theme='light']")
    expect(found?.css).toContain("[data-theme='dark']")
    expect(found?.variants).toEqual(['dark', 'light'])
    // Its own accent, so the reader's colour is not painted over the palette the row
    // showed; see `paintAccent`.
    expect(found?.ownAccent).toBe(true)
  })

  test('and choosing it puts its palette on the page with nothing to fetch', () => {
    theme.select('contrast')

    expect(theme.id).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
    expect(theme.accentIsTheme).toBe(true)
  })

  test('the built-in carries both schemes, so it is one theme and not two', () => {
    expect(theme.active.variants).toEqual(['dark', 'light'])
    expect(theme.switchable).toBe(true)
  })
})

describe('the scheme, which is not a theme', () => {
  test('follows the system until something says otherwise, and keeps following it', () => {
    theme.init()

    expect(theme.scheme).toBe('system')
    expect(theme.current).toBe('dark')

    systemPrefers(true)
    expect(theme.current).toBe('light')
  })

  test('stops following it once one of the two is asked for', () => {
    theme.init()
    theme.setScheme('dark')

    systemPrefers(true)
    expect(theme.current).toBe('dark')
  })

  test('is not touched by choosing a theme', async () => {
    theme.init()
    theme.setScheme('light')
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    theme.select('file:rose')

    expect(theme.id).toBe('file:rose')
    expect(theme.scheme).toBe('light')
    expect(theme.current).toBe('light')
  })

  test('is written down under a key of its own, so it travels beside the theme', () => {
    theme.init()
    theme.setScheme('dark')

    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('dark')
  })
})

describe('a theme with one scheme', () => {
  test('shows the scheme it has, whatever was asked for', async () => {
    theme.init()
    theme.setScheme('dark')
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    theme.select('file:warm-paper')

    expect(theme.current).toBe('light')
    // The choice itself is untouched, so the theme it was made for still has it.
    expect(theme.scheme).toBe('dark')
  })

  test('offers neither the other scheme nor the system, which would ask for it', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    expect(theme.offers('light')).toBe(true)
    expect(theme.offers('dark')).toBe(false)
    expect(theme.offers('system')).toBe(false)
  })

  test('leaves the control pointing at the scheme it has and not at one it lacks', async () => {
    theme.init()
    theme.setScheme('dark')
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    theme.select('file:warm-paper')
    expect(theme.shown).toBe('light')

    // And the choice comes back with a theme that can honour it.
    theme.select('default')
    expect(theme.shown).toBe('dark')
  })

  test('refuses a scheme it cannot show rather than showing ours instead', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    theme.setScheme('dark')

    expect(theme.current).toBe('light')
    expect(theme.id).toBe('file:warm-paper')
  })

  test('is not switched by the panel foot, which has nowhere to switch it to', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    expect(theme.switchable).toBe(false)
    theme.toggle()

    expect(theme.current).toBe('light')
    expect(theme.id).toBe('file:warm-paper')
  })
})

describe('the switch in the panel foot', () => {
  test('flips the scheme and leaves the theme where it is', async () => {
    theme.init()
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    const was = theme.current
    theme.toggle()

    expect(theme.current).not.toBe(was)
    expect(theme.id).toBe('file:rose')
  })

  test('turns following the system into a choice, since that is what a press is', () => {
    theme.init()
    expect(theme.scheme).toBe('system')

    theme.toggle()

    expect(theme.scheme).toBe('light')
  })
})

/** Dark, Light and Match the system were rows in the theme dropdown, and the
 *  side of a theme that stated both was kept on its own. Every one of those means
 *  the built-in theme and a scheme, and a device that has not been opened since
 *  has to come up saying what it said before. */
describe('what an older device wrote down', () => {
  test('a theme of dark means Default, in the dark', () => {
    kept.setItem('nib:theme', 'dark')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('dark')
    expect(theme.current).toBe('dark')
  })

  test('a theme of light means Default, in the light', () => {
    kept.setItem('nib:theme', 'light')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('light')
  })

  test('a theme of system means Default, following the system', () => {
    kept.setItem('nib:theme', 'system')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
  })

  test('nothing written down at all means the same', () => {
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
  })

  test('the side of a theme that stated both is that theme and that scheme', () => {
    kept.setItem('nib:theme', 'file:rose')
    kept.setItem('nib:theme-side', 'light')
    theme.init()

    expect(theme.id).toBe('file:rose')
    expect(theme.scheme).toBe('light')
  })

  test('and is written back in the new spelling, so nothing reads the old one twice', () => {
    kept.setItem('nib:theme', 'light')
    theme.init()

    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('light')
  })

  test('a scheme already written down outranks either of those', () => {
    kept.setItem('nib:theme', 'dark')
    kept.setItem('nib:theme-side', 'dark')
    kept.setItem('nib:theme-scheme', 'system')
    theme.init()

    expect(theme.scheme).toBe('system')
  })
})

/** The bug: themes installed from the store went missing from the dropdown.
 *
 *  Nothing had deleted them. One failed read of the folder emptied the list, and
 *  because the theme in force was then not in it, the choice was written away as
 *  though the file had been deleted - so it did not come back on the next launch
 *  either. A folder that will not answer says nothing about what is in it. */
describe('a folder that will not answer', () => {
  test('leaves the themes already found where they are', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    expect(theme.files).toHaveLength(2)

    folder.listing = false
    await theme.reload()

    expect(theme.files.map((one) => one.name)).toEqual(['Rose', 'Warm Paper'])
    expect(theme.all).toHaveLength(4)
  })

  test('does not write the chosen theme away as though it had been deleted', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    folder.listing = false
    await theme.reload()

    expect(theme.id).toBe('file:rose')
    expect(kept.getItem('nib:theme')).toBe('file:rose')
  })

  test('and a folder that does answer still notices a theme that is gone', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    folder.files.delete('rose')
    await theme.reload()

    expect(theme.id).toBe('default')
    expect(theme.files).toEqual([])
  })

  test('a file that lists but will not read keeps the name and version it had', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    await theme.reload()

    folder.reading = false
    await theme.reload()

    expect(theme.files[0]?.name).toBe('Rose')
    expect(theme.files[0]?.variants).toEqual(['light', 'dark'])
    expect(theme.installed.get('rose')?.stamp?.version).toBe('2.0.0')
  })
})

describe('an installed theme across a restart', () => {
  test('is in the dropdown, under its own name, still chosen', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    kept.setItem('nib:theme', 'file:rose')
    kept.setItem('nib:theme-scheme', 'light')

    // What a launch does: read what was written down, then read the folder.
    theme.init()
    await theme.reload()

    expect(theme.all.map((one) => one.name)).toEqual(['Default', 'High contrast', 'Rose'])
    expect(theme.id).toBe('file:rose')
    expect(theme.current).toBe('light')
    expect(theme.installed.has('rose')).toBe(true)
  })
})

/** Contrast was a switch beside the mode, with a palette of its own painted over
 *  whichever theme was in force. It is a theme the app ships with now, which leaves
 *  the launch one thing to do about it: a reader whose system asks for more contrast is
 *  answered with it, once, and shown where it was chosen so putting it back is one
 *  press. Nothing is fetched, because the launch that needs it most is a first one. */
describe('answering a system that asks for more contrast', () => {
  test('is made to a fresh install whose system asks for more contrast', () => {
    media.contrast = true
    theme.init()

    expect(theme.offerContrast).toBe(true)
  })

  test('and to nobody whose system is not asking', () => {
    theme.init()

    expect(theme.offerContrast).toBe(false)
    // Nothing written down, on purpose: a system that starts asking next month
    // still gets the one offer.
    expect(kept.getItem('nib:contrast-offered')).toBe(null)
  })

  test('once, and never again however it was answered', () => {
    media.contrast = true
    theme.init()
    expect(theme.offerContrast).toBe(true)
    expect(kept.getItem('nib:contrast-offered')).toBe('yes')

    // A second launch, on a machine still asking for it.
    theme.offerContrast = false
    theme.init()

    expect(theme.offerContrast).toBe(false)
  })

  test('to a reader who had the switch on, so their contrast goes nowhere in silence', () => {
    kept.setItem('nib:contrast', 'on')
    theme.init()

    expect(theme.offerContrast).toBe(true)
    // Read once, and the key the switch wrote goes with the switch.
    expect(kept.getItem('nib:contrast')).toBe(null)
  })

  test('and never to one who turned the switch off, which was them answering it', () => {
    kept.setItem('nib:contrast', 'off')
    media.contrast = true
    theme.init()

    expect(theme.offerContrast).toBe(false)
    expect(kept.getItem('nib:contrast')).toBe(null)
    expect(kept.getItem('nib:contrast-offered')).toBe('yes')
  })

  test('with the theme itself, chosen and written down', () => {
    media.contrast = true
    theme.init()

    expect(theme.id).toBe('contrast')
    expect(kept.getItem('nib:theme')).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
  })

  test('and never over a theme the reader had already chosen for themselves', async () => {
    // A reader who has a theme has answered the question about how their screen looks.
    // The offer is for a fresh install, and a launch that repainted somebody's chosen
    // look because their system asks for contrast would be the app overruling them.
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')
    media.contrast = true

    theme.init()

    expect(theme.offerContrast).toBe(false)
    expect(theme.id).toBe('file:rose')
  })

  test('and nothing paints contrast onto the page, which a theme does for itself', () => {
    media.contrast = true
    theme.init()

    expect(dataset.theme).toBe('dark')
    expect('contrast' in dataset).toBe(false)
  })
})
