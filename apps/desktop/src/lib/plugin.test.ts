import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

/** What only the plugin has.
 *
 *  The settings are the app's settings, and the app runs in four places that
 *  have no glasses anywhere near them. A section about how a note reaches a pair
 *  of glasses belongs to the one page that is in front of a pair, and `even.ts`
 *  is the only thing that says so. */

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: () => Promise.resolve(null),
  isDesktop: false,
}))

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
// The store writes three things onto the document element when it is restored: the
// zoom, which frame the window wears and whether the desk shows through it. There is no
// document here and none of this is about any of the three.
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {},
    toggleAttribute: () => false,
  },
})

/** The module graph, compiled once and outside anybody's budget: the settings
 *  pull in most of the app. See docs/conventions.md.
 *
 *  The budget is said here rather than left to the project's, which is the whole
 *  of what "outside anybody's budget" has to mean: `vitest.config.ts` gives every
 *  hook thirty seconds, a project's own setting wins over `--hookTimeout` on the
 *  command line, and compiling most of an app on a machine that is also running
 *  the rest of the suite does not fit in thirty seconds. Four minutes is not a
 *  claim about how long this takes - it is a wall a slow honest run must not hit,
 *  and nothing here asserts on time. */
beforeAll(async () => {
  await import('./preferences')
  await import('./settings/sections')
}, 240_000)

/** A page, with or without a pair of glasses behind it. */
async function page(asPlugin: boolean) {
  vi.resetModules()

  if (asPlugin) (await import('./plugin')).markPlugin()
  // As a start of the app would: the Glasses section also appears once the account
  // says a pair has answered, and that lives in the store.
  ;(await import('./modes.svelte')).modes.restore()

  return {
    panes: (await import('./preferences')).preferences(),
    groups: (await import('./settings/sections')).sectionGroups(),
  }
}

const ids = (groups: { id: string }[][]) => groups.flat().map((one) => one.id)

beforeEach(() => {
  localStorage.clear()
})

describe('the Glasses settings', () => {
  test('are not there in the app', async () => {
    const { panes, groups } = await page(false)

    expect(panes.map((one) => one.id)).not.toContain('glasses')
    expect(ids(groups)).not.toContain('glasses')
  })

  test('are there in the plugin', async () => {
    const { panes, groups } = await page(true)

    expect(panes.map((one) => one.id)).toContain('glasses')
    expect(ids(groups)).toContain('glasses')
  })

  /** And on the desktop beside it, once there is a pair to be about. The plugin
   *  says so on its first contact with a bridge and the account carries it; before
   *  that, somebody who has never worn a pair is not offered a pane about them. */
  test('are there on any device once a pair has answered', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ glassesSeen: true }))
    const { panes, groups } = await page(false)

    expect(panes.map((one) => one.id)).toContain('glasses')
    expect(ids(groups)).toContain('glasses')
  })

  test('carry where a page begins, and only in the plugin', async () => {
    const inside = await page(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const field = pane?.groups.flatMap((group) => group.fields).find((one) => one.kind === 'select')

    // Every heading level, and the choice of no breaks at all. Written as the level
    // and read as "this level and above"; see modes.svelte.ts.
    expect(field?.kind === 'select' && field.options.map((one) => one.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '0',
    ])

    // And nowhere to be found outside it, which is what the settings search
    // reads: the same list of panes.
    const outside = await page(false)
    const labels = outside.panes.flatMap((one) =>
      one.groups.flatMap((group) => group.fields.map((field) => field.label)),
    )
    expect(labels).not.toContain('New page at')
    expect(labels).not.toContain('Voice commands')
  })

  test('carry the line numbers as a switch, and no page number', async () => {
    const inside = await page(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const fields = pane?.groups.flatMap((group) => group.fields) ?? []

    const switches = fields.filter((one) => one.kind === 'switch').map((one) => one.label)
    // The reading switch first, then the markers, then the microphone: the order the
    // one schema lists them in; see even/settings.ts.
    expect(switches[0]).toBe('Line numbers')
    expect(switches).toContain('Voice commands')
    // On by default: it is what "go to line forty" is answered with.
    const numbers = fields.find((one) => one.label === 'Line numbers')
    expect(numbers?.initial).toBe(true)

    // And no page-number setting anywhere: the scroll mode decides that now.
    expect(switches).not.toContain('Page number')
  })

  /** Every phrase a spoken command answers to is a field somebody can type in, and
   *  only on the phone: a pair of glasses has nothing to type with. */
  test('carry a phrase for every spoken command, as text', async () => {
    const inside = await page(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const group = pane?.groups.find((one) => one.title === 'Spoken commands')
    const fields = group?.fields ?? []

    expect(fields.length).toBeGreaterThan(5)
    for (const field of fields) {
      expect(field.kind).toBe('text')
      // The placeholder is what the app answers to now, so an empty field is the
      // default put back.
      expect(field.kind === 'text' && field.placeholder).toBeTruthy()
    }
  })

  test('leave no gap where the section was', async () => {
    // Spread into the group rather than hidden inside it, so the list closes
    // over the space instead of showing a divider with nothing under it.
    const outside = await page(false)
    const inside = await page(true)

    expect(outside.groups).toHaveLength(inside.groups.length)
    for (const group of outside.groups) expect(group.length).toBeGreaterThan(0)
    expect(ids(outside.groups).length).toBe(ids(inside.groups).length - 1)
  })
})
