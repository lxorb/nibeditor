import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** One document at a time, where there is room for one.
 *
 *  A phone and a tablet hold a single document: a strip of tabs on a screen that
 *  narrow says less the more it holds, so opening a note, a canvas or a paper
 *  puts away the one that was there. What this covers is that nothing is lost in
 *  the trade - the document that went is on the closed stack with its words, and
 *  back brings it straight back - and that a desktop is left exactly as it was.
 *
 *  The device is the store's own field, set here rather than measured: what a
 *  window this size is has its own tests, in viewport.test.ts. */

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
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

const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')

/** What is open, by the name each tab shows, in the order they stand in. */
const open = () => workspace.tabs.map((tab) => tab.shown)

beforeEach(() => {
  notes.clear()
  notes.set('/space/One.md', '# One')
  notes.set('/space/Two.md', '# Two')
  notes.set('/space/Three.md', '# Three')
  notes.set('/space/Plan.canvas', '{"nodes":[]}')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.panes.collapse()
  viewport.device = 'desktop'
})

afterEach(() => {
  workspace.tabs = []
  viewport.device = 'desktop'
})

describe('a desktop', () => {
  test('keeps every note that is opened, and can still split a pane', async () => {
    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    expect(open()).toEqual(['One', 'Two'])
    expect(workspace.canSplit('row')).toBe(true)

    workspace.split('row')
    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(3)

    workspace.collapsePanes()
  })
})

describe('a phone and a tablet', () => {
  test.each(['phone', 'tablet'] as const)('hold one note at a time (%s)', async (device) => {
    viewport.device = device

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    await workspace.open('/space/Three.md')

    expect(open()).toEqual(['Three'])
    expect(workspace.active?.shown).toBe('Three')
  })

  test('a canvas and a paper take the place of the note as well', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.openCanvas('/space/Plan.canvas')
    expect(open()).toEqual(['Plan'])

    workspace.openPdf('/space/Paper.pdf')
    expect(open()).toEqual(['Paper'])
    expect(workspace.active?.kind).toBe('pdf')
  })

  test('the note that went is on the closed stack, and comes back whole', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    expect(workspace.closed.any).toBe(true)
    expect(workspace.closed.stack.at(-1)?.draft).toMatchObject({ path: '/space/One.md' })

    await workspace.reopenClosed()
    expect(workspace.active?.doc).toBe('# One')
  })

  test('so back is the note before, and back again the one before that', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    await workspace.reopenClosed()
    expect(open()).toEqual(['One'])

    // The one that was showing went on the stack in its turn, so the way back
    // is a line rather than a pair of notes swapping places.
    await workspace.reopenClosed()
    expect(open()).toEqual(['Two'])
  })

  test('never split a pane, however it is asked', async () => {
    viewport.device = 'tablet'
    await workspace.open('/space/One.md')

    expect(workspace.canSplit('row')).toBe(false)
    expect(workspace.canSplit('column')).toBe(false)
    expect(workspace.canLand('left', workspace.panes.focusedId, null)).toBe(false)

    workspace.split('row')
    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('a session made on a desktop arrives as the note that had the focus', async () => {
    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    workspace.split('row')
    await workspace.open('/space/Three.md')

    const kept = workspace.active?.shown
    viewport.device = 'tablet'
    workspace.oneDocument()

    expect(workspace.panes.count).toBe(1)
    expect(open()).toEqual([kept])
    // Nothing is lost: what was open is on the stack, so each of them can be
    // brought back - and the notes themselves were in a space all along.
    expect(workspace.closed.stack.length).toBeGreaterThanOrEqual(2)
  })
})
