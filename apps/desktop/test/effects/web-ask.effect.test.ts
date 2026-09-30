/** A site's question, mounted: the bubble under a web tab's bar, answered the three
 *  ways a person answers it.
 *
 *  Emil, 2026-09-28, of the bubble a mail site put up asking to show notifications:
 *  *"and this thing here is not clickable."* The buttons were drawn and every press fell
 *  through them, because the card they sit in lets the pointer through; bubble.test.ts
 *  holds every bubble to that. This holds the rest of the road: a press on either answer
 *  reaches the engine and is remembered for the site, Escape dismisses and remembers
 *  nothing, and the keyboard is the bubble's while it is up - taken back from the page
 *  that asked, which held it out of sight. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** jsdom has no animations, and the bubble arrives on one. */
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

const told: { id: number; allow: boolean }[] = []
const focused = vi.fn(() => Promise.resolve())

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_answer') told.push({ id: Number(args.id), allow: args.allow === true })
    if (command === 'take_keyboard') return focused()
    return Promise.resolve(undefined)
  },
}))

const { grants } = await import('../../src/lib/web-tab/permissions.svelte')
const { overlays } = await import('../../src/lib/overlays')
const WebAsk = (await import('../../src/lib/web-tab/WebAsk.svelte')).default

let target: HTMLElement
let next = 1

/** A site asking, the way the crate says it, with the bubble for it on screen. */
function asked(site: string) {
  const asking = { id: next++, tab: 'tab-1', site, ask: 'notifications' as const }
  grants.heard(asking)
  const app = mount(WebAsk, { target, props: { asking, icon: null } })
  flushSync()
  return { asking, app }
}

function button(name: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  told.length = 0
  focused.mockClear()
})

afterEach(() => {
  target.remove()
  vi.restoreAllMocks()
})

test('Allow reaches the engine and is remembered for the site', () => {
  const { asking, app } = asked('mail.example')

  button('Allow').click()
  flushSync()

  expect(told).toEqual([{ id: asking.id, allow: true }])
  expect(grants.said('mail.example', 'notifications')).toBe('allow')
  expect(grants.asking).toEqual([])
  void unmount(app)
})

test('Don’t allow reaches the engine and is remembered too', () => {
  const { asking, app } = asked('ads.example')

  button('Don’t allow').click()
  flushSync()

  expect(told).toEqual([{ id: asking.id, allow: false }])
  expect(grants.said('ads.example', 'notifications')).toBe('block')
  void unmount(app)
})

test('Escape dismisses it, tells the site no, and decides nothing', () => {
  const { asking, app } = asked('maybe.example')
  const depth = overlays.depth

  expect(depth).toBeGreaterThan(0)
  expect(overlays.escape()).toBe(true)
  flushSync()

  expect(told).toEqual([{ id: asking.id, allow: false }])
  expect(grants.said('maybe.example', 'notifications')).toBeNull()
  void unmount(app)
})

test('the keyboard is the bubble’s, taken back from the page that asked', async () => {
  // The page had it: the app's own document has no focus.
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const { app } = asked('keys.example')

  const card = target.querySelector('[role=dialog]')
  expect(document.activeElement).toBe(card)
  // Asked of the crate, which is what says no to a probe.
  await vi.waitFor(() => expect(focused).toHaveBeenCalledTimes(1))
  // Neither answer is the one a stray Enter gives: Tab reaches them, in order.
  expect(document.activeElement?.tagName).not.toBe('BUTTON')
  void unmount(app)
})

test('and is left where it is when the app already has it', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const { app } = asked('here.example')

  expect(document.activeElement).toBe(target.querySelector('[role=dialog]'))
  await new Promise((done) => setTimeout(done, 20))
  expect(focused).not.toHaveBeenCalled()
  void unmount(app)
})
