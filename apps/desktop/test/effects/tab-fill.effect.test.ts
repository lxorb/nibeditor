/** Full window: a tab filling nib's window, and the window coming back as it was.
 *
 *  Emil, 2026-09-30: *"a shortcut to make the current tab full screen (to toggle that).
 *  I mean by full screen the full window of nib, not F11 behaviour."* The window itself is
 *  mounted, with the file list open and two panes side by side, and the key is pressed
 *  the way the window's handler is handed it. What is asked is what a reader would see:
 *  the list, the strips, the other pane and the status bar gone, the bar a filled window
 *  keeps up out of sight, and every one of them back, the same, on the way out - and the
 *  fill's own ends: another pane worked in, the pane emptied, a panel asked for, Escape
 *  where nothing else wants it.
 *
 *  In the jsdom project because the window is mounted and the fill's ends are an effect
 *  watching the panes. Nothing here asks about layout or paint; the drive does,
 *  test/e2e/full-window.py. */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// A browser build: no crate. Windows, so the key is Shift+F11.
vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  })
})

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

// The launch: the stores, the session and the doors, none of which is what this is
// about. The window is mounted onto a workspace this test sets up itself.
vi.mock('../../src/lib/start', () => ({ start: () => () => undefined }))

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

/** The chrome goes and comes through the Web Animations API, which jsdom does not have.
 *  How it moves is paint; each of these finishes as it is asked for. */
const moved: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
Element.prototype.animate = function animate(keyframes, options) {
  moved.push({
    keyframes: keyframes as Keyframe[],
    options: (typeof options === 'number' ? { duration: options } : options) ?? {},
  })
  return {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  } as unknown as Animation
}
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = () => undefined
// The note measures its lines on a frame of its own, and jsdom lays nothing out.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const { workspace } = await import('../../src/lib/workspace.svelte')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { viewport } = await import('../../src/lib/viewport.svelte')
const { STARTS_RIGHT } = await import('../../src/lib/workspace/panels')
const App = (await import('../../src/App.svelte')).default
// The door the key opens and the bar the window keeps, fetched before any test rather
// than by the first press; see surfaces.svelte.ts.
await import('../../src/lib/tab-fill/fill')
await import('../../src/lib/tab-fill/FillBar.svelte')

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.fills = null
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.panel = 'tree'
  workspace.right = [...STARTS_RIGHT]
  workspace.rightPanel = null
  moved.length = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  workspace.panes.fills = null
})

/** Everything the window's own handler would do with the press, and the frames the
 *  fill's door and its motion take to land. */
async function press(key: string, held: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...held,
  })
  shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })
  await settle()
  return event
}

/** Shift+F11, the key out of the box on Windows and Linux. */
const shiftF11 = () => press('F11', { shiftKey: true })

