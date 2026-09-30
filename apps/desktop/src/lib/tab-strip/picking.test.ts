import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Several tabs at once: picked with Ctrl and Shift, acted on by the tab's menu and by
 *  Ctrl+W together, carried together, and closed as one thing to take back. */

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    if (command === 'read_note') return notes.get(path) ?? ''
    if (command === 'write_note') notes.set(path, text(args?.content))
    return undefined
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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { chosen, pickingOf } = await import('./chosen.svelte')
const { gathered, pick, placeBlock, pinMany, runOf } = await import('./picking')
const { moved, nearestSlot } = await import('./layout')
const { tabMenu, tabMenuTitle } = await import('./menu')
const { workspace } = await import('../workspace.svelte')
const { runEntry } = await import('../shortcuts/registry')

const NAMES = ['A', 'B', 'C', 'D']

/** The strip, by the names its tabs show. */
const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((one) => one.shown)
const idOf = (name: string) => workspace.tabs.find((one) => one.shown === name)?.id ?? ''
const pickedNames = () => chosen.of(workspace.panes.focusedId).map((one) => one.shown)

/** A click with a modifier, the way the strip answers it. */
function click(name: string, how: 'toggle' | 'run' | 'add-run') {
  const front = pick(workspace.panes.focusedId, idOf(name), how)
  if (front) workspace.activate(front)
}

function labels(name: string): string[] {
  const tab = workspace.tabs.find((one) => one.shown === name)
  if (!tab) throw new Error(`no tab ${name}`)
  return tabMenu(tab, workspace.panes.focusedId).flatMap((row) => (row ? [row.label] : []))
}

beforeEach(async () => {
  notes.clear()
  for (const name of NAMES) notes.set(`/space/${name}.md`, `# ${name}`)
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.panes.collapse()
  chosen.clear()

  for (const name of NAMES) await workspace.open(`/space/${name}.md`, { blank: true })
  workspace.activate(idOf('A'))
})

describe('the modifiers', () => {
  test('are Ctrl, or Cmd on a Mac, for one tab and Shift for a run', () => {
    const plain = { ctrlKey: false, metaKey: false, shiftKey: false }
    expect(pickingOf(plain, false)).toBeNull()
    expect(pickingOf({ ...plain, ctrlKey: true }, false)).toBe('toggle')
    expect(pickingOf({ ...plain, ctrlKey: true }, true)).toBeNull()
    expect(pickingOf({ ...plain, metaKey: true }, true)).toBe('toggle')
    expect(pickingOf({ ...plain, shiftKey: true }, false)).toBe('run')
    expect(pickingOf({ ...plain, ctrlKey: true, shiftKey: true }, false)).toBe('add-run')
  })

  test('a run is every tab between two, either way round', () => {
    expect(runOf(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c'])
    expect(runOf(['a', 'b', 'c', 'd'], 'b', 'b')).toEqual(['b'])
  })
})

describe('a pick', () => {
  test('begins with the tab in front, and Ctrl adds the one clicked', () => {
    expect(strip()).toEqual(NAMES)
    click('C', 'toggle')

    expect(pickedNames()).toEqual(['A', 'C'])
    expect(workspace.active?.shown).toBe('C')
  })

  test('and takes it out again, the front moving to one still picked', () => {
    click('C', 'toggle')
    click('D', 'toggle')
    click('D', 'toggle')

    expect(pickedNames()).toEqual(['A', 'C'])
    expect(workspace.active?.shown).toBe('C')
  })

  test('Shift takes the run from the last one clicked', () => {
    click('C', 'run')
    expect(pickedNames()).toEqual(['A', 'B', 'C'])

    click('D', 'toggle')
    click('B', 'add-run')
    expect(pickedNames()).toEqual(['A', 'B', 'C', 'D'])
  })

  test('is put down by anything else bringing another tab to the front', () => {
    click('B', 'toggle')
    workspace.activate(idOf('D'))

    expect(pickedNames()).toEqual([])
  })
})

describe("a picked tab's menu", () => {
  test('is about all of them, and says how many', () => {
    click('C', 'run')
    const tab = workspace.tabs.find((one) => one.shown === 'B')
    if (!tab) throw new Error('no B')

    expect(tabMenuTitle(tab, workspace.panes.focusedId)).toBe('3 tabs')
    expect(labels('B')).toEqual(
      expect.arrayContaining(['Duplicate', 'Pin', 'Close', 'Close others', 'Close all']),
    )
    expect(labels('B')).not.toContain('Show in the file list')
  })

  test('and one that is not picked is about itself alone', () => {
    click('B', 'toggle')
    expect(labels('D')).toContain('Show in the file list')
  })

  test('pins them together, in their order, and lets them go the same way', () => {
    click('B', 'toggle')
    click('D', 'toggle')
    const picked = chosen.of(workspace.panes.focusedId)

    pinMany(picked)
    expect(strip()).toEqual(['A', 'B', 'D', 'C'])
    expect(picked.every((one) => one.pinned)).toBe(true)

    pinMany(picked)
    expect(strip()).toEqual(['A', 'B', 'D', 'C'])
    expect(picked.some((one) => one.pinned)).toBe(false)
  })
})

describe('closing a pick', () => {
  test('Ctrl+W closes all of it', async () => {
    click('C', 'run')
    runEntry('app.close', { palette: () => undefined, fullscreen: () => undefined })

    await vi.waitFor(() => expect(strip()).toEqual(['D']))
  })

  test('and one Reopen closed tab brings all of it back, each to its place', async () => {
    click('B', 'toggle')
    click('D', 'toggle')
    await workspace.closeMany(chosen.of(workspace.panes.focusedId).map((one) => one.id))
    expect(strip()).toEqual(['C'])

    await workspace.reopenClosed()
    expect(strip()).toEqual(NAMES)
    expect(workspace.closed.any).toBe(false)
  })

  test('as do the tabs closed around one', async () => {
    await workspace.closeAround(idOf('A'), 'others')
    expect(strip()).toEqual(['A'])

    await workspace.reopenClosed()
    expect(strip()).toEqual(NAMES)
  })
})

describe('a block let go of', () => {
  test('lands side by side in its order, in front of the tab it was aimed at', () => {
    placeBlock([idOf('A'), idOf('C')], workspace.panes.focusedId, idOf('D'))
    expect(strip()).toEqual(['B', 'A', 'C', 'D'])

    placeBlock([idOf('B'), idOf('D')], workspace.panes.focusedId, null)
    expect(strip()).toEqual(['A', 'C', 'B', 'D'])
  })
})

describe('several tabs carried as one', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  const widths = [100, 80, 100, 60, 100]

  test('stand as the dragged one, as wide as all of them', () => {
    const block = gathered(tabs, widths, ['b', 'd'], 'd')

    expect(block.order.map((one) => one.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(block.widths).toEqual([100, 100, 140, 100])
    expect(block.from).toBe(2)
  })

  test('held from where the dragged one sits inside the block', () => {
    expect(gathered(tabs, widths, ['b', 'd'], 'd').before).toBe(80)
    expect(gathered(tabs, widths, ['b', 'd'], 'b').before).toBe(0)
  })

  test('and go along the strip by the rules one tab goes by', () => {
    const block = gathered(tabs, widths, ['b', 'd'], 'b')
    // Past the middle of the tab after it: the block is one slot on.
    expect(nearestSlot(block.widths, block.from, 160, 0, false)).toBe(2)
    expect(moved(block.order, block.from, 2).map((one) => one.id)).toEqual(['a', 'c', 'b', 'e'])
  })
})
