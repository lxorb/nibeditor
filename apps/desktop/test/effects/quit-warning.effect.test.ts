import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The question before quitting, as the reader meets it: nothing asked while every shell
 *  waits at its prompt, the busy ones named in nib's own sheet when one runs something,
 *  and each answer going back to the crate - Quit anyway, Cancel, Don't ask again, a row
 *  pressed. And a window's own close, and an AI turn in flight, which are rows too.
 *
 *  In the jsdom project because the sheet needs a document. */

/** What the crate is asked, in order, and what each terminal's shell is doing. */
const asked: string[] = []
const busy = new Map<string, boolean>()
let others: string[] = []

vi.mock('../../src/lib/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => 'windows',
  invoke: (command: string, args?: { id?: string }) => {
    asked.push(command)
    if (command === 'pty_busy') return Promise.resolve(busy.get(args?.id ?? '') ?? false)
    if (command === 'quit_others') return Promise.resolve(others)
    return Promise.resolve(undefined)
  },
}))

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

/** The sheet rises through the Web Animations API, which jsdom does not implement. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { quitAsked, mayStop } = await import('../../src/lib/quitting/ask')
const { quitAsk } = await import('../../src/lib/quitting/state.svelte')
const { setPty } = await import('../../src/lib/terminal/running')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { anythingRuns } = await import('../../src/lib/parting')
type Tab = import('../../src/lib/workspace.svelte').Tab

/** A terminal tab with its shell running, as much of one as the question reads. */
function terminal(id: string, shown: string, program: string | null): Tab {
  setPty(id, `pty-${id}`)
  busy.set(`pty-${id}`, program !== null)
  return {
    id,
    kind: 'terminal',
    paneId: 'p',
    shown,
    doc: '{"shell":"pwsh"}',
    running: { name: null, program, host: null, colour: null },
  } as unknown as Tab
}

const sheet = () => document.querySelector('[role="alertdialog"]')
const names = () => [...document.querySelectorAll('.rows .name')].map((one) => one.textContent)
const button = (words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.row button')].find(
    (one) => one.textContent.trim() === words,
  )

let was: Tab[]

beforeEach(() => {
  was = workspace.tabs
  asked.length = 0
  others = []
  shells.setWarning('running')
  workspace.tabs = [
    terminal('a', 'claude · nib', 'claude'),
    terminal('b', 'PowerShell · nib', null),
  ]
})

afterEach(() => {
  if (quitAsk.open) quitAsk.answer('stay')
  flushSync()
  for (const tab of workspace.tabs) setPty(tab.id, null)
  workspace.tabs = was
})

/** The crate's quit, as far as the question: what it answers, held in an object so the
 *  await here does not wait for it. */
async function quitting(): Promise<{ answered: Promise<void> }> {
  const answered = quitAsked()
  await vi.waitFor(() => expect(quitAsk.open).toBe(true))
  flushSync()
  return { answered }
}

test('a shell is running, so a close has something to ask about', () => {
  expect(anythingRuns()).toBe(true)
})

test('only the busy terminal is named, and Quit anyway goes on', async () => {
  const { answered } = await quitting()

  expect(sheet()?.querySelector('.title')?.textContent).toBe('Quit nibeditor?')
  expect(names()).toEqual(['claude · nib'])
  expect(asked).toContain('quit_show')

  button('Quit anyway')?.click()
  await answered
  expect(asked.at(-1)).toBe('quit_confirmed')
  expect(shells.warning).toBe('running')
})

test('Cancel keeps everything running', async () => {
  const { answered } = await quitting()
  button('Cancel')?.click()
  await answered
  expect(asked.at(-1)).toBe('keep_running')
})

test('nothing but shells at their prompt: no question at all', async () => {
  busy.set('pty-a', false)
  await quitAsked()
  expect(quitAsk.open).toBe(false)
  expect(asked.at(-1)).toBe('quit_confirmed')
  expect(asked).not.toContain('quit_show')
})

test("Don't ask again is Settings' Never, and the next quit asks nothing", async () => {
  const { answered } = await quitting()
  const never = document.querySelector<HTMLInputElement>('.never input')
  never?.click()
  flushSync()
  button('Quit anyway')?.click()
  await answered
  expect(shells.warning).toBe('never')

  asked.length = 0
  await quitAsked()
  expect(asked).toEqual(['quit_confirmed'])
})

test('Always lists the idle shells as well', async () => {
  shells.setWarning('always')
  const { answered } = await quitting()
  expect(names()).toEqual(['claude · nib', 'PowerShell · nib'])
  quitAsk.answer('stay')
  await answered
})

test('a row pressed calls the quit off and goes to its tab', async () => {
  const shown = vi.spyOn(workspace, 'activeTabId', 'set').mockImplementation(() => undefined)
  const { answered } = await quitting()

  document.querySelector<HTMLButtonElement>('.rows button')?.click()
  await answered
  expect(asked.at(-1)).toBe('keep_running')
  expect(shown).toHaveBeenCalledWith('a')
  shown.mockRestore()
})

test("a window's own close names its own, and says close while another window stays", async () => {
  others = ['nib-2']
  const closing = mayStop('window')
  await vi.waitFor(() => expect(quitAsk.open).toBe(true))
  flushSync()

  expect(sheet()?.querySelector('.title')?.textContent).toBe('Close window?')
  expect(asked).not.toContain('quit_show')
  button('Close anyway')?.click()
  expect(await closing).toBe(true)
})

test('the last window closing is the app quitting', async () => {
  const closing = mayStop('window')
  await vi.waitFor(() => expect(quitAsk.open).toBe(true))
  flushSync()
  expect(sheet()?.querySelector('.title')?.textContent).toBe('Quit nibeditor?')
  button('Cancel')?.click()
  expect(await closing).toBe(false)
})

test("an update's restart asks the same way", async () => {
  const restarting = mayStop('restart')
  await vi.waitFor(() => expect(quitAsk.open).toBe(true))
  flushSync()
  expect(sheet()?.querySelector('.title')?.textContent).toBe('Restart nibeditor?')
  button('Restart anyway')?.click()
  expect(await restarting).toBe(true)
})

test('an AI turn in flight is a row, named by its thread', async () => {
  busy.set('pty-a', false)
  const { watching } = await import('../../src/lib/ai/chat/sends')
  let finish = () => undefined as void
  const engine = watching({
    send: () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  } as never)
  const sending = engine.send(
    { id: 't1', title: 'Fix the build', provider: 'none' } as never,
    {} as never,
    () => undefined,
    new AbortController().signal,
  )

  const { answered } = await quitting()
  expect(names()).toEqual(['Fix the build'])
  quitAsk.answer('stay')
  await answered
  finish()
  await sending
})
