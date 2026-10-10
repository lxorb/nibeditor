/** A picture pasted into a coding agent in a terminal.
 *
 *  Emil, issue 228: _"inserting images into claude session with alt + v should also
 *  work"_. Claude Code reads the clipboard itself when Alt+V (Ctrl+V off Windows) is
 *  pressed. In a terminal on this computer the key only has to reach it, as ESC and the
 *  letter, the way Windows Terminal sends it. On another machine the clipboard is this
 *  computer's and not that one's, so the picture is carried over and its path there is
 *  what the terminal pastes. See terminal/images.ts.
 *
 *  xterm.js itself, with the crate and the clipboard stood in for: what the shell is
 *  given is what the window asked `pty_write` to write. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Everything the window asked the crate to write to the shell, in order. */
const typed: string[] = []
/** Every picture the window asked the crate to carry to a host. */
const carried: Record<string, unknown>[] = []
/** Whether the host refuses the picture. */
let refuse = false

const PATH = '/home/emil/.cache/nib/images/nib-0011223344556677.png'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'pty_write') typed.push(String(args.data))
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1 })
    if (command === 'pty_busy') return Promise.resolve(false)
    if (command === 'remote_hosts') {
      return Promise.resolve({
        config: [{ id: 'pi', also: [], hostname: '10.0.0.5' }],
        kept: { own: [], about: {}, order: [], groups: [] },
        file: null,
      })
    }
    if (command === 'remote_image') {
      carried.push(args)
      return refuse ? Promise.reject(new Error('Permission denied')) : Promise.resolve(PATH)
    }
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

/** What the clipboard holds: a picture, or text, or nothing. */
let clipboard: { picture?: Uint8Array; text?: string } = {}
const reads = { count: 0 }

/** A picture as the clipboard and a paste hand one over. */
const pictureFile = (bytes: Uint8Array) =>
  ({
    type: 'image/png',
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  }) as unknown as File

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    read: () => {
      reads.count += 1
      const { picture } = clipboard
      return Promise.resolve(
        picture
          ? [{ types: ['image/png'], getType: () => Promise.resolve(pictureFile(picture)) }]
          : [],
      )
    },
    readText: () => Promise.resolve(clipboard.text ?? ''),
    writeText: () => Promise.resolve(),
  },
})

const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { openRemote } = await import('../../src/lib/remote/open')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { busy } = await import('../../src/lib/busy.svelte')
const { flushSync } = await import('svelte')
const { written } = await import('../../src/lib/parting')

type Opened = ReturnType<typeof sessionOf>

/** The keys the window heard, as App.svelte's handler would have. */
const heard: string[] = []
const hear = (event: KeyboardEvent) => {
  heard.push(event.key)
}

let place: HTMLElement

/** A local shell's terminal, drawn, with its shell started. */
async function local(key: string): Promise<Opened> {
  const words = JSON.stringify({ shell: '/bin/bash', folder: null, key })
  const doc = new NoteDoc(
    { kind: 'terminal', path: null, name: 'bash', text: words, dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  workspace.tabs = [...workspace.tabs, tab]
  return drawn(sessionOf(tab))
}

/** A terminal on `pi`, made by Remote in this run, drawn and connected. */
async function remote(): Promise<Opened> {
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  return drawn(sessionOf(tab))
}

async function drawn(session: Opened): Promise<Opened> {
  await session.attach(place, false)
  await vi.waitFor(() => expect(session.term.textarea).toBeDefined())
  // The shell started: a key typed now reaches it.
  await new Promise((settle) => setTimeout(settle, 10))
  return session
}

/** A letter with Alt, or Ctrl, pressed with the terminal's keyboard. */
function press(session: Opened, letter: string, held: 'alt' | 'ctrl') {
  session.term.textarea?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      keyCode: letter.toUpperCase().charCodeAt(0),
      altKey: held === 'alt',
      ctrlKey: held === 'ctrl',
      bubbles: true,
      cancelable: true,
    }),
  )
  flushSync()
}

/** A paste carrying `text`, or a picture and no text. */
function paste(session: Opened, what: { text?: string; picture?: Uint8Array }) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? (what.text ?? '') : ''),
      files: what.picture ? [pictureFile(what.picture)] : [],
    },
  })
  session.term.textarea?.dispatchEvent(event)
}

beforeEach(() => {
  typed.length = 0
  carried.length = 0
  heard.length = 0
  reads.count = 0
  refuse = false
  clipboard = {}
  busy.clear()
  shells.restoring = false
  workspace.panes.collapse()
  workspace.tabs = []
  place = document.createElement('div')
  document.body.append(place)
  window.addEventListener('keydown', hear)
})

afterEach(async () => {
  window.removeEventListener('keydown', hear)
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('a local terminal hands Alt+V to the shell as ESC and the letter, reading nothing', async () => {
  clipboard = { picture: new Uint8Array([1, 2, 3]) }
  const session = await local('img-1')

  press(session, 'v', 'alt')
  press(session, 'k', 'alt')
  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe('\x1bv\x1bk\x16'))
  expect(heard).toEqual([])
  expect(reads.count).toBe(0)
  expect(carried).toEqual([])
})

test('in a remote terminal Alt+V carries the clipboard’s picture over and pastes its path', async () => {
  clipboard = { picture: new Uint8Array([1, 2, 3]) }
  const session = await remote()

  press(session, 'v', 'alt')
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toEqual([{ host: 'pi', kind: 'png', base64: 'AQID' }])
  expect(heard).toEqual([])
})

test('so does Ctrl+V, Claude Code’s key off Windows', async () => {
  clipboard = { picture: new Uint8Array([4]) }
  const session = await remote()

  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toHaveLength(1)
})

test('with no picture on the clipboard the key goes to the shell as it would have', async () => {
  clipboard = { text: 'words' }
  const session = await remote()

  press(session, 'v', 'alt')
  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe('\x1bv\x16'))
  expect(carried).toEqual([])
})

test('a paste with a picture and no text is carried over; one with text is the text', async () => {
  const session = await remote()

  paste(session, { picture: new Uint8Array([1, 2, 3]) })
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toHaveLength(1)

  typed.length = 0
  paste(session, { text: 'ls', picture: new Uint8Array([1]) })
  await vi.waitFor(() => expect(typed.join('')).toBe('ls'))
  expect(carried).toHaveLength(1)
})

test('a local terminal pastes only text, as it always has', async () => {
  const session = await local('img-2')

  paste(session, { picture: new Uint8Array([1, 2, 3]) })
  await new Promise((settle) => setTimeout(settle, 20))
  expect(typed).toEqual([])
  expect(carried).toEqual([])
})

test('a host that refuses the picture says so across the top, and nothing is pasted', async () => {
  refuse = true
  clipboard = { picture: new Uint8Array([1]) }
  const session = await remote()

  press(session, 'v', 'alt')
  await vi.waitFor(() => expect(busy.trouble).toBe('Could not send the image'))
  expect(typed).toEqual([])
})
