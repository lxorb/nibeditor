import { glassCss } from '@nib/themes/glass'
import { wallpaperCss } from '@nib/themes/wallpaper'
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
/** What the cascade would answer for a custom property, which is where a theme's
 *  own declarations are read from, and what the app wrote onto the root, which is
 *  where its answers go. Two halves of one page; see themes/settings.ts. */
let resolves: Record<string, string> = {}
let painted: Record<string, string> = {}
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
  resolves = {}
  painted = {}
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
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => resolves[name] ?? '',
  }))
  vi.stubGlobal('document', {
    documentElement: {
      dataset,
      style: {
        setProperty: (name: string, value: string) => {
          painted[name] = value
        },
        removeProperty: (name: string) => {
          painted = Object.fromEntries(Object.entries(painted).filter(([one]) => one !== name))
        },
      },
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

/** Which system the window is on, and what the crate was asked about the material
 *  behind it and answered. Windows unless a test says otherwise: glass is offered
 *  where there is a material for it to stand on. */
interface Host {
  platform: string
  material: string | null
  asked: { on: boolean; dark: boolean; said?: string | undefined }[]
}

const host = vi.hoisted((): Host => ({ platform: 'windows', material: 'mica', asked: [] }))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  platform: () => host.platform,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'set_translucency') {
      // With what the page was saying as it asked, which is the order that matters.
      host.asked.push({ on: args.on === true, dark: args.dark === true, said: dataset.translucent })
      if (args.on !== true) return Promise.resolve('')
      return host.material ? Promise.resolve(host.material) : Promise.reject(new Error('none'))
    }

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
const { stamped } = await import('./themes/stamp')

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
  host.platform = 'windows'
  host.material = 'mica'
  host.asked = []
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  theme.offerContrast = false
})

