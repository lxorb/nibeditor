/** A swipe over a pane, heard the way the window hears it and answered the way a reader
 *  sees it: the arrow comes in, and Back or Forward is pressed for the tab - or nothing
 *  is, when the swipe was short, the content took it, it was over the strip, or the
 *  setting is off.
 *
 *  In the jsdom project because the arrow is mounted and the window's listeners are
 *  real. The machine's numbers are gesture.test.ts's; what this holds is the wiring
 *  round it: the quiet that stands for fingers lifting, the step taken once, a page's
 *  swipe said by the crate, and the arrow played out and gone. See src/lib/back-swipe. */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  isMobile: false,
  invoke: () => Promise.resolve(undefined),
}))

/** Two tabs: a note that has somewhere to go back to and nowhere forward, and a web tab
 *  whose page can go back. Pressed Back and Forward are written down. */
const pressed: string[] = []
const note = { id: 'n1', kind: 'note', paneId: 'p1', canGoBack: true, canGoForward: false }
const site = { id: 'w1', kind: 'web', paneId: 'p2', canGoBack: false, canGoForward: false }

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: {
    tabs: [note, site],
    showing: (pane: string) => (pane === 'p1' ? note : pane === 'p2' ? site : null),
    goBack: (id: string) => pressed.push(`back ${id}`),
    goForward: (id: string) => pressed.push(`forward ${id}`),
  },
}))

vi.mock('../../src/lib/web-tab/pages.svelte', () => ({
  pages: { of: () => ({ back: true, forward: false, zoom: 2 }) },
}))

/** A window of 1024 by 768 with every pane 800 wide, its strip 40 tall: jsdom does no
 *  layout, and the arrow and a finger from the side both measure the pane. */
Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const strip = this.classList.contains('head')
  const rect = { x: 0, y: 0, width: 800, height: strip ? 40 : 600 }
  return { ...rect, top: 0, left: 0, right: 800, bottom: rect.height, toJSON: () => rect }
}

const { listen, pageSaid, PLAYS } = await import('../../src/lib/back-swipe/swipes')
const { QUIET, SETTLE } = await import('../../src/lib/back-swipe/gesture')
const { swipeChoice } = await import('../../src/lib/back-swipe/choice.svelte')
const { swiping } = await import('../../src/lib/back-swipe/shown.svelte')

let stop: () => void
let words: HTMLElement
let strip: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  pressed.length = 0
  swipeChoice.set(true)
  document.body.innerHTML = `
    <div data-pane="p1">
      <div class="head" data-chrome="top"><div class="strip"></div></div>
      <div class="words"><p>A note.</p></div>
    </div>
    <div data-pane="p2"><div class="hole"></div></div>`
  words = found('[data-pane="p1"] .words p')
  strip = found('[data-pane="p1"] .strip')
  stop = listen()
})

afterEach(() => {
  stop()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** The clock the events are stamped on. A machine under load leaves a gap of its own
 *  between two events dispatched one after the other, and the gesture reads speed off
 *  the stamps: a steady sweep would then look like a pad coasting, and decide itself
 *  before the fingers lifted. So every event says when it was, a touchpad's 8 ms apart. */
let clock = 1000
const STEP = 8

/** An event stamped at the next tick of `clock`. */
function stamped<T extends Event>(event: T): T {
  clock += STEP
  Object.defineProperty(event, 'timeStamp', { value: clock })
  return event
}

/** Two fingers swept `steps` times by `dx` over `at`, as a touchpad reports them; or, with
 *  `notch`, a tilted wheel, which says its turn in whole notches as well. */
function sweep(at: Element, steps: number, dx: number, init: WheelEventInit = {}, notch = 0) {
  for (let one = 0; one < steps; one++) {
    const event = stamped(
      new WheelEvent('wheel', { deltaX: dx, deltaMode: 0, bubbles: true, ...init }),
    )
    if (notch) Object.defineProperty(event, 'wheelDeltaX', { value: notch })
    at.dispatchEvent(event)
  }
  flushSync()
}

/** The fingers lifted: the touchpad goes quiet. */
function letGo() {
  vi.advanceTimersByTime(QUIET + 1)
  flushSync()
}

const arrow = () => document.querySelector('.nib-swipe')

/** The one element `selector` finds. */
function found(selector: string): HTMLElement {
  const one = document.querySelector<HTMLElement>(selector)
  if (!one) throw new Error(`nothing is ${selector}`)
  return one
}

test('a long sweep towards the left brings the arrow in and goes back, once', () => {
  sweep(words, 40, -10)
  expect(arrow()).not.toBeNull()
  expect(swiping.tab).toBe('n1')
  expect(swiping.side).toBe('left')
  expect(arrow()?.classList.contains('armed')).toBe(true)
  expect(pressed).toEqual([])

  letGo()
  expect(pressed).toEqual(['back n1'])
  expect(arrow()?.classList.contains('went')).toBe(true)

  vi.advanceTimersByTime(PLAYS + 1)
  flushSync()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual(['back n1'])
})

test('a short sweep shows the arrow and goes nowhere', () => {
  sweep(words, 12, -10)
  expect(arrow()).not.toBeNull()
  letGo()
  expect(pressed).toEqual([])
  expect(arrow()?.classList.contains('stayed')).toBe(true)
})

test('the ring round the arrow fills with the way to where letting go goes', () => {
  const left = () =>
    Number(document.querySelector<SVGElement>('.ring circle')?.style.strokeDashoffset)
  sweep(words, 12, -10)
  expect(swiping.progress).toBeGreaterThan(0)
  expect(swiping.progress).toBeLessThan(1)
  expect(left()).toBeCloseTo(1 - swiping.progress)

  sweep(words, 40, -10)
  expect(left()).toBe(0)
  expect(arrow()?.classList.contains('armed')).toBe(true)
  letGo()
})

test('nowhere to go forward is no arrow at all', () => {
  sweep(words, 40, 10)
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])
})

