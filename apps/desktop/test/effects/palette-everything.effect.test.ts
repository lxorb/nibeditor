import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'

/** The palette as one search: typed into with no mark, it lists the commands, the
 *  settings and the notes together, draws the letters each row was found by, and a
 *  switch found there is flipped where it stands. What is found and in what order is
 *  palette/rank.ts and its tests; this is what the reader sees and presses.
 *
 *  In the jsdom project because a field, a list and a key need a document. */

/** Svelte plays a transition through the Web Animations API, which jsdom lacks. */
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

Element.prototype.scrollIntoView = () => undefined

const { default: Palette } = await import('../../src/lib/Palette.svelte')
const { modes } = await import('../../src/lib/modes.svelte')
const { theme } = await import('../../src/lib/theme.svelte')
const { overlays } = await import('../../src/lib/overlays')

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(Palette, { target, props: { open: true } })
  flushSync()
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  close?.()
  target.remove()
})

const field = () => target.querySelector('input')
const rows = () => [...target.querySelectorAll('[role="option"]')]
const labels = () => rows().map((one) => one.querySelector('.nib-row-label')?.textContent ?? '')

function type(text: string) {
  const input = field()
  if (!input) throw new Error('the palette has no field')

  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function press(key: string) {
  field()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}

test('finds a command with no mark in front of it', () => {
  type('reopen closed')
  expect(labels()[0]).toBe('Reopen closed tab')
})

test('finds a setting by its own name, and says which pane it is in', () => {
  type('check spelling')
  const first = rows()[0]
  expect(first?.querySelector('.nib-row-label')?.textContent).toBe('Check spelling')
  expect(first?.querySelector('.where')?.textContent).toBe('Spelling')
})

test('draws the letters the words were found at', () => {
  type('reopen')
  const first = rows()[0]
  expect(
    [...(first?.querySelectorAll('.nib-row-label b') ?? [])].map((one) => one.textContent),
  ).toEqual(['Reopen'])
})

test('flips a switch where it stands, and stays up to show it', () => {
  const before = modes.closeBrackets
  type('close brackets')
  expect(labels()[0]).toBe('Close brackets and quotes')
  expect(rows()[0]?.querySelector('.nib-switch')?.classList.contains('on')).toBe(before)

  press('Enter')

  expect(modes.closeBrackets).toBe(!before)
  expect(field()).not.toBeNull()
  expect(rows()[0]?.querySelector('.nib-switch')?.classList.contains('on')).toBe(!before)
  if (modes.closeBrackets !== before) modes.toggleCloseBrackets(undefined)
})

/** A mode under the arrows is tried on the whole app, as the theme picker tries one,
 *  and closing without choosing puts back what was kept. See palette/trying.ts. */
test('tries a mode on while the arrows are on it, and takes it off on the way out', () => {
  const was = theme.scheme
  const other = was === 'dark' ? 'light' : 'dark'
  const before = localStorage.getItem('nib:theme-scheme')

  type(`mode ${other}`)
  expect(labels()[0]?.toLowerCase()).toBe(`mode: ${other}`)
  expect(theme.scheme).toBe(other)

  overlays.escape()
  flushSync()
  expect(theme.scheme).toBe(was)
  expect(localStorage.getItem('nib:theme-scheme')).toBe(before)
})
