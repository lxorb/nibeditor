import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest'
import type { Pane } from './preferences'

/** The declarations the settings panes are drawn from.
 *
 *  What is checked here is the shape of the list rather than the markup: which
 *  setting carries a sentence about itself, what the two controls in Appearance
 *  offer, and what the second of them points at when the theme in force cannot
 *  show the scheme that was asked for. The panel draws one row per entry and
 *  nothing else decides any of it. */

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

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded at module scope: the pane list reaches half the app, and compiling
 *  that belongs to no single test. See docs/conventions.md. */
const { preferences, resettable } = await import('./preferences')
const { LANGUAGES } = await import('./i18n.svelte')
const { theme } = await import('./theme.svelte')

const panes = preferences()
const pane = (id: string) => {
  const found = panes.find((one) => one.id === id)
  if (!found) throw new Error(`no ${id} pane`)
  return found
}

const fieldsOf = (id: string) => pane(id).groups.flatMap((group) => group.fields)

const field = (paneId: string, label: string) => {
  const found = fieldsOf(paneId).find((one) => one.label === label)
  if (!found) throw new Error(`no ${label} on ${paneId}`)
  return found
}

/** One plain sentence, which is all a tooltip has room for. Its own function so
 *  that the row only the desktop shows is held to the same rule. */
function readsAsOneSentence(hint: string, label: string) {
  expect(hint, label).toMatch(/\.$/)
  expect(hint.length, label).toBeLessThan(110)
  // One sentence: a full stop only at the end of it. Numbered examples spell the
  // numbers with their own stops, which is not a second sentence.
  expect(hint.replace(/\d\.(\d)?/g, ''), label).toMatch(/^[^.]*\.$/)
}

/** The `i` beside a label: for the settings whose name only means something to
 *  somebody who already knows the word. */
describe('the sentence behind a setting', () => {
  /** Each with the pane it is in, and in the order the panes offer them: how a link
   *  is written is a setting about the editor and sits there, and the rest are about
   *  the markdown itself. */
  const HINTED: readonly (readonly [pane: string, label: string])[] = [
    ['editor', 'New links'],
    ['markdown', 'Strict CommonMark'],
    ['markdown', 'Smart punctuation'],
    ['markdown', 'A single newline breaks the line'],
    ['markdown', 'Front matter'],
    ['markdown', 'Number headings'],
    ['markdown', 'Number equations'],
  ]

  test('is there for the settings a word does not explain', () => {
    for (const [pane, label] of HINTED) {
      expect(field(pane, label).hint, label).toBeTruthy()
    }
  })

  test('and for no other setting, because a name that explains itself needs none', () => {
    const hinted = panes
      .flatMap((one) => one.groups.flatMap((group) => group.fields))
      .filter((one) => one.hint)
      .map((one) => one.label)

    expect(hinted).toEqual(HINTED.map(([, label]) => label))
  })

  test('is one plain sentence, which is all a tooltip has room for', () => {
    for (const [pane, label] of HINTED) {
      readsAsOneSentence(field(pane, label).hint ?? '', label)
    }
  })
})

describe('the Appearance pane', () => {
  test('chooses the theme with a dropdown, the built-in first', () => {
    const one = field('appearance', 'Style')
    if (one.kind !== 'select') throw new Error('the theme is a dropdown')

    expect(one.options[0]).toEqual({ value: 'default', label: 'Default' })
    expect(one.options.map((option) => option.value)).not.toContain('dark')
    expect(one.options.map((option) => option.value)).not.toContain('light')
  })

  test('and the scheme with the segmented control the app already has', () => {
    const one = field('appearance', 'Mode')
    if (one.kind !== 'segmented') throw new Error('the mode is a segmented control')

    expect(one.options).toEqual([
      { value: 'system', label: 'System', disabled: false },
      { value: 'dark', label: 'Dark', disabled: false },
      { value: 'light', label: 'Light', disabled: false },
    ])
    expect(one.get()).toBe('system')
  })

  test('disables the segments the theme in force cannot show', () => {
    theme.files = [
      { id: 'file:warm-paper', name: 'Warm Paper', variants: ['light'], path: '/warm-paper.css' },
    ]
    theme.id = 'file:warm-paper'

    try {
      const one = preferences()
        .flatMap((pane) => pane.groups.flatMap((group) => group.fields))
        .find((entry) => entry.label === 'Mode')
      if (one?.kind !== 'segmented') throw new Error('the mode is a segmented control')

      // Following the system and the dark it does not have are both off; the one
      // scheme it does state is the one segment left.
      expect(one.options.map((option) => option.disabled)).toEqual([true, true, false])
      // And it points at the one the theme has rather than at a scheme it lacks.
      expect(one.get()).toBe('light')
    } finally {
      theme.files = []
      theme.id = 'default'
    }
  })

  test('offers no reset, since neither row is a default anybody drifted from', () => {
    expect(resettable(pane('appearance'))).toBe(false)
  })

  /** There was a third row: a More contrast switch, which painted a palette of
   *  its own over whichever theme was in force. Contrast is a theme now, so the
   *  pane asks the two questions it has always had and the store answers the
   *  third. */
  test('and asks two questions, contrast being a theme rather than a switch', () => {
    expect(fieldsOf('appearance').map((one) => one.label)).toEqual(['Style', 'Mode'])
  })

  /** The group is the theme and both rows are about it, so neither row may be
   *  called Theme as well: the pane read "Theme / Theme / Mode" and said nothing
   *  about which of the two rows was which. */
  test('and names each row for what it picks rather than for the group', () => {
    const group = pane('appearance').groups[0]
    expect(group?.title).toBe('Theme')
    expect(group?.fields.map((one) => one.label)).not.toContain(group?.title)
  })
})