test('the strip, a held key and a tilted wheel are not swipes', () => {
  sweep(strip, 40, -10)
  sweep(words, 40, -10, { shiftKey: true })
  sweep(words, 40, -100, {}, 120)
  letGo()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual([])
})

test('a scroll the content can take is the content s', () => {
  const wide = document.createElement('div')
  wide.style.overflowX = 'auto'
  Object.defineProperties(wide, {
    scrollWidth: { value: 2000 },
    clientWidth: { value: 500 },
    scrollLeft: { value: 300, writable: true },
  })
  const cell = document.createElement('span')
  wide.append(cell)
  words.append(wide)

  sweep(cell, 40, -10)
  letGo()
  expect(pressed).toEqual([])

  // At its left edge, the next stream is a swipe.
  wide.scrollLeft = 0
  sweep(cell, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])
})

test('a scroll a surface kept for itself is the surface s', () => {
  words.addEventListener('wheel', (event) => event.preventDefault(), { passive: false })
  sweep(words, 40, -10, { cancelable: true })
  letGo()
  expect(pressed).toEqual([])
})

test('switched off, a swipe is a scroll and nothing else', () => {
  swipeChoice.set(false)
  sweep(words, 40, -10)
  letGo()
  expect(arrow()).toBeNull()
  expect(pressed).toEqual([])
})

test('a page s swipe, said by the crate, steps its tab in the window s pixels', () => {
  // Twenty steps of the page's 10 pixels at a zoom of two are 400 of the window's.
  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(swiping.tab).toBe('w1')
  letGo()
  expect(pressed).toEqual(['back w1'])
})

test('a page that took the scroll says so, and keeps it', () => {
  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: true, right: true })
  }
  letGo()
  expect(pressed).toEqual([])
})

test('a scroll down that drifts sideways is a scroll down, to its end', () => {
  // Straight down first, then a hand that wanders: no arrow, and nowhere to go.
  sweep(words, 10, 0, { deltaY: 10 })
  sweep(words, 40, -10, { deltaY: 1 })
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])

  // Over a page, said with what went down before the first sideways step.
  pageSaid({ tab: 'w1', kind: 'wheel', dx: -1, dy: 120, at: 0, left: false, right: false })
  for (let at = 1; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(arrow()).toBeNull()
  letGo()
  expect(pressed).toEqual([])
})

test('one swipe is one step: the coast that carries on after it is nobody s', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])

  // The pad coasting on over the note the step brought, after the gap the step left.
  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1'])

  // A hand that lifts and sweeps again goes again.
  now.mockReturnValue(10_000 + SETTLE + 1)
  sweep(words, 40, -10)
  letGo()
  expect(pressed).toEqual(['back n1', 'back n1'])
  now.mockRestore()
})

test('a finger from the side of the pane goes back when it lifts far enough along', () => {
  const touch = (type: string, x: number) => {
    const event = stamped(new Event(type, { bubbles: true })) as Event & { touches: unknown[] }
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [{ clientX: x, clientY: 300 }],
    })
    words.dispatchEvent(event)
  }
  touch('touchstart', 4)
  for (let x = 14; x <= 404; x += 10) touch('touchmove', x)
  flushSync()
  expect(swiping.tab).toBe('n1')
  expect(pressed).toEqual([])
  touch('touchend', 404)
  expect(pressed).toEqual(['back n1'])

  // One that lands in the middle of the note is a pan.
  pressed.length = 0
  touch('touchstart', 300)
  for (let x = 310; x <= 700; x += 10) touch('touchmove', x)
  touch('touchend', 700)
  expect(pressed).toEqual([])
})

test('over a web page the arrow is one of the layers the page is cut round', async () => {
  const { layersOver } = await import('../../src/lib/web-tab/covers')
  const hole = found('.hole')
  expect(layersOver(hole)).toEqual([])

  for (let at = 0; at < 20; at++) {
    pageSaid({ tab: 'w1', kind: 'wheel', dx: -10, dy: 0, at: at * 8, left: false, right: false })
  }
  flushSync()
  expect(layersOver(hole)).toHaveLength(1)

  letGo()
  vi.advanceTimersByTime(PLAYS + 1)
  flushSync()
  expect(layersOver(hole)).toEqual([])
})
