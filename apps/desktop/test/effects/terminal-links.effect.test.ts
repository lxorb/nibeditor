/** A link on a terminal's screen, local or online: one way to find it, one way to follow.
 *
 *  Emil, 2026-10-05: Claude Code's sign-in link, broken over rows by the program, opened
 *  cut off at the first break in the online terminal. Every terminal - a shell here and a
 *  session on an online machine alike - asks the one provider in links.ts, and Ctrl+click
 *  on what it found, or on a link the program marked itself, opens the whole address
 *  beside the terminal. xterm.js is a stand-in here; links.test.ts reads a real screen.
 *
 *  In the jsdom project because a terminal's screen is an element. */

import type { ILink, ILinkProvider } from '@xterm/xterm'
import { afterEach, expect, test, vi } from 'vitest'

const ADDRESS = 'https://claude.ai/oauth/authorize?scope=user%3Aprofile+user%3Amcp_servers'

/** Every terminal made, with what it was given. */
const made: { providers: ILinkProvider[]; options: Record<string, unknown> }[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 40
    rows = 24
    unicode = { activeVersion: '' }
    parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    readonly providers: ILinkProvider[] = []
    /** The address, broken over two full rows as Ink breaks it. */
    buffer = {
      active: {
        getNullCell: () => ({ chars: '', getChars: () => '', getWidth: () => 1 }),
        getLine: (y: number) => {
          const text = [ADDRESS.slice(0, 40), ADDRESS.slice(40).padEnd(40)][y]
          if (text === undefined) return undefined
          return {
            isWrapped: false,
            length: 40,
            getCell: (x: number, cell: { getChars: () => string }) => {
              const char = text[x] === ' ' ? '' : (text[x] ?? '')
              cell.getChars = () => char
              return cell
            },
          }
        },
      },
    }
    constructor(readonly options: Record<string, unknown>) {
      made.push({ providers: this.providers, options })
    }
    registerLinkProvider(provider: ILinkProvider) {
      this.providers.push(provider)
      return { dispose: () => undefined }
    }
    loadAddon = () => undefined
    onData = () => undefined
    onBinary = () => undefined
    onTitleChange = () => undefined
    onResize = () => undefined
    attachCustomKeyEventHandler = () => undefined
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = () => undefined
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    onDidChangeResults = () => undefined
  },
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize = () => ''
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate = () => undefined
  },
}))

globalThis.ResizeObserver = class {
  observe() {
    // Nothing is measured here.
  }
  unobserve() {
    // Said above.
  }
  disconnect() {
    // Said above.
  }
}

const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')

afterEach(() => {
  made.length = 0
  vi.restoreAllMocks()
})

function linksOf(provider: ILinkProvider | undefined, y: number): ILink[] {
  let found: ILink[] = []
  provider?.provideLinks(y, (links) => {
    found = links ?? []
  })
  return found
}

const ctrl = () => new MouseEvent('click', { ctrlKey: true, metaKey: true })

for (const [where, path, name] of [
  ['local', null, 'PowerShell'],
  ['online', 'Work/Terminal.term', 'Terminal.term'],
] as const) {
  test(`a ${where} terminal follows the whole address a program broke over rows`, () => {
    const opened = vi.spyOn(workspace, 'openPage').mockReturnValue(null)
    const text = JSON.stringify({ shell: 'pwsh', folder: null, key: where })
    const tab = new Tab(
      new NoteDoc({ kind: 'terminal', path, name, text, dirty: false }, () => undefined),
      'pane',
    )
    sessionOf(tab)
    const [screen] = made
    expect(screen?.providers).toHaveLength(1)

    for (const y of [1, 2]) {
      const [link] = linksOf(screen?.providers[0], y)
      expect(link?.text).toBe(ADDRESS)
      expect(link?.range).toEqual({ start: { x: 1, y: 1 }, end: { x: ADDRESS.length - 40, y: 2 } })
    }

    // A plain click is the terminal's own, for selecting.
    const [link] = linksOf(screen?.providers[0], 2)
    link?.activate(new MouseEvent('click'), ADDRESS)
    expect(opened).not.toHaveBeenCalled()
    link?.activate(ctrl(), ADDRESS)
    expect(opened).toHaveBeenCalledWith(ADDRESS, expect.any(String), tab.id)

    // A link the program marked itself (OSC 8) goes the same way, not to a confirm box.
    opened.mockClear()
    const handler = screen?.options.linkHandler as {
      activate: (e: MouseEvent, uri: string) => void
    }
    handler.activate(ctrl(), ADDRESS)
    expect(opened).toHaveBeenCalledWith(ADDRESS, expect.any(String), tab.id)
  })
}
