/** The tabs' numbers while Alt is held, with the clock in the test's hands.
 *
 *  Emil, 2026-09-30: *"while holding alt it should (in a 'dezent' way) also show the
 *  numbers for the different tabs."* And 2026-10-01: *"It should always display, even if
 *  I press and hold Alt and then press a number. The only condition should be Alt
 *  held."* What is asked is what a hand would see: the numbers in the frame Alt goes down
 *  in, kept through the digits that move from tab to tab, and none of them once Alt is let
 *  go of, a chord of its own is pressed with it, the pointer presses or the window goes.
 *  AltGr never shows them. A web page's Alt, which the crate tells the window, shows them
 *  too. See lib/tab-strip/numbers.svelte.ts.
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
const { replay } = await import('../../src/lib/web-tab/keys')
const { workspace } = await import('../../src/lib/workspace.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

const NAMES = ['a', 'b', 'c']

/** A frame at sixty a second. */
const FRAME = 16

/** How far the strip has scrolled: a tab brought to the front by a digit moves it, and
 *  the numbers have to be read off where the tabs are after that. jsdom lays nothing
 *  out, so each mark is a hundred pixels along, less the scroll. */
let scrolled = 0

beforeAll(() => {
  const pane = workspace.panes.focusedId
  // Stand-ins, because a real tab is built round a document read off a disk.
  workspace.tabs = NAMES.map((id) => ({ id, paneId: pane }) as unknown as Tab)
  const strip = document.createElement('div')
  strip.dataset.strip = pane
  for (const id of NAMES) {
    strip.insertAdjacentHTML(
      'beforeend',
      `<div class="tab"><button class="pick" data-tab="${id}"><span class="face"></span></button></div>`,
    )
  }
  document.body.append(strip)

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const tab = this.closest<HTMLElement>('.pick')?.dataset.tab
    const left = tab ? NAMES.indexOf(tab) * 100 - scrolled : -10_000
    return DOMRect.fromRect({ x: left, y: 0, width: tab ? 24 : 20_000, height: 24 })
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => [DOMRect.fromRect()] as unknown as DOMRectList,
  )
})

beforeEach(() => {
  scrolled = 0
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'],
  })
})

afterEach(() => {
  release()
  vi.useRealTimers()
})

const press = (key: string, more: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: /^\d$/.test(key) ? `Digit${key}` : key,
      bubbles: true,
      ...more,
    }),
  )

function release() {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  flushSync()
}

const worn = () => numbers.worn.map((one) => one.label)
const drawn = () => [...document.querySelectorAll('.numeral')].map((one) => one.textContent)

function wait(ms: number) {
  vi.advanceTimersByTime(ms)
  flushSync()
}

test('come in the frame Alt goes down in, one on each tab, the last wearing 0', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])
  expect(drawn()).toEqual(['1', '2', '0'])
})

/** Emil, 2026-10-01: *"currently it just feels a bit delayed till the numbers appear when
 *  holding alt."* Measured from the keydown, a millisecond at a time, with the keyboard
 *  repeating the held Alt the way Windows does and unflagged, the worst an engine can
 *  hand over. */
test('are on screen within one frame of Alt going down, however it repeats', () => {
  const began = Date.now()
  let shown: number | null = null
  press('Alt', { altKey: true })

  for (let at = 1; at <= 200 && shown === null; at++) {
    if (at % 5 === 0) press('Alt', { altKey: true })
    wait(1)
    if (worn().length) shown = Date.now() - began
  }

  expect(shown).not.toBeNull()
  expect(shown).toBeLessThanOrEqual(FRAME)
  expect(document.querySelectorAll('.numeral')).toHaveLength(3)
})

