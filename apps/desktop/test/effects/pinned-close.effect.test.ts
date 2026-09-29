/** Ctrl+W on a pinned tab, from the window to the question and back.
 *
 *  Emil, 2026-09-30, in German: a pinned tab closed with Ctrl+W asks first whether it
 *  should really go, and one closed from its right-click menu does not. What is asked
 *  and why is workspace/closing-pinned.ts; this is the gesture in order, the shape
 *  new-kind-chord.effect.test.ts has: the real window handler as App.svelte writes it,
 *  the real registry, the real question sheet mounted, and real `keydown` events.
 *
 *  In the jsdom project because focus, a dialog and a keystroke need a document. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'windows',
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(command === 'read_note' ? `# ${String(args?.path)}` : undefined),
}))

/** The sheet rises through the Web Animations API, which jsdom has not got. */
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

const { overlays } = await import('../../src/lib/overlays')
const { prompt } = await import('../../src/lib/prompt.svelte')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { replay } = await import('../../src/lib/web-tab/keys')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { tabMenu } = await import('../../src/lib/tab-strip/menu')
const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
// Fetched by the first question, and fetched here first so no test waits on compiling it.
await import('../../src/lib/workspace/closing-pinned')

const PATHS = ['/space/a.md', '/space/b.md', '/space/c.md']

let target: HTMLElement
let close: () => void
let unhandle: () => void

/** App.svelte's own window handler, as much of it as a close reaches: Escape closes
 *  the layer on top, and everything else goes to the registry. */
function windowHandler() {
  const handler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && overlays.escape(event)) return
    shortcuts.handle(event, {
      view: undefined,
      palette: () => undefined,
      fullscreen: () => undefined,
    })
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

const strip = () => workspace.tabs.map((tab) => tab.path)

function tabAt(path: string) {
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} is not open`)
  return tab
}

/** Three notes open, the first of them pinned and in front. */
async function pinnedInFront() {
  for (const path of PATHS) await workspace.open(path)
  workspace.togglePin(tabAt('/space/a.md').id)
  workspace.activeTabId = tabAt('/space/a.md').id
}

function press(key: string, held: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }),
  )
}

const ctrlW = (repeat = false) => {
  press('w', { code: 'KeyW', ctrlKey: true, repeat })
}

/** The sheet on the page, once the question has been fetched and put. */
async function asked(): Promise<HTMLElement> {
  await vi.waitFor(() => {
    expect(prompt.open).toBe(true)
  })
  flushSync()

  const sheet = target.querySelector<HTMLElement>('[role="dialog"]')
  if (!sheet) throw new Error('no question on the page')
  return sheet
}

/** Every close already in the air, answered: a close that asks nothing is still a
 *  promise, and a test that looks too soon sees a tab that is about to go. */
async function settled() {
  for (let turn = 0; turn < 5; turn++) await new Promise((done) => setTimeout(done, 0))
  flushSync()
}

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  target = document.createElement('div')
  document.body.append(target)
  const drawn = mount(PromptSheet, { target })
  close = () => void unmount(drawn, { outro: false })
  unhandle = windowHandler()
})

afterEach(() => {
  prompt.dismiss()
  flushSync()
  unhandle()
  close()
  target.remove()
  workspace.tabs = []
})

test('Ctrl+W on a pinned tab asks, and Escape keeps it', async () => {
  await pinnedInFront()

  ctrlW()
  const sheet = await asked()

  expect(sheet.getAttribute('aria-label')).toBe('Close pinned tab?')
  // Enter answers whichever button holds the keyboard, and that is Close.
  expect(document.activeElement?.textContent.trim()).toBe('Close')

  press('Escape')
  await settled()

  expect(prompt.open).toBe(false)
  expect(strip()).toEqual(PATHS)
})

test('and the button the keyboard is on closes it', async () => {
  await pinnedInFront()

  ctrlW()
  await asked()
  const on = document.activeElement
  if (!(on instanceof HTMLButtonElement)) throw new Error('the keyboard is on no button')
  on.click()
  await settled()

  expect(strip()).toEqual(['/space/b.md', '/space/c.md'])
})

test('a held Ctrl+W puts up one question and closes nothing behind it', async () => {
  await pinnedInFront()

  ctrlW()
  await asked()
  for (let again = 0; again < 5; again++) ctrlW(true)
  // A second press, let go of and pressed again, is no answer either.
  ctrlW()
  await settled()

  expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(prompt.open).toBe(true)
  expect(strip()).toEqual(PATHS)

  // One layer, so one Escape takes it down and leaves nothing standing.
  press('Escape')
  await settled()

  expect(overlays.depth).toBe(0)
  expect(strip()).toEqual(PATHS)
})

test('Ctrl+W on a tab that is not pinned closes it without a word', async () => {
  await pinnedInFront()
  workspace.activeTabId = tabAt('/space/c.md').id

  ctrlW()
  await settled()

  expect(prompt.open).toBe(false)
  expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
})

test('Close in a pinned tab’s own menu closes it without a word', async () => {
  await pinnedInFront()
  const tab = tabAt('/space/a.md')

  const row = tabMenu(tab, tab.paneId).find((entry) => entry?.label === 'Close')
  if (!row) throw new Error('the menu has no Close')
  row.run()
  await settled()

  expect(prompt.open).toBe(false)
  expect(strip()).toEqual(['/space/b.md', '/space/c.md'])
})

/** The key a web tab's page never gets, as the crate hands it back to the window; see
 *  web_keys.rs and web-tab/keys.ts. */
test('Ctrl+W pressed inside a web page asks the same question', async () => {
  await pinnedInFront()

  replay({
    key: 'w',
    code: 'KeyW',
    ctrl: true,
    shift: false,
    alt: false,
    repeat: false,
    down: true,
  })
  const sheet = await asked()

  expect(sheet.getAttribute('aria-label')).toBe('Close pinned tab?')
  expect(strip()).toEqual(PATHS)
})
