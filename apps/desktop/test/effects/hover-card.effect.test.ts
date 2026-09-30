/** Chrome's hover card under a tab, with the clock in the test's hands.
 *
 *  What the drive cannot time exactly: the card waits Chrome's delay before the first
 *  showing and none before the next, goes when the pointer has left the strip and not
 *  when it only moved to the tab beside, goes on any press and stays away from the tab
 *  pressed, and never comes while anything of the app's is open or under a finger. See
 *  lib/tab-strip/hover-card.svelte.ts, and tabs-hints.py for the same in a browser.
 *
 *  In the jsdom project because the card is a component the store mounts. */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

/** The card arrives and leaves through the Web Animations API, which jsdom does not
 *  have. How it moves is paint. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    onfinish: null,
  }) as unknown as Animation

const { hovering } = await import('../../src/lib/tab-strip/hover-card.svelte')
const { showDelay } = await import('../../src/lib/tab-strip/card')
const { overlays } = await import('../../src/lib/overlays')
const { viewport } = await import('../../src/lib/viewport.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

/** Only what the card reads of a tab. */
function tab(id: string, shown: string): Tab {
  // A stand-in, because a real tab is built round a document read off a disk.
  return { id, shown, kind: 'note', path: null, paneId: 'nowhere' } as unknown as Tab
}

const BOX = { left: 100, right: 300, bottom: 38 }
const WIDEST = 238
const alpha = tab('a', 'Alpha')
const beta = tab('b', 'Beta')

const shownFor = () => hovering.card?.title ?? null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  hovering.hush()
  hovering.leave('a')
  hovering.leave('b')
  vi.runAllTimers()
  vi.useRealTimers()
  viewport.device = 'desktop'
})

/** Lets the card's own promise settle, which it does before it is drawn. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  flushSync()
}

test("waits Chrome's delay before the first card, and is drawn", async () => {
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
  await vi.advanceTimersByTimeAsync(showDelay(WIDEST) - 50)
  expect(shownFor()).toBeNull()

  await vi.advanceTimersByTimeAsync(60)
  await settle()
  expect(shownFor()).toBe('Alpha')
  expect(document.querySelector('.card')?.textContent).toContain('Alpha')
})

test('moves to the tab beside at once, and goes once the pointer has left the strip', async () => {
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
  await vi.advanceTimersByTimeAsync(showDelay(WIDEST) + 10)
  await settle()

  // Left one tab for the next: the leave and the enter come in the same breath.
  hovering.leave('a')
  hovering.enter({ tab: beta, box: { ...BOX, left: 300, right: 500 }, widest: WIDEST })
  await settle()
  expect(shownFor()).toBe('Beta')
  expect(hovering.card?.sliding).toBe(true)

  hovering.leave('b')
  await settle()
  expect(shownFor()).toBeNull()

  // Back on the strip a moment later: at once, the pointer only slipped off.
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
  await settle()
  expect(shownFor()).toBe('Alpha')
})

test('goes on a press, and says nothing more about the tab pressed', async () => {
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
  await vi.advanceTimersByTimeAsync(showDelay(WIDEST) + 10)
  await settle()

  window.dispatchEvent(new PointerEvent('pointerdown'))
  expect(shownFor()).toBeNull()

  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
  await vi.advanceTimersByTimeAsync(showDelay(WIDEST) + 10)
  await settle()
  expect(shownFor()).toBeNull()
})

test('never comes over a menu', async () => {
  const close = overlays.show(() => undefined)
  try {
    hovering.enter({ tab: alpha, box: BOX, widest: WIDEST })
    await vi.advanceTimersByTimeAsync(showDelay(WIDEST) + 10)
    await settle()
    expect(shownFor()).toBeNull()
  } finally {
    close()
  }
})

test('never under a finger', async () => {
  viewport.device = 'phone'
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST, focused: true })
  await settle()
  expect(shownFor()).toBeNull()
})

test('comes at once for a tab the keyboard arrives at', async () => {
  hovering.enter({ tab: alpha, box: BOX, widest: WIDEST, focused: true })
  await settle()
  expect(shownFor()).toBe('Alpha')
})
