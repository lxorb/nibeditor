/** A terminal on another machine: the system's `ssh` in an ordinary terminal tab.
 *
 *  Emil, 2026-10-03: the tab wears the host's name and colour, a quiet Reconnect bar
 *  comes up when the connection drops, and a restart brings the lines back and connects
 *  again only when asked. A session is driven here the way `ssh` drives one - output,
 *  an exit code - with xterm.js a stand-in and the crate answering from here; the
 *  picker that makes one is host-picker.effect.test.ts.
 *
 *  In the jsdom project because the tab's surface is mounted. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Every command the window sent, with what it said. */
const asked: { command: string; args: Record<string, unknown> }[] = []
/** Whether the crate refuses to start `ssh`: no ssh, or no such host. */
let refuse = false

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'windows',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    if (command === 'terminal_shells') return Promise.resolve([{ id: 'pwsh', name: 'PowerShell' }])
    if (command === 'remote_hosts') {
      return Promise.resolve({
        config: [{ id: 'pi', also: [], hostname: '10.0.0.5' }],
        kept: { own: [], about: { pi: { colour: '4' } }, order: [], groups: [] },
        file: null,
      })
    }
    if (command === 'pty_spawn') {
      return refuse
        ? Promise.reject(new Error('no ssh on this machine'))
        : Promise.resolve({ pid: 1 })
    }
    return Promise.resolve(null)
  },
}))

const channels: { onmessage: ((message: unknown) => void) | null }[] = []

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
    constructor() {
      channels.push(this)
    }
  },
  invoke: () => Promise.resolve(null),
}))

let typing: ((data: string) => void) | null = null
let titling: ((title: string) => void) | null = null
/** What was written to the screen. */
const written: string[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    unicode = { activeVersion: '' }
    modes = {
      mouseTrackingMode: 'none',
      sendFocusMode: false,
      applicationCursorKeysMode: false,
      applicationKeypadMode: false,
      bracketedPasteMode: false,
      synchronizedOutputMode: false,
    }
    buffer = { active: { type: 'normal' } }
    parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    registerLinkProvider() {
      return { dispose: () => undefined }
    }
    loadAddon(addon: { activate?: (term: unknown) => void }) {
      addon.activate?.(this)
    }
    onData(listener: (data: string) => void) {
      typing = listener
    }
    onBinary = () => undefined
    onBell = () => ({ dispose: () => undefined })
    onTitleChange(listener: (title: string) => void) {
      titling = listener
    }
    onResize = () => undefined
    attachCustomKeyEventHandler = () => undefined
    open = () => undefined
    resize = () => undefined
    write(data: unknown, then?: () => void) {
      if (typeof data === 'string') written.push(data)
      if (then) setTimeout(then, 0)
    }
    focus = () => undefined
    dispose = () => undefined
    clear = () => undefined
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
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})
/** Svelte plays a transition through the Web Animations API, which jsdom has not got;
 *  this one is over as soon as it starts, so the bar can go. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}

const { workspace } = await import('../../src/lib/workspace.svelte')
const { readSpec, writeSpec } = await import('../../src/lib/terminal/spec')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { openRemote } = await import('../../src/lib/remote/open')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const TerminalTab = (await import('../../src/lib/terminal/TerminalTab.svelte')).default

const spawns = () => asked.filter((one) => one.command === 'pty_spawn')

let place: HTMLElement

beforeEach(() => {
  asked.length = 0
  written.length = 0
  refuse = false
  shells.restoring = false
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: 'C:\\work' }]
  workspace.activeSpaceId = 's'
  place = document.createElement('div')
  document.body.append(place)
})

afterEach(() => {
  workspace.tabs = []
  flushSync()
  place.remove()
})

/** A terminal on `pi`, made by Remote in this run, drawn. */
async function connected() {
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  return tab
}

/** What `ssh` says as it ends. */
const exits = (code: number) => channels.at(-1)?.onmessage?.({ exit: code })

test('it is the system ssh for the host, named and coloured for it, whatever runs there', async () => {
  const tab = await connected()

  expect(spawns()[0]?.args.shell).toBe('ssh:pi')
  await vi.waitFor(() => expect(tab.shown).toBe('pi'))
  expect(tab.running).toMatchObject({ name: 'pi', host: 'pi', colour: '4', program: null })

  // What a remote shell calls itself is nobody's name for the tab, and nothing on this
  // side is asked what runs there.
  titling?.('emil@pi: ~')
  typing?.('vim notes\r')
  flushSync()
  expect(tab.shown).toBe('pi')
  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked.some((one) => one.command === 'pty_program' || one.command === 'pty_folder')).toBe(
    false,
  )
})

test('a dropped connection puts up Reconnect, which connects again; never by itself', async () => {
  const tab = await connected()
  const surface = mount(TerminalTab, { target: place, props: { tab, focused: false } })
  const session = sessionOf(tab)

  exits(255)
  flushSync()
  expect(session.offline).toBe(true)
  expect(workspace.tabs).toHaveLength(1)
  const bar = () => place.querySelector<HTMLButtonElement>('.offline button')
  expect(bar()?.textContent).toBe('Reconnect')
  await new Promise((settle) => setTimeout(settle, 50))
  expect(spawns()).toHaveLength(1)

  bar()?.click()
  await vi.waitFor(() => expect(spawns()).toHaveLength(2))
  flushSync()
  expect(session.offline).toBe(false)
  await vi.waitFor(() => expect(bar()).toBeNull())

  // Enter does the same once it drops again.
  exits(255)
  typing?.('\r')
  await vi.waitFor(() => expect(spawns()).toHaveLength(3))
  void unmount(surface, { outro: false })
})

test('`exit` on the other machine closes the tab, as a shell here does', async () => {
  await connected()
  exits(0)
  flushSync()
  expect(workspace.tabs).toHaveLength(0)
})

test('one a restart put back waits for Reconnect before it connects', async () => {
  const words = writeSpec({ shell: 'ssh:pi', folder: null, key: 'from-before', name: null })
  workspace.openUnsaved('terminal', words, 'pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  expect(spawns()).toHaveLength(0)

  typing?.('\r')
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
})

test('one that will not start is never swapped for a shell on this machine', async () => {
  refuse = true
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)

  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  expect(spawns().map((one) => one.args.shell)).toEqual(['ssh:pi'])
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
  expect(written.join('')).toContain('Could not connect to pi')
})
