/** A key that is both the app's and the shell's, pressed in a terminal.
 *
 *  Emil, issue #213: *"when pressing a shortcut in a terminal like interface or anywhere
 *  where it could have mulitple meanings then there should be a quick modal asking you
 *  which of the two should be used from now on (or you can tick always ask)"*. Ctrl+N is
 *  the scratchpad and the shell's next line, Ctrl+T a new tab and its swapped letters.
 *  The first press asks; the answer is the press, given where it was meant; and it is
 *  kept, unless "Always ask" was ticked. See terminal/two-ways.ts.
 *
 *  xterm.js itself and the real question sheet, with the crate stood in for: what the
 *  shell is given is what the window asked `pty_write` to write. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Everything the window asked the crate to write to the shell, in order. */
const typed: string[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => 'windows',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'pty_write') typed.push(String(args.data))
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1 })
    if (command === 'pty_busy') return Promise.resolve(false)
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

/** The sheet rises through the Web Animations API, which jsdom does not implement. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { prompt } = await import('../../src/lib/prompt.svelte')
const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
const { flushSync, mount, unmount } = await import('svelte')
const { written } = await import('../../src/lib/parting')

type Opened = ReturnType<typeof sessionOf>

let sheet: ReturnType<typeof mount> | undefined
/** The keys the window heard, as App.svelte's handler would have. */
const heard: string[] = []
const hear = (event: KeyboardEvent) => {
  heard.push(`${event.ctrlKey ? 'Ctrl+' : ''}${event.key}`)
}

/** A terminal tab, drawn, with its shell started. */
async function opened(key: string): Promise<Opened> {
  const words = JSON.stringify({ shell: 'pwsh', folder: null, key })
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
  await vi.waitFor(() => expect(session.term.textarea).toBeDefined())
  return session
}

/** Ctrl and a letter, pressed with the terminal's keyboard. */
function press(session: Opened, letter: string) {
  session.term.textarea?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      keyCode: letter.toUpperCase().charCodeAt(0),
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  flushSync()
}

/** The answer on the sheet with these words. */
function answer(words: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.row button')].find(
    (one) => one.textContent.trim() === words,
  )
  if (!button) throw new Error(`no answer ${words}`)
  button.click()
  flushSync()
}

beforeEach(() => {
  typed.length = 0
  heard.length = 0
  for (const command of Object.keys(shells.ways)) shells.setWay(command, null)
  sheet = mount(PromptSheet, { target: document.body })
  window.addEventListener('keydown', hear)
})

afterEach(async () => {
  window.removeEventListener('keydown', hear)
  prompt.dismiss()
  if (sheet) void unmount(sheet)
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('the first Ctrl+N asks, and gives neither the shell nor the app the press meanwhile', async () => {
  const session = await opened('w1')
  press(session, 'n')

  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()
  expect(prompt.title).toBe('Ctrl+N in a terminal')
  expect(prompt.options.map((one) => one.label)).toEqual(['Terminal', 'Scratchpad'])
  expect(prompt.tick).toBe('Always ask')
  expect(typed).toEqual([])
  expect(heard).toEqual([])
})

test('the shell, chosen, is given the character, and keeps it from then on', async () => {
  const session = await opened('w2')
  press(session, 'n')
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()

  answer('Terminal')
  await vi.waitFor(() => expect(typed).toEqual(['\x0e']))
  expect(shells.ways['app.scratchpad']).toBe('shell')
  expect(heard).toEqual([])

  // Kept: the next press goes straight to the shell, asking nothing.
  press(session, 'n')
  await vi.waitFor(() => expect(typed).toEqual(['\x0e', '\x0e']))
  expect(prompt.open).toBe(false)
})

test('the app, chosen, is the press played on the window, as the key it was', async () => {
  const session = await opened('w3')
  press(session, 't')
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()

  answer('New tab')
  await vi.waitFor(() => expect(heard).toEqual(['Ctrl+t']))
  expect(typed).toEqual([])
  expect(shells.ways['app.new-kind']).toBe('app')

  // And from then on the terminal lets the window have it, as any app key.
  press(session, 't')
  expect(heard).toEqual(['Ctrl+t', 'Ctrl+t'])
  expect(prompt.open).toBe(false)
})

test('"Always ask" keeps nothing, and asks again', async () => {
  const session = await opened('w4')
  press(session, 'n')
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()

  const tick = document.querySelector<HTMLInputElement>('.tick input')
  tick?.click()
  flushSync()
  answer('Terminal')

  await vi.waitFor(() => expect(typed).toEqual(['\x0e']))
  expect(shells.ways['app.scratchpad']).toBeUndefined()

  press(session, 'n')
  await vi.waitFor(() => expect(prompt.open).toBe(true))
})

test('put away, the question gives the press to nobody', async () => {
  const session = await opened('w5')
  press(session, 'n')
  await vi.waitFor(() => expect(prompt.open).toBe(true))

  prompt.dismiss()
  await new Promise((settle) => setTimeout(settle, 20))

  expect(typed).toEqual([])
  expect(heard).toEqual([])
  expect(shells.ways['app.scratchpad']).toBeUndefined()
})