describe('what the dropdown offers', () => {
  test('is the four the app ships with, and then what is installed', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    expect(theme.all.map((one) => one.id)).toEqual([
      'default',
      'contrast',
      'glass',
      'wallpaper',
      'file:rose',
      'file:warm-paper',
    ])
    expect(theme.all[0]?.name).toBe('Default')
    expect(theme.all[1]?.name).toBe('High contrast')
    expect(theme.all[2]?.name).toBe('Glass')
  })

  test('and never a Dark or a Light, which were the scheme wearing a theme name', async () => {
    await theme.reload()

    expect(theme.all.map((one) => one.id)).not.toContain('dark')
    expect(theme.all.map((one) => one.id)).not.toContain('light')
    expect(theme.all).toHaveLength(4)
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
    // showed. Read off the sheet by `paintsOver` rather than written down beside it.
    expect(found?.css).toMatch(/--accent\s*:/)
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

  test('and is written back in the new spelling, so nothing reads the old one twice', () => {
    kept.setItem('nib:theme', 'light')
    theme.init()

    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('light')
  })

  test('a scheme already written down outranks either of those', () => {
    kept.setItem('nib:theme', 'dark')
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
    expect(theme.all).toHaveLength(6)
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

/** The theme picker tries a look on the whole app while it is pointed at, and a
 *  try is a frame's work: the sheet a file theme is painted with is the one the
 *  folder was read for, not a second read, and nothing is written down. */
describe('a look shown and not kept', () => {
  test('paints a file theme in the frame it is asked for, with no read in between', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    // A read now would come back empty; a sheet already held does not need one.
    folder.reading = false
    theme.select('file:rose')

    expect(injected()).toContain('--bg: #000')
  })

  test('is on the page and in the store, and nowhere in the storage', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('default')
    theme.setScheme('dark')
    theme.setAccent('violet')

    theme.preview('file:rose', 'light', 'teal')

    expect(theme.id).toBe('file:rose')
    expect(dataset.theme).toBe('light')
    expect(injected()).toContain('--bg: #fff')
    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('dark')
    expect(theme.accent).toBe('teal')
    expect(kept.getItem('nib:theme-settings')).toBe(JSON.stringify({ '*': { accent: 'violet' } }))
  })

  test('and showing the kept one again is the kept one exactly', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('default')
    theme.setScheme('system')

    theme.preview('file:rose', 'dark', 'teal')
    theme.preview('default', 'system', 'violet')

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
    expect(theme.accent).toBe('violet')
    // Following the system again, which is asking for the dark.
    expect(dataset.theme).toBe('dark')
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

    expect(theme.all.map((one) => one.name)).toEqual([
      'Default',
      'High contrast',
      'Glass',
      'Wallpaper',
      'Rose',
    ])
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

/** Whatever a stylesheet was fetched for is on the page by now. The glass theme's
 *  sheet arrives through a dynamic import, which is a promise however local it is. */
const settled = async (done?: () => boolean) => {
  // Polled rather than counted in turns: what is being waited for is a dynamic
  // import - the glass theme's stylesheet, or the grammar a theme declares its
  // settings in - and how many turns one of those takes is the machine's
  // business. A fixed number of microtasks passed alone and failed under a full
  // suite, which is the worst kind of test there is.
  for (let turn = 0; turn < 400; turn++) {
    await new Promise((next) => setTimeout(next, 1))
    if (!done || done()) return
  }
}

/** A theme that declares one dial of its own, and the answer the cascade would
 *  give for it. Both halves, because a declaration is a name in the file and a
 *  value on the page; see themes/settings.ts. */
const DIALLED = `:root { --nib-setting-warmth: range "Warmth" 0 100 40 %; }`
const WARMTH = { '--nib-setting-warmth': 'range "Warmth" 0 100 40 %' }

describe('the settings a theme offers', () => {
  test('are the app’s own on a theme that brings no palette of its own', () => {
    theme.init()

    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(theme.accentIsTheme).toBe(false)
  })

  test('and one choice among them paints every token that depends on it', () => {
    theme.init()
    theme.setAccent('teal')

    expect(theme.accent).toBe('teal')
    expect(painted['--accent']).toBe('#33c7ba')
    // Six and not one: the hover, the press, the wash, the rule and the selection
    // move with the colour, which is the whole reason a setting paints a map.
    expect(Object.keys(painted).sort()).toEqual([
      '--accent',
      '--accent-hover',
      '--accent-line',
      '--accent-press',
      '--accent-soft',
      '--selection',
    ])
  })

  test('are withdrawn where the theme paints their tokens itself', async () => {
    theme.init()
    theme.setAccent('teal')
    theme.select('contrast')
    await settled()

    expect(theme.settings).toEqual([])
    expect(theme.accentIsTheme).toBe(true)
    // And taken off the page with the row: a theme chosen from a picture of
    // itself must not be wearing the last theme's colour.
    expect(painted).toEqual({})
  })

  test('and come back, still on the colour that was chosen, when the theme does', async () => {
    theme.init()
    theme.setAccent('teal')
    theme.select('contrast')
    await settled()
    theme.select('default')
    await settled()

    expect(theme.accent).toBe('teal')
    expect(painted['--accent']).toBe('#33c7ba')
  })

  test('follow the reader from one theme to the next, because the accent is the app’s', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.init()
    theme.setAccent('pink')

    theme.select('file:rose')
    await settled()

    // Rose states no accent, so it inherits the app's - and inherits the answer
    // with it. A setting a theme declares is that theme's and is filed under it.
    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(theme.accent).toBe('pink')
  })

  test('include whatever the theme declared, after its own sheet is on the page', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)

    expect(theme.settings.map((one) => one.id)).toEqual(['accent', 'warmth'])
    expect(theme.values.warmth).toBe(40)
    expect(painted['--nib-warmth']).toBe('40%')
  })

  test('are kept when the theme is switched away from, and found again when it is back', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    theme.set('warmth', 75)

    theme.select('default')
    await settled()
    expect(painted['--nib-warmth']).toBeUndefined()

    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    expect(theme.values.warmth).toBe(75)
    expect(painted['--nib-warmth']).toBe('75%')
  })

  test('and a setting the theme has stopped offering is simply not read', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    theme.set('warmth', 75)

    // The theme is updated and the dial is gone. Nothing is thrown away: what was
    // chosen stays written down, so a theme that brings the dial back - or a
    // reader who puts the older file back - finds the answer still there.
    folder.files.clear()
    installed('warm', 'Warm', ':root { --bg: #201510; }')
    resolves = {}
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length === 1)

    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(painted['--nib-warmth']).toBeUndefined()

    folder.files.clear()
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)

    expect(theme.values.warmth).toBe(75)
  })

  test('read the accent an older device wrote under a key of its own', () => {
    kept.setItem('nib:accent', 'orange')
    theme.init()

    expect(theme.accent).toBe('orange')
    expect(painted['--accent']).toBe('#f08437')
  })

  test('and what this one writes outranks it, so the key is read once and never again', () => {
    kept.setItem('nib:accent', 'orange')
    theme.init()
    theme.setAccent('green')
    theme.init()

    expect(theme.accent).toBe('green')
  })
})

