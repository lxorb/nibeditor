/** Ctrl+Tab round ten web tabs, mounted the way a pane mounts them.
 *
 *  Emil, 2026-10-01: *"When I cycle with Ctrl+Tab through my tabs, some of them fully
 *  reload every time, but not when I just switch between specific ones."* A seventh
 *  running page parked the one looked at longest ago, and going round more than six tabs
 *  in order parks each one just before it comes round again: every step was a page built
 *  again. Counted here as the builds the crate is asked for, which is what a reload is.
 *  See web-tab/resting.ts. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Every call the pane made to the crate, in order. */
const asked: { command: string; args: Record<string, unknown> }[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    return Promise.resolve(undefined)
  },
}))

// The one listener the store starts for the window. Tauri's own needs the window's
// internals, which a test has none of.
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

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

/** A box for an element in the document, and a box of zeroes for one that is not, as a
 *  browser measures them; see web-switch.effect.test.ts. */
Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const rect = this.isConnected
    ? { x: 0, y: 40, width: 800, height: 560 }
    : { x: 0, y: 0, width: 0, height: 0 }
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  }
}

// Nothing of the app's is over the page.
document.elementFromPoint = () => document.querySelector('.hole')

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { saver } = await import('../../src/lib/web-tab/saver.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
const { cycleTab } = await import('../../src/lib/tab-cycle.svelte')
const { default: Cycling } = await import('./Cycling.svelte')

// What the pages store fetches the first time it is asked for something, loaded before
// any clock is stopped; see web-switch.effect.test.ts.
await Promise.all([
  import('../../src/lib/web-tab/visited'),
  import('../../src/lib/web-tab/web-data.svelte'),
  import('../../src/lib/web-tab/keys'),
  import('../../src/lib/web-tab/downloads.svelte'),
  import('../../src/lib/web-tab/resting'),
])

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
  asked.length = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  saver.set('off')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id)
  target.remove()
  vi.useRealTimers()
})

/** Every frame, turn and timer a switch sets going, on a clock the test moves. */
async function frames(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300)
}

/** Ten web tabs in one pane, each on a site of its own, the last in front. */
async function tenTabs(): Promise<string[]> {
  startup.reset()
  const shown = startup.shown()
  await frames()
  await shown

  const ids: string[] = []
  for (let at = 0; at < 10; at += 1) {
    workspace.openWebsite()
    const tab = workspace.tabs.at(-1)
    if (!tab) throw new Error('no web tab was opened')
    pages.of(tab.id).url = `https://site${String(at)}.example.com/`
    ids.push(tab.id)
  }
  return ids
}

/** Ctrl+Tab, `times` over, a moment on each tab, as a hand going round does. */
async function cycle(times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) {
    cycleTab(1)
    flushSync()
    await frames()
  }
}

/** How many times each tab's page was built. */
function builds(ids: readonly string[]): number[] {
  return ids.map(
    (id) => asked.filter((one) => one.command === 'web_open' && one.args.tab === id).length,
  )
}

test('going round ten web tabs twice builds each page once and closes none', async () => {
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()

  await cycle(20)

  expect(builds(ids)).toEqual(ids.map(() => 1))
  expect(asked.map((one) => one.command)).not.toContain('web_close')

  void unmount(pane)
})

test('and once more after a break long enough to freeze them: woken, not built', async () => {
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()
  await cycle(10)

  // Ten minutes away: every page out of sight is frozen.
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  const frozen = asked.filter((one) => one.command === 'web_pause' && one.args.paused === true)
  expect(frozen).toHaveLength(9)

  await cycle(10)

  const woken = asked.filter((one) => one.command === 'web_pause' && one.args.paused === false)
  expect(woken.map((one) => one.args.tab).sort()).toEqual(frozen.map((one) => one.args.tab).sort())
  expect(builds(ids)).toEqual(ids.map(() => 1))
  expect(asked.map((one) => one.command)).not.toContain('web_close')

  void unmount(pane)
})

test('with Memory saver at its most, the old cap comes back', async () => {
  saver.set('maximum')
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()

  await cycle(20)

  expect(asked.filter((one) => one.command === 'web_close').length).toBeGreaterThan(0)
  expect(builds(ids).some((count) => count > 1)).toBe(true)

  void unmount(pane)
})
