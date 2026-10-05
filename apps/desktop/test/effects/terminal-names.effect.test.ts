/** A terminal's tab says what runs in it, and takes a name of its own: Emil, 2026-10-03,
 *  *"I would like to be able to rename terminal tabs too. Usually, e.g. in VS Code, they
 *  infer their name intelligently, e.g. based on the Claude session."*
 *
 *  The strip is mounted on the real workspace and renamed the ways a person renames a
 *  tab - a double click, F2, the tab's menu - and a session is driven the way a shell
 *  drives one: Enter, the crate saying what is in front, a title, a prompt mark. xterm.js
 *  is a stand-in that hands over its listeners, and the crate answers from here. The
 *  rules themselves are naming.test.ts.
 *
 *  In the jsdom project because the strip is mounted. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** What the crate says is in front of the shell. */
let front: string | null = null
/** Every command the window sent. */
const asked: string[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'windows',
  invoke: (command: string) => {
    asked.push(command)
    if (command === 'terminal_shells') {
      return Promise.resolve([
        { id: 'pwsh', name: 'PowerShell' },
        { id: 'cmd', name: 'Command Prompt' },
      ])
    }
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1 })
    if (command === 'pty_program') return Promise.resolve(front)
    return Promise.resolve(null)
  },
}))

/** The channels the shell's output arrives on, as the sessions made them. */
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

/** What the last screen hands a keystroke and a title to. */
let typing: ((data: string) => void) | null = null
let titling: ((title: string) => void) | null = null

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
    onTitleChange(listener: (title: string) => void) {
      titling = listener
    }
    onResize = () => undefined
    attachCustomKeyEventHandler = () => undefined
    open = () => undefined
    resize = () => undefined
    write(_data: unknown, then?: () => void) {
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

/** How wide the strip is said to be: room for every name. */
const STRIP = 900

class Measured {
  constructor(private readonly told: ResizeObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() => this.told([{ target } as ResizeObserverEntry], this))
  }

  unobserve() {
    // Nothing is watched for long enough to need it.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = Measured
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('tabs') ? STRIP : 0
  },
})
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = () => undefined

const { workspace } = await import('../../src/lib/workspace.svelte')
const { readSpec, writeSpec } = await import('../../src/lib/terminal/spec')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { tabMenu } = await import('../../src/lib/tab-strip/menu')
const { renameTerminal } = await import('../../src/lib/terminal/rename')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default
// Fetched by the strip and the first rename, and here first so no test waits on
// compiling them.
await import('../../src/lib/tab-strip/TabNameField.svelte')
await import('../../src/lib/terminal/TerminalMark.svelte')
await import('../../src/lib/tab-strip/ops')

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  front = null
  asked.length = 0
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: 'C:\\work' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  workspace.tabs = []
  flushSync()
  target.remove()
})

/** A PowerShell terminal in the strip, in `C:\work`, nobody having named it. */
function terminal() {
  const words = writeSpec({ shell: 'pwsh', folder: 'C:\\work', key: 'k', name: null })
  workspace.openUnsaved('terminal', words, 'PowerShell')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no terminal')
  return tab
}

async function strip() {
  const tab = terminal()
  shown = mount(Tabs, { target, props: { paneId: workspace.panes.focusedId } })
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector<HTMLElement>('.tab')?.style.width).not.toBe('')
  })
  return tab
}

const pick = () => target.querySelector<HTMLElement>('.pick')
const label = () => target.querySelector('.label')?.textContent
const field = () => target.querySelector<HTMLInputElement>('input.field')

/** The field, once it is up: the rename has fetched it. */
async function fieldUp(): Promise<HTMLInputElement> {
  await vi.waitFor(() => {
    flushSync()
    expect(field()).not.toBeNull()
  })
  const up = field()
  if (!up) throw new Error('no field')
  return up
}

/** What a shell prints, as the channel delivers it: in this page's own ArrayBuffer,
 *  which the encoder's is not under jsdom. */
