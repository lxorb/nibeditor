import { afterEach, describe, expect, test, vi } from 'vitest'

/** The terminal among the kinds a new tab can be, on the desktop that has one.
 *
 *  A test of its own because it is the one kind that depends on the build: the node
 *  project runs as a page with no crate, where a terminal is never offered - which is
 *  what the other file pins. Here the build is a desktop's. */

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const opened: (string | undefined)[] = []

vi.mock('./tauri', async (actual) => ({
  ...(await actual<typeof import('./tauri')>()),
  isDesktop: true,
}))
vi.mock('./terminal/open', () => ({
  openTerminal: (shell?: string) => {
    opened.push(shell)
    return Promise.resolve()
  },
  shellRows: (make: (shell: { id: string; name: string }) => void) =>
    Promise.resolve([
      { label: 'PowerShell', checked: true, run: () => make({ id: 'pwsh', name: 'PowerShell' }) },
      { label: 'Ubuntu', run: () => make({ id: 'wsl:Ubuntu', name: 'Ubuntu' }) },
    ]),
}))

const { newKindMenu, newKinds } = await import('./new-kinds')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')

afterEach(() => {
  opened.length = 0
  vi.restoreAllMocks()
})

describe('a terminal, as a kind a new tab can be', () => {
  test('is the fifth, after the four the file list also makes', () => {
    expect(newKinds().map((one) => one.kind)).toEqual([
      'note',
      'canvas',
      'web',
      'pages',
      'terminal',
    ])
  })

  /** T is the chord's own step, so the terminal's key is R - Run, on Windows, for thirty
   *  years - and no two kinds share one. */
  test('on R, its own letter', () => {
    const letters = newKinds().map((one) => one.letter)
    expect(letters.at(-1)).toBe('r')
    expect(new Set(letters).size).toBe(letters.length)
  })

  test('wears the prompt, and is called what the palette calls it', () => {
    const terminal = newKinds().at(-1)
    expect(terminal?.mark).toBe('terminal')
    expect(terminal?.label()).toBe('New terminal')
  })

  /** Offered wherever there is a desktop, a narrow window included: a shell is the
   *  machine's, not the layout's. */
  test('whatever the window’s width', () => {
    const was = viewport.device
    viewport.device = 'phone'
    expect(newKinds().some((one) => one.kind === 'terminal')).toBe(true)
    viewport.device = was
  })

  test('makes the default shell when pressed, in the pane that asked', () => {
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)
    newKinds().at(-1)?.make('a-pane')

    expect(opened).toEqual([undefined])
    expect(focused).toHaveBeenCalledWith('a-pane')
  })

  /** VS Code's `+ ˅`: the row makes the default, and the others are a chevron away. */
  test('and any other shell a chevron away', async () => {
    const row = newKindMenu().at(-1)
    expect(row && 'more' in row && row.more).toBeTruthy()

    const others = row && 'more' in row && row.more ? await row.more() : []
    expect(others.map((one) => one?.label)).toEqual(['PowerShell', 'Ubuntu'])

    const ubuntu = others[1]
    if (ubuntu) ubuntu.run()
    expect(opened).toEqual(['wsl:Ubuntu'])
  })

  test('the other kinds have no chevron', () => {
    expect(
      newKindMenu()
        .slice(0, -1)
        .every((row) => row && !('more' in row)),
    ).toBe(true)
  })
})
