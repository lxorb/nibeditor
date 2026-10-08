import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The strip's own menu, on its empty stretch: Emil, 2026-09-30, *"when you click on
 *  the bar here there should be the option: reopen closed tab"*. The store reads
 *  storage the moment it is made, so that is stood in for before it is imported. */

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

const { stripMenu } = await import('./strip-menu')
const { workspace } = await import('../workspace.svelte')
const { shortcuts } = await import('../shortcuts.svelte')
type MenuItem = import('../menu-item').MenuItem

const PANE = 'right'

function rows(): MenuItem[] {
  return stripMenu(PANE).flatMap((row) => (row ? [row] : []))
}

function row(label: string): MenuItem {
  const found = rows().find((one) => one.label === label)
  if (!found) throw new Error(`no row ${label}`)
  return found
}

beforeEach(() => {
  workspace.closed.restore([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the empty strip's menu", () => {
  test("is Chrome's rows there that nib has, and nothing else", () => {
    expect(stripMenu(PANE).map((one) => one?.label ?? '-')).toEqual([
      'New tab',
      'Reopen closed tab',
      '-',
      'Close all tabs',
    ])
  })

  test('says the keys each row has, out of the registry', () => {
    expect(row('New tab').hint).toBe(shortcuts.hint('app.new-kind'))
    expect(row('Reopen closed tab').hint).toBe(shortcuts.hint('app.reopen'))
    expect(row('Reopen closed tab').hint).toBeDefined()
  })
})

describe('New tab', () => {
  /** Which pane it was asked for is the whole of what this menu decides about it; what a
   *  new tab is, is `newTab`'s. */
  test("is a new tab, in the strip's own pane", () => {
    const asked: (string | undefined)[] = []
    vi.spyOn(workspace, 'newTab').mockImplementation((paneId) => void asked.push(paneId))

    row('New tab').run()
    expect(asked).toEqual([PANE])
  })
})

describe('Reopen closed tab', () => {
  test('is offered greyed while nothing has been closed, rather than left out', () => {
    expect(row('Reopen closed tab').disabled).toBe(true)
  })

  test('and live once something has', () => {
    workspace.closed.record({
      draft: {
        kind: 'note',
        path: '/s/plan.md',
        name: 'plan.md',
        doc: '',
        dirty: false,
        cursor: 0,
        scroll: 0,
      },
      paneId: PANE,
      at: 0,
    })

    expect(row('Reopen closed tab').disabled).toBe(false)
  })

  test('is the one reopen, asked from this pane', () => {
    const focused: string[] = []
    vi.spyOn(workspace, 'focusPane').mockImplementation((id) => void focused.push(id))
    const reopen = vi.spyOn(workspace, 'reopenClosed').mockResolvedValue()

    row('Reopen closed tab').run()

    expect(focused).toEqual([PANE])
    expect(reopen).toHaveBeenCalledOnce()
  })
})

describe('Close all tabs', () => {
  test('is greyed on a strip with nothing it may close', () => {
    vi.spyOn(workspace, 'closesAround').mockReturnValue(0)

    expect(row('Close all tabs').disabled).toBe(true)
  })

  test("closes around the tab in front of this strip's pane", () => {
    vi.spyOn(workspace.panes, 'at').mockImplementation((id) =>
      // Only what the menu reads of a pane.
      id === PANE ? ({ activeTabId: 'mine' } as ReturnType<typeof workspace.panes.at>) : null,
    )
    vi.spyOn(workspace, 'closesAround').mockReturnValue(2)
    const close = vi.spyOn(workspace, 'closeAround').mockResolvedValue()

    const item = row('Close all tabs')
    expect(item.disabled).toBe(false)

    item.run()
    expect(close).toHaveBeenCalledWith('mine', 'all')
  })
})
