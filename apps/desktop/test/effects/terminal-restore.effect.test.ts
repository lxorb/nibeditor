/** A terminal tab put back by a restart draws what it had on its screen before its new
 *  shell starts: Emil, 2026-09-30, *"Even if we fully close and restart nib, the terminal
 *  state should be restored like in VS Code."*
 *
 *  The screen is xterm.js and the shell is the crate, and neither is here: xterm.js is a
 *  stand-in that writes down what it was asked to do, and the crate answers the one read
 *  with a history written at another size. What is tested is the order - the history,
 *  at its own width, then the line saying when, then the fit that reflows it, then the
 *  shell - and what a closed tab leaves behind. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Everything that happened, in order: the crate's commands and the screen's calls. */
const done: string[] = []
/** What the crate holds, by space and key. */
const files = new Map<string, unknown>()
/** Which system this is, and what its kernel says the shell's folder is. */
let system = 'windows'
const KERNEL_FOLDER = '/Users/me/work/nib'
/** What the last screen made hands a keystroke to. */
let typing: ((data: string) => void) | null = null

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => system,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    const at = `${String(args.space)}/${String(args.key)}`
    done.push(
      command === 'pty_spawn' ? `pty_spawn ${String(args.cols)}x${String(args.rows)}` : command,
    )
    if (command === 'terminal_history_read') return Promise.resolve(files.get(at) ?? null)
    if (command === 'terminal_history_forget') files.delete(at)
    if (command === 'terminal_history_write') files.set(at, args.history)
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1 })
    if (command === 'pty_folder') return Promise.resolve(KERNEL_FOLDER)
    return Promise.resolve(null)
  },
}))

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: unknown = null
  },
  invoke: () => Promise.resolve(null),
}))

/** xterm.js, as far as a session asks anything of it. */
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
    private sized: ((size: { cols: number; rows: number }) => void) | null = null
    loadAddon(addon: { activate?: (term: unknown) => void }) {
      addon.activate?.(this)
    }
    onData(listener: (data: string) => void) {
      typing = listener
    }
    onBinary = () => undefined
    onResize(listener: (size: { cols: number; rows: number }) => void) {
      this.sized = listener
    }
    attachCustomKeyEventHandler = () => undefined
    open() {
      done.push('open')
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      done.push(`resize ${cols}x${rows}`)
      this.sized?.({ cols, rows })
    }
    write(data: string | Uint8Array, then?: () => void) {
      done.push(`write ${typeof data === 'string' ? data : '<bytes>'}`)
      // xterm.js parses on a later turn, which is why the callback exists at all.
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
    private term: { resize(cols: number, rows: number): void } | null = null
    activate(term: { resize(cols: number, rows: number): void }) {
      this.term = term
    }
    fit() {
      done.push('fit')
      this.term?.resize(132, 40)
    }
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    onDidChangeResults = () => undefined
  },
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize() {
      return 'the screen as it stands'
    }
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate = () => undefined
  },
}))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    activate = () => undefined
  },
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = () => undefined
    disconnect = () => undefined
  },
)
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})

const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { flushSync } = await import('svelte')
const { written } = await import('../../src/lib/parting')

/** The escape every sequence starts with. */
const ESC = '\x1b'

const HISTORY = {
  cols: 100,
  rows: 20,
  at: Date.UTC(2026, 8, 30, 12, 2),
  text: 'PS C:\\work> npm run build\r\nfailed: 3 errors\r\nPS C:\\work> ',
}

const { i18n } = await import('../../src/lib/i18n.svelte')
const when = i18n.when(HISTORY.at, { dateStyle: 'medium', timeStyle: 'short' })

