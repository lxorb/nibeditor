/** Two panes becoming one while they are on screen.
 *
 *  A split drawn by PaneTree hands each side to a PaneTree of its own, and each of those
 *  reads its side out of the split it was given. When the split goes - the window
 *  narrows into a phone's, or a pane's last tab is closed - the side that is left used
 *  to read `split.sides[i]` once more, out of a split that was no longer there, and
 *  the window threw "Cannot read properties of null (reading 'sides')" and stopped
 *  drawing. What is asked is what a reader would see: no error, one pane, and the
 *  note that was kept still on screen.
 *
 *  In the jsdom project because what goes wrong is the order effects run in when a
 *  branch goes. */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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

Element.prototype.animate = function animate() {
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
const { viewport } = await import('../../src/lib/viewport.svelte')
const { views } = await import('../../src/lib/views.svelte')
const App = (await import('../../src/App.svelte')).default

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
/** What went wrong out of the test's own sight: an effect's teardown throws inside
 *  Svelte's flush, which is a microtask of its own. */
const thrown: unknown[] = []
const heard = (error: unknown) => thrown.push(error)

beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.fills = null
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  thrown.length = 0
  process.on('uncaughtException', heard)
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  process.off('uncaughtException', heard)
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  viewport.device = 'desktop'
})

async function settle() {
  for (let turn = 0; turn < 6; turn++) {
    await tick()
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

/** Two notes side by side, the given pane being worked in. */
async function sideBySide(focus: 'left' | 'right') {
  workspace.openBlank('Left', '# Left\n\nWords.')
  workspace.split('row')
  workspace.openBlank('Right', '# Right\n\nMore words.')
  const [left, right] = workspace.panes.all
  if (!left || !right) throw new Error('no second pane')
  workspace.focusPane(focus === 'left' ? left.id : right.id)
  shown = mount(App, { target })
  await settle()
  expect(target.querySelectorAll('[data-pane]')).toHaveLength(2)
  return { left: left.id, right: right.id }
}

const panesShown = () =>
  [...target.querySelectorAll('[data-pane]')].map((one) => one.getAttribute('data-pane'))

for (const focus of ['left', 'right'] as const) {
  test(`the window narrowing into a phone's keeps the ${focus} pane and throws nothing`, async () => {
    const ids = await sideBySide(focus)

    viewport.device = 'phone'
    await settle()

    expect(thrown).toEqual([])
    expect(panesShown()).toEqual([ids[focus]])
    expect(views.of(ids[focus]), 'the pane that stayed lost its editor').toBeDefined()
  })

  test(`closing the ${focus} pane's last tab leaves the other pane and throws nothing`, async () => {
    const ids = await sideBySide(focus)
    const kept = focus === 'left' ? ids.right : ids.left

    for (const gone of workspace.tabsIn(ids[focus])) workspace.close(gone.id)
    await settle()

    expect(thrown).toEqual([])
    expect(panesShown()).toEqual([kept])
    expect(views.of(kept), 'the pane that stayed lost its editor').toBeDefined()
  })
}

test('a split inside a split losing a pane keeps the other two and throws nothing', async () => {
  const ids = await sideBySide('right')
  workspace.split('column')
  await settle()
  const [, upper, lower] = workspace.panes.all.map((one) => one.id)
  if (!upper || !lower) throw new Error('no third pane')
  expect(panesShown()).toEqual([ids.left, upper, lower])

  for (const gone of workspace.tabsIn(lower)) workspace.close(gone.id)
  await settle()

  expect(thrown).toEqual([])
  expect(panesShown()).toEqual([ids.left, upper])
  expect(views.of(upper), 'the pane that stayed lost its editor').toBeDefined()
})