test('stay through three digits, each put where the tabs are once its tab is in front', () => {
  // What the app's own handler does after this one: brings the tab to the front, and the
  // strip scrolls to it.
  const switching = (event: KeyboardEvent) => {
    if (event.altKey && /^Digit\d$/.test(event.code)) scrolled += 10
  }
  window.addEventListener('keydown', switching)

  press('Alt', { altKey: true })
  wait(FRAME)
  const first = document.querySelector('.numeral')
  expect(numbers.worn[0]?.x).toBe(24)

  for (const [at, digit] of ['2', '0', '1'].entries()) {
    press(digit, { altKey: true })
    expect(worn(), digit).toEqual(['1', '2', '0'])
    wait(FRAME)
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: digit, code: `Digit${digit}`, altKey: true }),
    )
    flushSync()
    expect(drawn(), digit).toEqual(['1', '2', '0'])
    expect(numbers.worn[0]?.x, digit).toBe(24 - 10 * (at + 1))
  }
  // The same badges, moved, rather than new ones faded in at every digit.
  expect(document.querySelector('.numeral')).toBe(first)

  window.removeEventListener('keydown', switching)
  release()
  expect(worn()).toEqual([])
})

test('and go the moment Alt is let go of', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  expect(worn()).toHaveLength(3)

  release()
  expect(worn()).toEqual([])
})

/** The price of no wait, and the one Emil chose: a quick Alt+3 shows them for as long as
 *  Alt is down, which is the rule - Alt held is the only condition. */
test('a quick Alt+3 shows them for as long as Alt is down', () => {
  press('Alt', { altKey: true })
  press('3', { altKey: true })
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])
  release()
  expect(worn()).toEqual([])
})

test('never come for AltGr, alone or with a digit', () => {
  press('Control', { ctrlKey: true })
  press('Alt', { ctrlKey: true, altKey: true })
  press('2', { ctrlKey: true, altKey: true })
  wait(FRAME * 4)
  expect(worn()).toEqual([])
})

test('Alt+F4 puts them away, and the held Alt repeating does not bring them back', () => {
  press('Alt', { altKey: true })
  wait(FRAME)
  expect(worn()).toHaveLength(3)

  press('F4', { altKey: true })
  flushSync()
  expect(worn()).toEqual([])
  press('Alt', { altKey: true, repeat: true })
  press('Alt', { altKey: true })
  wait(FRAME * 4)
  expect(worn()).toEqual([])
})

test('go on Alt and an arrow, Alt and Shift, the pointer, the wheel and the window going', () => {
  for (const [at, end] of [
    () => press('ArrowLeft', { altKey: true }),
    () => press('Shift', { altKey: true, shiftKey: true }),
    () => window.dispatchEvent(new PointerEvent('pointerdown')),
    () => window.dispatchEvent(new WheelEvent('wheel')),
    () => window.dispatchEvent(new FocusEvent('blur')),
  ].entries()) {
    release()
    press('Alt', { altKey: true })
    wait(FRAME)
    expect(worn(), String(at)).toHaveLength(3)

    end()
    wait(FRAME)
    expect(worn(), String(at)).toEqual([])
  }
})

test("come over a web page, stay through the digit the crate takes, go at the page's next key", () => {
  const said = (key: string, code: string, down = true) =>
    replay({ key, code, ctrl: false, shift: false, alt: true, repeat: false, down })

  // Alt going down in the page, which the page keeps and the window is told of.
  said('Alt', 'AltLeft')
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])

  // Alt and a digit, which the crate takes from the page and says as itself.
  said('2', 'Digit2')
  wait(FRAME)
  expect(worn()).toEqual(['1', '2', '0'])

  // Any other key the page had while Alt was held, which the crate names for nothing.
  said('Unidentified', '')
  flushSync()
  expect(worn()).toEqual([])

  // And the release, told from the page as well.
  said('Alt', 'AltLeft', false)
  said('Alt', 'AltLeft')
  wait(FRAME)
  expect(worn()).toHaveLength(3)
  said('Alt', 'AltLeft', false)
  flushSync()
  expect(worn()).toEqual([])
})
