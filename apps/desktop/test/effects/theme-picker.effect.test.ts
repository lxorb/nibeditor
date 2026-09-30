import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { overlays } from '../../src/lib/overlays'
import SidebarFoot from '../../src/lib/SidebarFoot.svelte'
import { settings } from '../../src/lib/settings.svelte'
import { theme } from '../../src/lib/theme.svelte'
import { store } from '../../src/lib/themes/store.svelte'
import { picking, pickTheme } from '../../src/lib/theme-picker/picking.svelte'

/** The theme picker, which Emil asked for in as many words: *"It should be openable
 *  either by right-clicking on the dark/light theme switch or by using the global
 *  search. And then, by just hovering on a theme, we already get a preview. And when
 *  we click it, it will be selected."*
 *
 *  So these ask exactly that of the real stores: that a right click on the switch
 *  and the palette's row both open it, that pointing at a theme puts it on the page
 *  without writing anything down, that every way of leaving without choosing puts
 *  back what was there, and that a click keeps. What it looks like is paint, which
 *  the drive in a real browser photographs.
 *
 *  In the jsdom project because it mounts components into a document. */

/** Svelte plays a transition through the Web Animations API, which jsdom does not
 *  implement. This one is over as soon as it is asked for. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}

/** The card the keys land on is kept in view, and jsdom has no view. */
Element.prototype.scrollIntoView = () => undefined

/** The grid's scrollbar and the scheme marks' groove measure themselves, and jsdom
 *  lays nothing out. */
class NoLayout {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

globalThis.ResizeObserver = NoLayout

/** A theme with both sides, as `reload` would have read it out of the folder. */
const ROSE = {
  id: 'file:rose',
  name: 'Rose',
  path: '/themes/rose.css',
  variants: ['light' as const, 'dark' as const],
  css: "[data-theme='light'] { --bg: #fff0f3; }\n[data-theme='dark'] { --bg: #2b1119; }",
  ownAccent: false,
}

const root = document.documentElement
const sheet = () => document.getElementById('nib-user-theme')?.textContent ?? ''

/** Everything written down, as it stands. */
const storage = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at) ?? '').map(
      (name) => [name, localStorage.getItem(name)],
    ),
  )

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const cards = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const card = (name: string) => cards().find((one) => one.textContent.includes(name))
const grid = () => document.querySelector<HTMLElement>('[role="listbox"]')
const field = () => dialog()?.querySelector('input') ?? null

/** What a pointer passing over something does; the picker reads movement rather
 *  than arrival, so a card that slides under a still pointer is not tried. */
function pointAt(element: Element | undefined) {
  if (!element) throw new Error('nothing there to point at')
  element.dispatchEvent(new Event('pointermove', { bubbles: true }))
  flushSync()
}

function leave(element: Element | null) {
  if (!element) throw new Error('nothing there to leave')
  element.dispatchEvent(new Event('pointerleave'))
  flushSync()
}

function press(key: string) {
  const input = field()
  if (!input) throw new Error('the picker has no field')
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}

async function opened() {
  pickTheme()
  flushSync()
  await tick()
  flushSync()
}

beforeEach(() => {
  localStorage.clear()
  theme.files = [ROSE]
  theme.select('default')
  theme.setScheme('dark')
  theme.setAccent('violet')
  localStorage.clear()
})

afterEach(() => {
  picking.close()
  flushSync()
  settings.open = false
  store.close()
})

test('a right click on the light and dark switch opens it', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()

  const button = target.querySelector<HTMLElement>(`[aria-label="Light"]`)
  button?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 700 }),
  )
  // The picker is fetched by the press, so it is there a module load later.
  await expect.poll(() => picking.open).toBe(true)
  flushSync()

  expect(dialog()).not.toBeNull()
  // Beside the switch, where the press landed along it.
  expect(picking.at?.x).toBe(200)

  void unmount(foot, { outro: false })
  target.remove()
})

test('and so does the switch of a theme with one side, which cannot flip it', async () => {
  theme.files = [{ ...ROSE, id: 'file:paper', name: 'Paper', variants: ['light'] }]
  theme.select('file:paper')

  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()

  const button = target.querySelector<HTMLElement>('.acts button')
  expect(button?.getAttribute('aria-disabled')).toBe('true')
  button?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await expect.poll(() => picking.open).toBe(true)

  void unmount(foot, { outro: false })
  target.remove()
})

test('the palette’s row opens it where the palette stands', async () => {
  const { appCommands } = await import('../../src/lib/commands')
  const row = appCommands().find((one) => one.id === 'themes')
  expect(row?.label).toBe('Switch theme')

  row?.run()
  await expect.poll(() => picking.open).toBe(true)
  expect(picking.at).toBeNull()
})

