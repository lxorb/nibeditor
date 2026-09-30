/** The tabs' numbers while Alt is held, with the clock in the test's hands.
 *
 *  Emil, 2026-09-30: *"while holding alt it should (in a 'dezent' way) also show the
 *  numbers for the different tabs."* What is asked is what a hand would see: nothing
 *  for a quick Alt+3, the numbers after a moment of Alt alone, and none of them once Alt
 *  is let go of, another key is pressed, the pointer presses or the window goes. AltGr
 *  never shows them. A web page's Alt, which the crate tells the window, shows them too.
 *  See lib/tab-strip/numbers.svelte.ts.
 *
 *  In the jsdom project because the numbers are a component the store mounts. */

import { flushSync } from 'svelte'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

/** The numbers fade in and out through the Web Animations API, which jsdom does not
 *  have. How they move is paint. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    onfinish: null,
  }) as unknown as Animation

// jsdom has no `CSS`; the ids here need no escaping.
if (typeof globalThis.CSS === 'undefined') {
  vi.stubGlobal('CSS', { escape: (text: string) => text })
}

const { numbers } = await import('../../src/lib/tab-strip/numbers.svelte')
const { HOLD_MS } = await import('../../src/lib/tab-strip/numbers')
const { replay } = await import('../../src/lib/web-tab/keys')
const { workspace } = await import('../../src/lib/workspace.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

const NAMES = ['a', 'b', 'c']

let strip: HTMLElement

beforeAll(() => {
  const pane = workspace.panes.focusedId
  // Stand-ins, because a real tab is built round a document read off a disk.
  workspace.tabs = NAMES.map((id) => ({ id, paneId: pane }) as unknown as Tab)
  strip = document.createElement('div')
  strip.dataset.strip = pane
  for (const id of NAMES) {
    strip.insertAdjacentHTML(
      'beforeend',
      `<div class="tab"><button class="pick" data-tab="${id}"><span class="face"></span></button></div>`,
    )
  }
  document.body.append(strip)
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  flushSync()
  vi.useRealTimers()
})

const press = (key: string, more: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...more }))

const worn = () => numbers.worn.map((one) => one.label)

function wait(ms: number) {
  vi.advanceTimersByTime(ms)
  flushSync()
}

test('come after Alt has been held a moment, one on each tab, the last wearing 0', () => {
  press('Alt', { altKey: true })
  wait(HOLD_MS - 10)
  expect(worn()).toEqual([])

  wait(20)
  expect(worn()).toEqual(['1', '2', '0'])
  expect([...document.querySelectorAll('.numeral')].map((one) => one.textContent)).toEqual([
    '1',
    '2',
    '0',
  ])
})

test('and go the moment Alt is let go of', () => {
  press('Alt', { altKey: true })
  wait(HOLD_MS + 10)
  expect(worn()).toHaveLength(3)

  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  flushSync()
  expect(worn()).toEqual([])
})

test('never flash at a quick Alt+3', () => {
  press('Alt', { altKey: true })
  wait(120)
  press('3', { altKey: true })
  wait(HOLD_MS * 2)
  expect(worn()).toEqual([])
})

test('never come for AltGr', () => {
  press('Control', { ctrlKey: true })
  press('Alt', { ctrlKey: true, altKey: true })
  wait(HOLD_MS * 2)
  expect(worn()).toEqual([])
})

test('go on any other key, a press of the pointer, and the window losing the keyboard', () => {
  for (const [at, end] of [
    () => press('ArrowLeft', { altKey: true }),
    () => window.dispatchEvent(new PointerEvent('pointerdown')),
    () => window.dispatchEvent(new FocusEvent('blur')),
  ].entries()) {
    press('Alt', { altKey: true })
    wait(HOLD_MS + 10)
    expect(worn()).toHaveLength(3)

    end()
    flushSync()
    expect(worn(), String(at)).toEqual([])
  }
})

test("come over a web page too, from the page's own Alt the crate tells of", () => {
  replay({
    key: 'Alt',
    code: 'AltLeft',
    ctrl: false,
    shift: false,
    alt: true,
    repeat: false,
    down: true,
  })
  wait(HOLD_MS + 10)
  expect(worn()).toEqual(['1', '2', '0'])

  // And any key the page had while Alt was held, which the crate names for nothing.
  replay({
    key: 'Unidentified',
    code: '',
    ctrl: false,
    shift: false,
    alt: true,
    repeat: false,
    down: true,
  })
  flushSync()
  expect(worn()).toEqual([])
})
