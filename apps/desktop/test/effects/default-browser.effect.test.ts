/** The Default browser row, pressed through.
 *
 *  Three states and the moments between them: nothing until the system has answered,
 *  so a button never turns into a tick in front of somebody; the button while nib is
 *  not the browser; the tick once it is. And the press itself answers nothing - the
 *  system asks in a page or a dialog of its own - so what has to be right is that the
 *  row asks again when the window has the keyboard back, and that a press the build
 *  refuses says so. See src/lib/settings/DefaultBrowser.svelte.
 *
 *  In the jsdom project because it mounts a component whose effects run. The crate is
 *  a stand-in that answers the two commands and writes down what it was asked. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  /** What `default_browser` answers. */
  is: false,
  /** What `make_default_browser` does: nothing, or refuse. */
  refuse: null as string | null,
  asked: [] as string[],
  /** The window's focus listener, once the row has put it up. */
  focus: null as ((event: { payload: boolean }) => void) | null,
  stopped: 0,
}))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: (command: string) => {
    world.asked.push(command)
    if (command === 'default_browser') return Promise.resolve(world.is)
    if (command === 'make_default_browser' && world.refuse !== null) {
      return Promise.reject(new Error(world.refuse))
    }
    return Promise.resolve(null)
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      world.focus = handler
      return Promise.resolve(() => {
        world.stopped++
      })
    },
  }),
}))

const { default: DefaultBrowser } = await import('../../src/lib/settings/DefaultBrowser.svelte')
const { settings } = await import('../../src/lib/settings.svelte')

/** jsdom has no animations, and the control fades in. */
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

let host: HTMLElement
let shown: ReturnType<typeof mount> | null = null

/** Everything in flight answered and drawn. */
async function settled() {
  for (let round = 0; round < 5; round++) await Promise.resolve()
  await vi.waitFor(() => undefined)
  flushSync()
}

function open() {
  shown = mount(DefaultBrowser, { target: host })
  flushSync()
}

/** The window's own events are fetched rather than carried, so the listener is up a
 *  module load after the row is. */
async function listening() {
  await vi.waitFor(() => {
    if (!world.focus) throw new Error('not listening to the window yet')
  })
}

const button = () => host.querySelector('button')
const tick = () => host.querySelector('svg.tick')

beforeEach(() => {
  world.is = false
  world.refuse = null
  world.asked = []
  world.focus = null
  world.stopped = 0
  settings.error = null
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  host.remove()
})

test('shows nothing until the system has answered', async () => {
  open()
  expect(button()).toBeNull()
  expect(tick()).toBeNull()

  await settled()
  expect(button()?.textContent.trim()).toBe('Make default')
})

test('a browser already set says so with the tick and offers nothing to press', async () => {
  world.is = true
  open()
  await settled()

  expect(tick()?.getAttribute('aria-label')).toBe('Default')
  expect(button()).toBeNull()
})

test('the press asks the system, and the row asks again when the window comes back', async () => {
  open()
  await settled()
  await listening()

  button()?.click()
  await settled()
  expect(world.asked).toEqual(['default_browser', 'make_default_browser', 'default_browser'])
  // The system's own page is up: nothing has changed yet, so the button stays.
  expect(button()).not.toBeNull()

  // Somebody chose nib there and came back.
  world.is = true
  world.focus?.({ payload: true })
  await settled()
  expect(tick()).not.toBeNull()
  expect(button()).toBeNull()

  // Leaving the window again asks nothing.
  const asked = world.asked.length
  world.focus?.({ payload: false })
  await settled()
  expect(world.asked.length).toBe(asked)
})

test('a press the build refuses says why, and the row stays as it was', async () => {
  world.refuse = 'only the installed app can be the default browser'
  open()
  await settled()

  button()?.click()
  await settled()

  expect(settings.error).toBe('only the installed app can be the default browser')
  expect(button()).not.toBeNull()
})

test('closing the settings stops listening to the window', async () => {
  open()
  await settled()
  await listening()

  if (shown) void unmount(shown)
  shown = null
  expect(world.stopped).toBe(1)
})
