/** A program that leaves the mouse reported does not leave it reported at the prompt after
 *  it: Emil, 2026-10-01, *"moving the mouse over a nib terminal writes garbage at the
 *  PowerShell prompt"* - `C"1C%0C` and on, X10 reports of any-event tracking, after Claude
 *  Code had been running in the tab and nib had been restarted.
 *
 *  xterm.js itself, not a stand-in: what matters is the mode it is in once the shell's
 *  bytes have been drawn, since a move is reported exactly while `mouseTrackingMode` is not
 *  `none`. The crate is the stand-in here - the shell's output arrives down the channel
 *  `pty_spawn` was handed, and what the window types or asks is written down. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Everything the window asked the crate, in order. */
const asked: string[] = []
/** The output channel of the shell started last. */
let output: { onmessage: ((message: unknown) => void) | null } | null = null
/** What `pty_busy` answers: whether something besides the shell is in front. */
let busy = true
/** What the crate holds, by space and key. */
const files = new Map<string, unknown>()

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => 'windows',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push(command === 'pty_write' ? `pty_write ${JSON.stringify(args.data)}` : command)
    const at = `${String(args.space)}/${String(args.key)}`
    if (command === 'pty_spawn') {
      output = args.output as typeof output
      return Promise.resolve({ pid: 1 })
    }
    if (command === 'pty_busy') return Promise.resolve(busy)
    if (command === 'terminal_history_read') return Promise.resolve(files.get(at) ?? null)
    if (command === 'terminal_history_write') files.set(at, args.history)
    return Promise.resolve(null)
  },
}))

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
  },
  invoke: () => Promise.resolve(null),
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = () => undefined
    disconnect = () => undefined
  },
)
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
}))
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

type Opened = ReturnType<typeof sessionOf>

/** A terminal tab, drawn, with its shell started. */
async function opened(key: string, shell = 'pwsh'): Promise<Opened> {
  const words = JSON.stringify({ shell, folder: null, key })
  const doc = new NoteDoc(
    { kind: 'terminal', path: null, name: 'PowerShell', text: words, dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  workspace.tabs = [...workspace.tabs, tab]
  const place = document.createElement('div')
  document.body.append(place)

  const session = sessionOf(tab)
  await session.attach(place, false)
  await vi.waitFor(() => expect(asked).toContain('pty_spawn'))
  return session
}

/** What the shell printed, down the channel, and drawn. */
async function printed(session: Opened, text: string) {
  // This realm's own buffer, which is what the channel hands over; ASCII throughout.
  output?.onmessage?.(Uint8Array.from(text, (one) => one.charCodeAt(0)).buffer)
  await new Promise<void>((settle) => session.term.write('', settle))
  // What a prompt mark switches off is written once the part before it is drawn.
  await new Promise<void>((settle) => session.term.write('', settle))
}

/** A program that asks for every move of the mouse, in X10 bytes, as Claude Code's
 *  terminal library does - and for focus reports and its own cursor keys besides. */
const PROGRAM_ON = '\x1b[?1003h\x1b[?1004h\x1b[?1h'
const PROMPT = '\x1b]133;A\x1b\\\x1b]9;9;C:\\work\x1b\\PS C:\\work> '

beforeEach(() => {
  asked.length = 0
  files.clear()
  busy = true
  output = null
  shells.setRestoring(true)
})

afterEach(async () => {
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('the prompt after a program that left the mouse reported reports nothing', async () => {
  const session = await opened('m1')

  await printed(session, `${PROGRAM_ON}drawing...`)
  expect(session.term.modes.mouseTrackingMode, 'while it runs').toBe('any')

  // Interrupted: it never switched anything off, and the shell prompts again.
  await printed(session, `^C\r\n${PROMPT}`)
  expect(session.term.modes.mouseTrackingMode, 'at the prompt').toBe('none')
  expect(session.term.modes.sendFocusMode).toBe(false)
  expect(session.term.modes.applicationCursorKeysMode).toBe(false)
  // The prompt is drawn all the same.
  expect(
    session.term.buffer.active.getLine(session.term.buffer.active.cursorY)?.translateToString(true),
  ).toBe('PS C:\\work> ')
})

test('a program still running keeps what it asked for', async () => {
  const session = await opened('m2')
  await printed(session, `${PROMPT}claude\r\n`)
  await printed(session, `${PROGRAM_ON}the program's screen`)

  // No prompt mark, and the shell is not in front: nothing is switched off.
  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked).not.toContain('pty_busy')
  expect(session.term.modes.mouseTrackingMode).toBe('any')
  expect(session.term.modes.applicationCursorKeysMode).toBe(true)
})

/** A shell nobody taught to mark its prompts - zsh, a reader's own bash prompt: the
 *  kernel is asked once the output rests, and only the mouse and focus go. */
test('a shell that marks no prompts is asked whether it is in front again', async () => {
  const session = await opened('m3', '/bin/zsh')
  await printed(session, `${PROGRAM_ON}vim`)

  busy = true
  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked).toContain('pty_busy')
  expect(session.term.modes.mouseTrackingMode, 'the program is in front').toBe('any')

  busy = false
  await printed(session, '\r\n% ')
  await vi.waitFor(() => expect(session.term.modes.mouseTrackingMode).toBe('none'))
  expect(session.term.modes.sendFocusMode).toBe(false)
  // The keys are the line editor's by now.
  expect(session.term.modes.applicationCursorKeysMode).toBe(true)
})

test('a screen is written down without its modes, and one that has them is put back without', async () => {
  const session = await opened('m4')
  await printed(session, `${PROMPT}claude\r\n${PROGRAM_ON}a program's output`)
  session.remember()
  await written()

  const kept = files.get('null/m4') as { text: string } | undefined
  expect(kept?.text).toContain("a program's output")
  expect(kept?.text).not.toContain('\x1b[?1003h')
  expect(kept?.text).not.toContain('\x1b[?1004h')

  // A screen a build before this one wrote down, modes and all, put back by a restart.
  workspace.tabs = []
  flushSync()
  asked.length = 0
  files.set('null/m5', { cols: 80, rows: 24, at: 1, text: `old output${PROGRAM_ON}\x1b[?2004h` })
  const back = await opened('m5')
  expect(back.term.modes.mouseTrackingMode).toBe('none')
  expect(back.term.modes.sendFocusMode).toBe(false)
  expect(back.term.modes.applicationCursorKeysMode).toBe(false)
  expect(back.term.modes.bracketedPasteMode).toBe(false)
})