describe('the glass theme', () => {
  // The material is fetched by the store the first time a theme asks for it, and keeps
  // what it last asked for; a fresh one per test, as each launch has.
  beforeEach(() => {
    vi.resetModules()
  })

  test('is fetched rather than carried, so its bytes are not in front of a launch', () => {
    const found = theme.all.find((one) => one.id === 'glass')

    expect(found?.path).toBeUndefined()
    expect(typeof found?.load).toBe('function')
  })

  test('is offered on every platform, with a material to stand on or without one', () => {
    for (const [platform, offered] of [
      ['windows', true],
      ['macos', true],
      ['linux', true],
    ] as const) {
      host.platform = platform
      // The list is derived; asking it again is enough once the platform has moved.
      theme.files = [...theme.files]
      expect(
        theme.all.some((one) => one.id === 'glass'),
        platform,
      ).toBe(offered)
    }
  })

  test('but is still worn by its id where it is not offered, which is how a drive shows it', async () => {
    host.platform = 'linux'
    theme.files = [...theme.files]
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))

    expect(theme.id).toBe('glass')
  })

  test('puts its sheet on the page and keeps the reader’s accent beside it', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))

    expect(injected()).toBe(glassCss)
    // No accent of its own: glass is a window and not a palette, so the row of
    // swatches stays and the reader's colour shows on it.
    // Kept inside a part of the frame in the other scheme, rather than stated.
    expect(glassCss).not.toMatch(/--accent\s*:(?!\s*inherit)/)
    expect(theme.accentIsTheme).toBe(false)
  })

  test('stands the window on the material, and says so on the root once the crate has', async () => {
    theme.init()
    theme.setScheme('dark')
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)

    // The material first, and the page says so only once the crate has answered.
    expect(host.asked.at(-1)).toEqual({ on: true, dark: true, said: undefined })
    expect(dataset.translucent).toBe('mica')
    expect(kept.getItem('nib:material')).toBe('mica')
  })

  test('and asks again in the other scheme, which is what Mica is tinted by', async () => {
    theme.init()
    theme.setScheme('dark')
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)
    theme.setScheme('light')
    await settled()

    expect(host.asked.at(-1)).toMatchObject({ on: true, dark: false })
  })

  test('where there is nothing to stand on, stands on its own ground and says nothing', async () => {
    host.material = null
    theme.init()
    theme.select('glass')
    await settled(() => host.asked.length > 0)
    await settled()

    expect(dataset.translucent).toBeUndefined()
    expect(kept.getItem('nib:material')).toBeNull()
  })

  test('takes the ground back before the material when another theme is chosen', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)
    theme.select('default')
    await settled(() => host.asked.at(-1)?.on === false)

    // Before the crate is asked: a page with a transparent ground and no material
    // under it is somebody's desk behind the words.
    expect(host.asked.at(-1)).toEqual({ on: false, dark: true, said: undefined })
    expect(dataset.translucent).toBeUndefined()
    expect(kept.getItem('nib:material')).toBeNull()
  })

  test('a launch that cannot tell what it stood on asks for the material off', async () => {
    // Storage cleared under a crate that put the material back from its own file.
    theme.init()
    await settled(() => host.asked.length > 0)

    expect(host.asked).toEqual([{ on: false, dark: true, said: undefined }])
  })

  test('and one that stood on a colour asks nothing at all', async () => {
    kept.setItem('nib:ground', 'rgb(14, 16, 19)')
    theme.init()
    // As long as an ask would take to arrive, and then some.
    await settled(() => host.asked.length > 0)

    expect(host.asked).toEqual([])
  })

  test('is shown as glass by the picker, and pointing away gives the window back', async () => {
    theme.init()
    await theme.reload()
    theme.preview('glass', 'dark', 'violet')
    await settled(() => dataset.translucent !== undefined)
    expect(dataset.translucent).toBe('mica')

    theme.preview('default', 'dark', 'violet')
    await settled(() => dataset.translucent === undefined)
    expect(dataset.translucent).toBeUndefined()
    // Shown, not kept: nothing about the material is written down for a launch.
    expect(kept.getItem('nib:material')).toBeNull()
  })

  test('opens a launch in the sheet it wore last time, before its own chunk is in', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected() === glassCss)

    // A launch: a page with nothing on it, and the storage the last one left.
    const storage = kept
    stubs()
    kept = storage
    vi.stubGlobal('localStorage', kept)
    theme.id = 'default'
    theme.init()

    // On the frame the launch paints, with no promise in between.
    expect(injected()).toBe(glassCss)
  })

  test('hands its sheet to the picker, which draws its card from it', async () => {
    theme.warm()
    await settled(() => theme.all.find((one) => one.id === 'glass')?.css !== undefined)

    expect(theme.all.find((one) => one.id === 'glass')?.css).toBe(glassCss)
  })
})

