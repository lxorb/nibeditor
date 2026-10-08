import { afterEach, describe, expect, test, vi } from 'vitest'

/** The terminal among the kinds a new tab can be, on the desktop that has one, and
 *  Remote beside it.
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

const shownPicker: (string | undefined)[] = []
vi.mock('./remote/picker.svelte', () => ({
  hostPicker: { show: (paneId?: string) => void shownPicker.push(paneId) },
}))

const { kindLines, newKinds } = await import('./new-kinds')

const terminalKind = () => newKinds().find((one) => one.kind === 'terminal')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')

afterEach(() => {
  opened.length = 0
  vi.restoreAllMocks()
})

describe('a terminal, as a kind a new tab can be', () => {
  test('starts the second line, with Remote and Online after it', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['terminal', 'remote', 'online'],
      ['web', 'private'],
    ])
  })

  /** T is the new tab's own key, so the terminal's is R - Run, on Windows, for thirty
   *  years - and no two kinds share one. */
  test('on R, its own letter', () => {
    const letters = newKinds().map((one) => one.letter)
    expect(terminalKind()?.letter).toBe('r')
    expect(new Set(letters).size).toBe(letters.length)
  })

  test('wears the prompt, and is called what the palette calls it', () => {
    const terminal = terminalKind()
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
    terminalKind()?.make('a-pane')

    expect(opened).toEqual([undefined])
    expect(focused).toHaveBeenCalledWith('a-pane')
  })

  /** VS Code's `+ ˅`: the row makes the default, and the others are a chevron away. */
  test('and any other shell a chevron away', async () => {
    const more = terminalKind()?.others
    expect(more).toBeDefined()

    const others = more ? await more() : []
    expect(others.map((one) => one?.label)).toEqual(['PowerShell', 'Ubuntu'])

    const ubuntu = others[1]
    if (ubuntu) ubuntu.run()
    expect(opened).toEqual(['wsl:Ubuntu'])
  })

  test('the other kinds have no chevron', () => {
    expect(
      newKinds()
        .filter((one) => one.kind !== 'terminal')
        .every((one) => one.others === undefined),
    ).toBe(true)
  })
})

/** Emil, 2026-10-03: Remote is a card of its own beside Terminal, and the terminal's
 *  chooser keeps only the shells of this machine. */
describe('Remote, beside it', () => {
  test('on S, wearing the server, and opening the host picker for the pane that asked', async () => {
    const remote = newKinds().find((one) => one.kind === 'remote')
    expect(remote?.letter).toBe('s')
    expect(remote?.mark).toBe('remote')
    expect(remote?.label()).toBe('Remote')
    expect(remote?.others).toBeUndefined()

    remote?.make('a-pane')
    await vi.waitFor(() => expect(shownPicker).toEqual(['a-pane']))
    expect(opened).toEqual([])
  })
})