async function settle() {
  for (let turn = 0; turn < 6; turn++) {
    await tick()
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

/** Two notes side by side, the file list open, the left one being worked in. */
async function window2() {
  workspace.openBlank('Left', '# Left\n\nWords.')
  workspace.openBlank('Other', '# Other')
  workspace.split('row')
  const [left] = workspace.panes.all
  if (!left) throw new Error('no pane')
  workspace.focusPane(left.id)
  shown = mount(App, { target })
  await settle()
  return left.id
}

/** What a reader sees of the chrome: the sidebar, the strips and what is in them, the
 *  panes and the bar at the foot. */
function chrome() {
  return {
    sidebar: target.querySelector('aside')?.outerHTML ?? null,
    strips: [...target.querySelectorAll('[role="tab"], .tab')].map((one) => one.textContent),
    panes: [...target.querySelectorAll('[data-pane]')].map((one) => one.getAttribute('data-pane')),
    heads: target.querySelectorAll('[data-pane] > [data-chrome]').length,
    status: target.querySelector('[data-region="status"]') !== null,
  }
}

test('the key fills the window with the tab being worked in, and gives the window back', async () => {
  const left = await window2()
  const before = chrome()
  const layout = JSON.stringify(workspace.panes.frame)

  expect(before.sidebar).not.toBeNull()
  expect(before.panes).toHaveLength(2)
  expect(before.heads).toBe(2)

  await shiftF11()

  expect(workspace.panes.fills).toBe(left)
  const filled = chrome()
  expect(filled.sidebar, 'the file list is still on screen').toBeNull()
  expect(filled.panes, 'the other pane is still on screen').toEqual([left])
  expect(filled.heads, 'a pane still carries its own strip').toBe(0)
  expect(filled.status).toBe(false)

  // The window's bar is kept, up out of sight and out of reach of a key, and it holds the
  // filled pane's strip - which is the one strip left.
  const bar = target.querySelector('.bar')
  expect(bar).not.toBeNull()
  expect((bar as HTMLElement | null)?.inert).toBe(true)
  expect(bar?.querySelector('header')).not.toBeNull()

  // Nothing about the arrangement was changed to get there.
  expect(JSON.stringify(workspace.panes.frame)).toBe(layout)
  expect(workspace.panel).toBe('tree')

  await shiftF11()

  expect(workspace.panes.fills).toBeNull()
  expect(chrome(), 'the window came back different').toEqual(before)
  expect(target.querySelector('.bar')).toBeNull()
})

test('the chrome goes toward its edges and comes back from them, and nothing else moves', async () => {
  await window2()
  // What came in with the window (the dot of a note with no file) is not Shift+F11's.
  moved.length = 0
  await shiftF11()

  const going = moved.splice(0)
  expect(going.length).toBeGreaterThan(0)
  for (const one of going) {
    expect(one.keyframes.at(-1)).toMatchObject({ opacity: 0 })
    expect(one.options.fill).toBe('forwards')
  }

  await shiftF11()
  const coming = moved.splice(0)
  expect(coming.length).toBeGreaterThan(0)
  for (const one of coming) expect(one.keyframes.at(-1)).toMatchObject({ opacity: 1 })
})

test('another tab of the same pane keeps the window filled', async () => {
  const left = await window2()
  workspace.openBlank('Third', '# Third')
  const third = workspace.activeTabId
  await settle()
  await shiftF11()

  // Ctrl+Tab's walk, from the tab in front to the one before it.
  const [first] = workspace.tabsIn(left)
  workspace.activate(first?.id ?? '')
  await settle()
  expect(workspace.panes.fills).toBe(left)

  workspace.activate(third ?? '')
  await settle()
  expect(workspace.panes.fills).toBe(left)
})

test('working in the other pane gives the window back', async () => {
  const left = await window2()
  await shiftF11()
  expect(workspace.panes.fills).toBe(left)

  workspace.panes.focusNext()
  await settle()
  expect(workspace.panes.fills).toBeNull()
  expect(chrome().panes).toHaveLength(2)
})

test('a pane with nothing left in front gives the window back', async () => {
  const left = await window2()
  await shiftF11()

  workspace.deselect(left)
  await settle()
  expect(workspace.panes.fills).toBeNull()
})

test('asking for the file list gives the window back with the list as it was', async () => {
  await window2()
  await shiftF11()

  await press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' })
  expect(workspace.panes.fills).toBeNull()
  expect(workspace.panel).toBe('tree')
  expect(target.querySelector('aside')).not.toBeNull()
})

test('the sidebar key shows the list that was under the fill rather than shutting it', async () => {
  await window2()
  await shiftF11()

  await press('L', { ctrlKey: true, shiftKey: true, code: 'KeyL' })
  expect(workspace.panes.fills).toBeNull()
  expect(workspace.panel).toBe('tree')
})

test('Escape leaves only where nothing else has a use for it', async () => {
  await window2()
  await shiftF11()

  // The keyboard in the note: the note's.
  const note = target.querySelector<HTMLElement>('[data-pane] .cm-content')
  note?.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(workspace.panes.fills).not.toBeNull()

  // On nothing: the fill's.
  note?.blur()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(workspace.panes.fills).toBeNull()
})

test('a phone does not fill: it shows one document already', async () => {
  workspace.openBlank('One', '# One')
  shown = mount(App, { target })
  viewport.device = 'phone'
  await settle()
  await shiftF11()
  expect(workspace.panes.fills).toBeNull()
})