/** A terminal tab as a session brings one back: no file, its words, and its key. */
function restored(key: string): InstanceType<typeof Tab> {
  const words = JSON.stringify({ shell: 'pwsh', folder: 'C:\\work', key })
  const doc = new NoteDoc(
    { kind: 'terminal', path: null, name: 'PowerShell', text: words, dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  workspace.tabs = [...workspace.tabs, tab]
  return tab
}

function placeFor(): HTMLElement {
  const place = document.createElement('div')
  document.body.append(place)
  return place
}

beforeEach(() => {
  system = 'windows'
  done.length = 0
  files.clear()
  shells.setRestoring(true)
})

afterEach(async () => {
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('a restored terminal draws its history, at its own size, before its shell starts', async () => {
  system = 'macos'
  files.set('null/k1', HISTORY)
  const tab = restored('k1')

  await sessionOf(tab).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  const writes = done.filter((one) => one.startsWith('write '))
  expect(writes).toHaveLength(2)
  expect(writes[0]).toBe(`write ${HISTORY.text}`)
  // The line saying when, dim, under the history and above the new prompt.
  expect(writes[1]).toBe(`write ${ESC}[0m\r\n${ESC}[2mRestored ${when}${ESC}[22m\r\n`)

  expect(done).toEqual([
    'terminal_history_read',
    'open',
    // Written back at the width it was written at...
    'resize 100x20',
    writes[0],
    // ...and reflowed into the pane once it has been drawn, and only then the line and
    // the shell, at the pane's size.
    'fit',
    'resize 132x40',
    writes[1],
    'pty_spawn 132x40',
  ])
})

/** Windows' pseudo console owns every row of the screen it starts on, so the history goes
 *  above it once it has been reflowed, a screen's worth of lines at the pane's own
 *  height, and the line saying when is the screen's first row. */
test('on Windows the history goes above the screen before the shell starts', async () => {
  files.set('null/k7', HISTORY)
  await sessionOf(restored('k7')).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  const writes = done.filter((one) => one.startsWith('write '))
  expect(writes).toHaveLength(2)
  expect(writes[0]).toBe(`write ${HISTORY.text}`)
  expect(writes[1]).toContain(`${'\r\n'.repeat(39)}${ESC}[H${ESC}[2mRestored `)

  expect(done).toEqual([
    'terminal_history_read',
    'open',
    'resize 100x20',
    writes[0],
    // Reflowed first, so the lines pushed above are the pane's own height...
    'fit',
    'resize 132x40',
    writes[1],
    // ...and the shell after them, its prompt under the line saying when.
    'pty_spawn 132x40',
  ])
})

test('a terminal with nothing kept starts its shell at once', async () => {
  await sessionOf(restored('k2')).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  expect(done.filter((one) => one.startsWith('write '))).toEqual([])
  expect(done).toEqual([
    'terminal_history_read',
    'open',
    'fit',
    'resize 132x40',
    'pty_spawn 132x40',
  ])
})

test('with Restore history off nothing is read, and nothing is written', async () => {
  files.set('null/k3', HISTORY)
  shells.setRestoring(false)
  await written()
  done.length = 0

  const session = sessionOf(restored('k3'))
  await session.attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))
  session.remember()

  expect(done).not.toContain('terminal_history_read')
  expect(done).not.toContain('terminal_history_write')
  expect(done.filter((one) => one.startsWith('write '))).toEqual([])
})

/** Duplicate copies a tab's words, key and all; two tabs writing one file would each put
 *  the other's screen back after a restart. */
test('a duplicate running beside its original is given a key of its own', async () => {
  files.set('null/k4', HISTORY)
  const first = restored('k4')
  const second = restored('k4')

  await sessionOf(first).attach(placeFor(), false)
  await sessionOf(second).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.filter((one) => one.startsWith('pty_spawn'))).toHaveLength(2))

  expect(done.filter((one) => one === 'terminal_history_read')).toHaveLength(1)
  const key = (JSON.parse(second.doc) as { key: string }).key
  expect(key).not.toBe('k4')
  expect(key).toBeTruthy()
})

test('a closed tab takes its file with it and comes back from memory', async () => {
  files.set('null/k5', HISTORY)
  const tab = restored('k5')
  await sessionOf(tab).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  workspace.tabs = workspace.tabs.filter((one) => one !== tab)
  flushSync()
  await written()
  expect(done).toContain('terminal_history_forget')
  expect(files.has('null/k5')).toBe(false)

  // Reopen closed tab: the same words, a new tab, and the screen it had.
  done.length = 0
  const again = restored('k5')
  await sessionOf(again).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  expect(done).not.toContain('terminal_history_read')
  expect(done.find((one) => one.startsWith('write '))).toContain('the screen as it stands')
})

/** zsh, a Mac's own shell, says nothing about where it is; the kernel is asked a moment
 *  after Enter, and the tab's words follow, which is where a restart puts it back. */
test('a Mac asks the kernel where the shell went, and the tab remembers it', async () => {
  system = 'macos'
  const tab = restored('k6')
  await sessionOf(tab).attach(placeFor(), false)
  await vi.waitFor(() => expect(done.some((one) => one.startsWith('pty_spawn'))).toBe(true))

  typing?.('cd ~/work/nib\r')
  await vi.waitFor(() => expect(done).toContain('pty_folder'), { timeout: 2000 })
  await vi.waitFor(() =>
    expect((JSON.parse(tab.doc) as { folder: string }).folder).toBe(KERNEL_FOLDER),
  )
})