test('shows every theme as a card, with the store last', async () => {
  await opened()

  const names = cards().map((one) => one.textContent.trim())
  expect(names).toEqual(['Default', 'High contrast', 'Rose', 'Browse'])
})

test('pointing at a theme puts it on the app and writes nothing down', async () => {
  await opened()
  const before = storage()

  pointAt(card('Rose'))

  expect(theme.id).toBe('file:rose')
  expect(root.dataset.theme).toBe('dark')
  expect(sheet()).toContain('#2b1119')
  expect(storage()).toEqual(before)
})

test('moving off the cards gives the kept one back', async () => {
  await opened()

  pointAt(card('High contrast'))
  expect(theme.id).toBe('contrast')

  leave(grid())
  expect(theme.id).toBe('default')
  expect(sheet()).toBe('')
  expect(picking.open).toBe(true)
})

test('Escape closes it and gives back exactly what was there', async () => {
  await opened()

  pointAt(card('Rose'))
  pointAt(document.querySelector('[aria-label="Light"][aria-pressed]') ?? undefined)
  pointAt(document.querySelector('[aria-label="Teal"]') ?? undefined)
  expect(theme.accent).toBe('teal')

  expect(overlays.escape()).toBe(true)
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
  expect(theme.scheme).toBe('dark')
  expect(theme.accent).toBe('violet')
  expect(root.dataset.theme).toBe('dark')
  expect(localStorage.getItem('nib:theme')).toBeNull()
})

test('a press outside does the same', async () => {
  await opened()
  pointAt(card('Rose'))

  document.querySelector<HTMLElement>('.nib-scrim')?.click()
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
})

test('a click keeps the theme, written down as Settings writes it, and closes', async () => {
  await opened()

  pointAt(card('Rose'))
  card('Rose')?.click()
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('file:rose')
  expect(localStorage.getItem('nib:theme')).toBe('file:rose')
  expect(sheet()).toContain('#2b1119')
})

test('the arrows try each theme in turn, and Enter keeps the one they are on', async () => {
  await opened()

  press('ArrowRight')
  expect(theme.id).toBe('contrast')
  press('ArrowRight')
  expect(theme.id).toBe('file:rose')
  // Three across: down is a row, which from Rose is past the end, so the store -
  // and the store is not a theme, so the kept one is back while the keys are on it.
  press('ArrowDown')
  expect(theme.id).toBe('default')
  press('ArrowUp')
  expect(theme.id).toBe('default')
  press('ArrowRight')
  expect(theme.id).toBe('contrast')
  expect(localStorage.getItem('nib:theme')).toBeNull()

  press('Enter')
  expect(picking.open).toBe(false)
  expect(localStorage.getItem('nib:theme')).toBe('contrast')
})

test('typing narrows the cards and tries the first that answers', async () => {
  await opened()
  const input = field()
  if (!input) throw new Error('the picker has no field')

  input.value = 'ros'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  expect(cards().map((one) => one.textContent.trim())).toEqual(['Rose', 'Browse'])
  expect(theme.id).toBe('file:rose')
})

test('a word nothing answers to is looked for in the store', async () => {
  await opened()
  const input = field()
  if (!input) throw new Error('the picker has no field')

  input.value = 'dracula'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  press('Enter')

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
  expect(settings.open).toBe(true)
  expect(settings.section).toBe('appearance')
  expect(store.open).toBe(true)
  expect(store.query).toBe('dracula')
})

test('the scheme and the accent are tried the same way and kept with a click', async () => {
  await opened()

  const light = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"] button')].find(
    (one) => one.getAttribute('aria-label') === 'Light',
  )
  pointAt(light)
  expect(root.dataset.theme).toBe('light')
  expect(localStorage.getItem('nib:theme-scheme')).toBeNull()

  light?.click()
  flushSync()
  expect(localStorage.getItem('nib:theme-scheme')).toBe('light')
  // Still open: the scheme is a part of the look, not the end of choosing one.
  expect(picking.open).toBe(true)

  // The accent is a theme setting, kept in the app's own drawer of them; see
  // themes/settings.ts.
  const keptAccent = () =>
    (
      JSON.parse(localStorage.getItem('nib:theme-settings') ?? '{}') as Record<
        string,
        Record<string, unknown> | undefined
      >
    )['*']?.accent

  const teal = document.querySelector<HTMLElement>('[aria-label="Teal"]')
  pointAt(teal ?? undefined)
  expect(theme.accent).toBe('teal')
  expect(keptAccent()).toBeUndefined()
  teal?.click()
  flushSync()
  expect(keptAccent()).toBe('teal')

  // And leaving now gives back what was kept, which is what was just clicked.
  expect(overlays.escape()).toBe(true)
  flushSync()
  expect(theme.scheme).toBe('light')
  expect(theme.accent).toBe('teal')
})
