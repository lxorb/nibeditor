import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Titlebar from '../../src/lib/Titlebar.svelte'
import { shortcuts } from '../../src/lib/shortcuts.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** The space in the title bar while the panel is shut.
 *
 *  Emil, 2026-09-30, of the badge and the word "VIS" beside it: *"that should be
 *  clickable to be able to select the space. also it shouldn't display the entire
 *  name of the current space there"*. So the bar shows the space's mark and no
 *  words, and the mark is the switcher itself: a press on it is the list of spaces
 *  the panel's header opens. Where it sits and how it drops is paint, which the
 *  drive in a real browser looks at; this asks what is in the bar and what a press
 *  on it does.
 *
 *  In the jsdom project because mounting a component needs a document. */

/** The list arrives and leaves with a transition, and Svelte plays one through the
 *  Web Animations API, which jsdom does not implement. This one finishes as soon as
 *  it is asked for, so a list on its way out is gone a moment later. */
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

/** The row the keyboard lands on is kept in view, and jsdom has no view. */
Element.prototype.scrollIntoView = () => undefined

/** The tab strip beside the mark measures itself, and jsdom lays nothing out. */
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

const SPACES = [
  { id: 'vis', name: 'VIS', root: '/spaces/VIS' },
  { id: 'journal', name: 'Journal', root: '/spaces/Journal' },
]

let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  workspace.spaces = SPACES.map((one) => ({ ...one }))
  workspace.activeSpaceId = 'vis'
  workspace.panel = null
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
})

function bar() {
  const made = mount(Titlebar, {
    target,
    props: { onpalette: () => undefined, onhistory: () => undefined },
  })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

const mark = () => target.querySelector<HTMLButtonElement>('header .space button')
const list = () => target.querySelector('[role="menu"]')

/** Long enough for a list on its way out to have gone: each animation it plays ends
 *  a turn after it starts, and leaving can be more than one; see the stand-in above. */
async function settled() {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

test('the shut panel leaves the space’s mark in the bar, and not its name', () => {
  bar()

  const button = mark()
  expect(button).not.toBe(null)
  // The badge and nothing else: the name is not written anywhere in the bar.
  expect(button?.querySelector('.nib-badge')).not.toBe(null)
  expect(target.querySelector('header .space')?.textContent.trim()).toBe('V')
  expect(target.querySelector('header')?.textContent).not.toContain('VIS')
  // Where the name went: the tooltip, with the key that does the same, and what a
  // screen reader hears, with what a press does.
  expect(button?.getAttribute('title')).toBe(
    `VIS: switch space (${shortcuts.hint('space.switcher') ?? ''})`,
  )
  expect(button?.getAttribute('aria-label')).toBe('VIS: switch space')
  expect(button?.getAttribute('aria-haspopup')).toBe('menu')
  // Its own element, beside the stretch the window is dragged by, so a press on it
  // is never a drag.
  expect(button?.closest('[data-tauri-drag-region]')).toBe(null)
})

test('a press on the mark opens the switcher, and a row in it changes space', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  bar()

  expect(list()).toBe(null)
  mark()?.click()
  flushSync()

  // The switcher's own list: every space, and the one you are in picked out.
  expect(list()?.getAttribute('aria-label')).toBe('Spaces')
  expect(mark()?.getAttribute('aria-expanded')).toBe('true')
  const rows = [...(list()?.querySelectorAll<HTMLButtonElement>('.nib-row') ?? [])]
  expect(rows.map((one) => one.querySelector('.nib-row-label')?.textContent)).toEqual([
    'VIS',
    'Journal',
    'New space',
  ])
  expect(rows[0]?.classList.contains('is-on')).toBe(true)

  rows[1]?.click()
  await settled()

  expect(shown).toHaveBeenCalledWith('journal')
  expect(list()).toBe(null)
})

test('a second press puts the list away again', async () => {
  bar()

  mark()?.click()
  flushSync()
  expect(list()).not.toBe(null)

  mark()?.click()
  await settled()
  expect(list()).toBe(null)
  expect(mark()?.getAttribute('aria-expanded')).toBe('false')
})

test('with the panel out, the bar leaves the space to the panel’s header', () => {
  workspace.panel = 'tree'
  bar()

  expect(target.querySelector('header .space')).toBe(null)
})