function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text)
  const buffer = new ArrayBuffer(encoded.length)
  new Uint8Array(buffer).set(encoded)
  return buffer
}

function typeIn(input: HTMLInputElement, words: string, key = 'Enter') {
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}

test('a double click names a terminal in the strip, and an empty name gives it back', async () => {
  const tab = await strip()
  expect(label()).toBe('PowerShell')

  pick()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  const input = await fieldUp()
  expect(input.value).toBe('PowerShell')

  typeIn(input, 'api server')
  await vi.waitFor(() => expect(tab.shown).toBe('api server'))
  flushSync()
  expect(field()).toBeNull()
  expect(label()).toBe('api server')
  expect(readSpec(tab.doc)?.name).toBe('api server')

  // F2, on the tab, and nothing typed: the shell's own name again.
  pick()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
  typeIn(await fieldUp(), '')
  await vi.waitFor(() => expect(tab.shown).toBe('PowerShell'))
  expect(readSpec(tab.doc)?.name).toBeNull()
})

test('Escape leaves the name as it was, and the menu offers the same field', async () => {
  const tab = await strip()

  const rename = tabMenu(tab, tab.paneId).find(
    (row) => row !== null && 'label' in row && row.label === 'Rename',
  ) as { run: () => void } | undefined
  expect(rename).toBeDefined()
  rename?.run()

  typeIn(await fieldUp(), 'never', 'Escape')
  expect(field()).toBeNull()
  expect(tab.shown).toBe('PowerShell')
  expect(readSpec(tab.doc)?.name).toBeNull()
})

/** The name is the tab's words, which is what Reopen closed tab, a restart and Move to
 *  space carry a terminal by. */
test('a name comes back with the tab', async () => {
  const tab = terminal()
  await renameTerminal(tab, 'builds')

  workspace.close(tab.id)
  expect(workspace.tabs).toHaveLength(0)
  await workspace.reopenClosed()

  const back = workspace.tabs.at(-1)
  expect(back?.shown).toBe('builds')
  expect(readSpec(back?.doc ?? '')?.name).toBe('builds')
})

test('the tab says what runs in it, the title its program set, and the shell again after', async () => {
  const tab = terminal()
  const place = document.createElement('div')
  document.body.append(place)
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(asked).toContain('pty_spawn'))

  // At the prompt: the shell, and the folder.
  await vi.waitFor(() => expect(tab.shown).toBe('PowerShell · work'))

  // The shell's own title as it starts is nobody's name.
  titling?.('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  flushSync()
  expect(tab.shown).toBe('PowerShell · work')

  front = 'claude'
  typing?.('claude\r')
  await vi.waitFor(() => expect(tab.shown).toBe('claude · work'))
  expect(tab.running?.program).toBe('claude')

  // Claude Code's topic, with the glyph it turns in front of it while it works.
  titling?.('⠐ Fix the parser')
  await vi.waitFor(() => expect(tab.shown).toBe('Fix the parser'))

  // A name the reader gives wins over it, and giving it back brings the title back.
  await renameTerminal(tab, 'mine')
  titling?.('✳ Fix the parser')
  await vi.waitFor(() => expect(tab.shown).toBe('mine'))
  await renameTerminal(tab, '')
  await vi.waitFor(() => expect(tab.shown).toBe('Fix the parser'))

  // The program leaves: the shell marks its prompt, and the title goes with it.
  front = null
  channels.at(-1)?.onmessage?.(bytesOf('\x1b]133;A\x07PS C:\\work> '))
  await vi.waitFor(() => expect(tab.shown).toBe('PowerShell · work'))
  expect(tab.running?.program).toBeNull()

  // Asked after Enter and after a title nobody owned, and never per keystroke.
  expect(asked.filter((one) => one === 'pty_program').length).toBeLessThanOrEqual(2)
  place.remove()
})