describe('the wallpaper theme', () => {
  /** What a chosen picture leaves written down; see wallpaper/held.ts. */
  const HELD = {
    picture: 'data:image/png;base64,iVBORw0KGgo=',
    blur: 28,
    dark: { floor: 0.52, ground: '#202630' },
    light: { floor: 0.61, ground: '#e9ecf2' },
  }

  // The store is one for the whole file, and keeps the sheet it fetched last.
  beforeEach(() => theme.rewear('wallpaper'))

  test('is offered everywhere, since the page draws it rather than the platform', () => {
    for (const platform of ['windows', 'macos', 'linux', 'android', 'ios']) {
      host.platform = platform
      theme.files = [...theme.files]
      expect(
        theme.all.some((one) => one.id === 'wallpaper'),
        platform,
      ).toBe(true)
    }
  })

  test('is fetched rather than carried, and with nothing chosen is its sheet alone', async () => {
    const found = theme.all.find((one) => one.id === 'wallpaper')
    expect(found?.path).toBeUndefined()
    expect(typeof found?.load).toBe('function')

    theme.init()
    theme.select('wallpaper')
    await settled(() => injected() === wallpaperCss)

    expect(injected()).toBe(wallpaperCss)
    // The reader's accent stays theirs: the field without a picture is made of it.
    expect(wallpaperCss).not.toMatch(/--accent\s*:/)
    expect(theme.accentIsTheme).toBe(false)
  })

  test('says the picture written down after its own sheet, with both floors', async () => {
    kept.setItem('nib:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.select('wallpaper')
    await settled(() => injected().includes('--wallpaper-picture:'))

    expect(injected().startsWith(wallpaperCss)).toBe(true)
    expect(injected()).toContain(`--wallpaper-picture: url("${HELD.picture}");`)
    expect(injected()).toContain('--wallpaper-floor-dark: 52%;')
    expect(injected()).toContain('--wallpaper-floor-light: 61%;')
  })

  test('opens a launch on its picture, before any chunk is in', async () => {
    kept.setItem('nib:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.select('wallpaper')
    await settled(() => injected().includes('--wallpaper-picture:'))

    const storage = kept
    stubs()
    kept = storage
    vi.stubGlobal('localStorage', kept)
    theme.id = 'default'
    theme.init()

    // On the frame the launch paints: the early sheet is the picture as well.
    expect(injected()).toContain(`url("${HELD.picture}")`)
  })

  test('wears a new picture when it is read again, and keeps its dials meanwhile', async () => {
    resolves['--nib-setting-blur'] = 'range Blur 12 60 28 px'
    resolves['--nib-setting-dim'] = 'range Dim 0 90 10 %'
    theme.init()
    theme.select('wallpaper')
    await settled(() => theme.settings.some((one) => one.id === 'dim'))

    kept.setItem('nib:wallpaper', JSON.stringify(HELD))
    theme.rewear('wallpaper')
    // The Blur row is under the reader's pointer while this happens.
    expect(theme.settings.some((one) => one.id === 'blur')).toBe(true)
    await settled(() => injected().includes('--wallpaper-picture:'))
    expect(theme.settings.map((one) => one.id)).toEqual(['accent', 'blur', 'dim'])
  })

  test('is shown by the picker as it would be, and pointing away keeps nothing', async () => {
    kept.setItem('nib:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.preview('wallpaper', 'dark', 'violet')
    await settled(() => injected().includes('--wallpaper-picture:'))

    theme.preview('default', 'dark', 'violet')
    await settled(() => injected() === '')
    expect(kept.getItem('nib:theme')).not.toBe('wallpaper')
  })

  test('declares its two dials, which Appearance draws under the Style row', async () => {
    resolves['--nib-setting-blur'] = 'range Blur 12 60 28 px'
    resolves['--nib-setting-dim'] = 'range Dim 0 90 10 %'
    theme.init()
    theme.select('wallpaper')
    await settled(() => theme.settings.some((one) => one.id === 'dim'))

    expect(theme.settings.map((one) => one.id)).toEqual(['accent', 'blur', 'dim'])
    theme.set('dim', 35)
    expect(painted['--nib-dim']).toBe('35%')
    expect(theme.keptFor('wallpaper', 'dim')).toBe(35)
  })
})

/** What a reader who had the old switch on is given, once; see modes.svelte.ts, which
 *  asks. */
describe('translucency, which was a switch before it was glass', () => {
  test('under the built-in theme is glass', () => {
    theme.init()
    theme.adoptTranslucency()

    expect(theme.id).toBe('glass')
    expect(kept.getItem('nib:theme')).toBe('glass')
  })

  test('under a theme somebody chose is that theme still', () => {
    theme.init()
    theme.select('contrast')
    theme.adoptTranslucency()

    expect(theme.id).toBe('contrast')
  })

  test('and where there is no material at all is nothing', () => {
    host.platform = 'linux'
    theme.init()
    theme.adoptTranslucency()

    expect(theme.id).toBe('default')
  })
})
