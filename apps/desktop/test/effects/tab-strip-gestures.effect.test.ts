/** The strip under the hand: a pick of tabs made with Ctrl and Shift, and a tab closed
 *  with its cross.
 *
 *  Emil, 2026-10-03: *"multi-select of tabs no longer works properly"* and *"the tab close
 *  animation is a bit buggy"*. The strip is mounted on the real workspace and pressed the
 *  way a pointer presses it, and what is asked is what a reader sees: which tabs wear the
 *  pick, what their menu is about and what Ctrl+W closes; and, as a tab goes, that it goes
 *  as a tab no longer in front - one tab in front, never two - with the others holding
 *  their widths so the next cross is under the pointer.
 *
 *  In the jsdom project because the strip is mounted. jsdom lays nothing out, so the strip
 *  is told its width the way a ResizeObserver tells it; how the tabs move is paint, which
 *  test/e2e/tab-close.py drives frame by frame. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

/** How wide the strip is: room for the tabs to be narrower than they would like, which
 *  is when a close holds the widths. */
const STRIP = 600

/** jsdom never measures anything; the strip's width is said the moment it is watched. */
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

/** A tab arrives and leaves through the Web Animations API, which jsdom has not got. One
 *  that never says it finished: a tab on its way out stays on the page to be looked at. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: new Promise(() => undefined),
    currentTime: 0,
    startTime: 0,
    playState: 'running',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = () => undefined

const { workspace } = await import('../../src/lib/workspace.svelte')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { picks } = await import('../../src/lib/tab-strip/drag.svelte')
const { tabMenuTitle } = await import('../../src/lib/tab-strip/menu')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default
// Fetched by the strip once it is up, and here first so no test waits on compiling them.
await import('../../src/lib/tab-strip/closing.svelte')
await import('../../src/lib/tab-strip/picking.svelte')

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  picks.loaded?.chosen.clear()
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
})

const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/** Ten notes in the one pane, the strip on the page, measured, and the first in front. */
async function strip() {
  for (const name of NAMES) workspace.openBlank(name, `# ${name}`)
  const paneId = workspace.panes.focusedId
  const tabs = workspace.tabsIn(paneId)
  workspace.activate(tabs[0]?.id ?? '')
  shown = mount(Tabs, { target, props: { paneId } })
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector<HTMLElement>('.tab')?.style.width).not.toBe('')
  })

  return { paneId, ids: tabs.map((one) => one.id) }
}

const pick = (id: string) => target.querySelector<HTMLElement>(`.pick[data-tab="${id}"]`)
const box = (id: string) => target.querySelector<HTMLElement>(`[data-box="${id}"]`)
const picked = () =>
  [...target.querySelectorAll<HTMLElement>('.tab.chosen')].map((one) => one.dataset.box)

/** A press and its release on a tab, as a mouse makes them. */
function press(id: string, held: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const node = pick(id)
  if (!node) throw new Error(`no tab ${id}`)
  const at = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: 'mouse',
    detail: 1,
    ...held,
  }
  node.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }))
  node.dispatchEvent(new PointerEvent('pointerup', at))
  node.dispatchEvent(new MouseEvent('click', at))
  flushSync()
}

test('Ctrl and Shift pick tabs, their menu is about all of them, and Ctrl+W closes them', async () => {
  const { paneId, ids } = await strip()
  const [one, two, three, four] = ids as [string, string, string, string]

  press(two, { ctrlKey: true })
  await vi.waitFor(() => expect(picks.loaded).not.toBeNull())
  flushSync()
  expect(picked()).toEqual([one, two])
  expect(workspace.activeTabId).toBe(two)

  // Shift: a run from the last one clicked, in place of what was picked.
  press(four, { shiftKey: true })
  expect(picked()).toEqual([two, three, four])
  expect(workspace.activeTabId).toBe(four)

  // Ctrl again takes one out, and the pick stays put through the release.
  press(three, { ctrlKey: true })
  expect(picked()).toEqual([two, four])

  const front = workspace.tabs.find((tab) => tab.id === four)
  if (!front) throw new Error('nothing in front')
  expect(tabMenuTitle(front, paneId)).toBe('2 tabs')

  const event = new KeyboardEvent('keydown', {
    key: 'w',
    code: 'KeyW',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  expect(shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })).toBe(
    true,
  )
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.id)).not.toContain(two))
  expect(workspace.tabs.map((tab) => tab.id)).not.toContain(four)
  expect(workspace.tabs).toHaveLength(NAMES.length - 2)
})

test('a plain click on a picked tab picks it alone; a Ctrl click on one keeps the pick', async () => {
  const { ids } = await strip()
  const [one, two, three] = ids as [string, string, string]

  press(two, { ctrlKey: true })
  await vi.waitFor(() => expect(picks.loaded).not.toBeNull())
  press(three, { ctrlKey: true })
  expect(picked()).toEqual([one, two, three])

  // Chrome: Ctrl on a tab that stays picked and comes to the front may go on to drag
  // the pick, and its release leaves the pick as it is.
  press(three, { ctrlKey: true })
  press(three, { ctrlKey: true })
  expect(picked()).toEqual([one, two, three])

  press(one)
  expect(picked()).toEqual([])
  expect(workspace.activeTabId).toBe(one)
})

test('a tab closed with its cross goes as no longer in front, and the rest hold their widths', async () => {
  const { ids } = await strip()
  const [one, two] = ids as [string, string]
  // Tabs.svelte fetches the held widths as it mounts.
  await vi.waitFor(() => expect(box(one)?.querySelector('.shut')).not.toBeNull())
  await new Promise((done) => setTimeout(done, 0))

  const before = new Map(ids.map((id) => [id, box(id)?.style.width]))
  const cross = box(one)?.querySelector<HTMLButtonElement>('.shut')
  cross?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.id)).not.toContain(one))
  flushSync()

  // Still on the page, shrinking - and drawn as a tab that is not in front, nothing of
  // it under the pointer.
  const going = box(one)
  expect(going).not.toBeNull()
  expect(going?.classList.contains('leaving')).toBe(true)
  expect(going?.classList.contains('active')).toBe(false)

  // One tab in front, never two: the next one, from the same frame.
  expect(
    [...target.querySelectorAll('.tab.active')].map((node) => (node as HTMLElement).dataset.box),
  ).toEqual([two])

  // Every other tab keeps the width it had, so the next cross is where this one was. The
  // one now in front may only grow to an active tab's least width; at this room they are
  // all wider than that already.
  for (const id of ids.slice(1)) expect(box(id)?.style.width, id).toBe(before.get(id))
})