/** Which stream of releases the machine follows. Only the desktop app installs
 *  anything, so this is the one row that is not on every build; see
 *  updates.svelte.ts. The list above is a browser's, which is why the pane list is
 *  built a second time here with the build saying it is the desktop app. */
describe('the release channel', () => {
  let desktop: Pane[] = []

  const row = () => {
    const found = desktop
      .flatMap((one) => one.groups.flatMap((group) => group.fields))
      .find((one) => one.label === 'Release channel')
    if (found?.kind !== 'segmented') throw new Error('the channel is a segmented control')

    return found
  }

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('./tauri', async (original) => ({
      ...(await original<typeof import('./tauri')>()),
      isDesktop: true,
    }))

    desktop = (await import('./preferences')).preferences()
  })

  afterAll(() => {
    vi.doUnmock('./tauri')
    vi.resetModules()
  })

  test('is offered on nothing that cannot install a version it finds', () => {
    const labels = panes.flatMap((one) => one.groups.flatMap((group) => group.fields))
    expect(labels.map((one) => one.label)).not.toContain('Release channel')
  })

  test('is the two streams as a segmented control, the releases first', () => {
    expect(row().options).toEqual([
      { value: 'stable', label: 'Stable' },
      { value: 'unstable', label: 'Unstable' },
    ])
  })

  test('starts on the releases, which is also what a reset puts back', () => {
    expect(row().get()).toBe('stable')
    expect(row().initial).toBe('stable')
  })

  test('says what the two words mean, since neither explains itself', () => {
    const hint = row().hint ?? ''

    readsAsOneSentence(hint, 'Release channel')
    // The sentence is the whole warning: it names what unstable follows.
    expect(hint).toContain('main')
  })

  test('is a group of its own under General, where the app itself is set up', () => {
    const general = desktop.find((one) => one.id === 'general')
    const group = general?.groups.find((one) => one.fields.some((field) => field === row()))

    expect(group?.title).toBe('Updates')
  })
})

/** The language list, and what each row says about itself.
 *
 *  Every catalogue but the four that were written by hand was written in one pass
 *  and never read through, and Emil asked for those to be machine-translated "and
 *  marked so in the picker". The caption under the row says it about the language
 *  already chosen, which is the one row nobody is choosing; the mark says it about
 *  every row in the list, which is where somebody about to choose can read it. */
describe('the language picker', () => {
  /** The one sentence a marked row carries, which is the sentence the caption
   *  under the list says about the language already chosen: one thing said one
   *  way. See `caption` in preferences.ts. */
  const SAID = 'Machine-translated. Corrections welcome.'

  const row = () => {
    const one = field('general', 'Language')
    if (one.kind !== 'select') throw new Error('the language is a dropdown')
    return one
  }

  test('offers every language the app has a catalogue for', () => {
    expect(row().options.map((one) => one.value)).toEqual(LANGUAGES.map((one) => one.id))
  })

  test('marks every catalogue nobody has read through', () => {
    const marked = row()
      .options.filter((one) => one.note)
      .map((one) => one.value)

    expect(marked).toEqual(LANGUAGES.filter((one) => one.machine).map((one) => one.id))
    expect(marked.length).toBeGreaterThan(30)
  })

  /** And nothing else: the four that were read through say nothing about
   *  themselves, and neither does following the system or English. */
  test('and leaves the hand-written ones plain', () => {
    const plain = row()
      .options.filter((one) => !one.note)
      .map((one) => one.value)

    expect(plain).toEqual(['system', 'en', 'de', 'gsw', 'fr', 'ja'])
  })

  test('says the same thing on every marked row, in the caption’s own words', () => {
    const said = new Set(row().options.flatMap((one) => (one.note ? [one.note] : [])))
    expect([...said]).toEqual([SAID])
  })
})
