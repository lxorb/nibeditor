/** Glass following what is open, switched between, mounted.
 *
 *  Emil, 2026-10-01: *"glass theme is pretty ass right now, it should be based on what's
 *  currently open, e.g. the website."* The frame takes the colour of the tab in front, and
 *  a switch is a cross-fade: the one colour the shell is painted with moves from the last
 *  tab's to this one's, once, and `main` eases it (its `transition` in App.svelte). What
 *  is asked here is what makes that a cross-fade and not a flash: the colour moves in one
 *  step, never through the theme's own wash or nothing on the way; the words on the frame
 *  turn with it; and the open tab runs down into what it is the tab of - its page's colour
 *  for a web tab, the paper for a note - whatever scheme the strip is in. And the next
 *  launch opens on the colour it was left on.
 *
 *  In the jsdom project because the strip is mounted. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// A browser build: no crate, and the page reads nothing here; the colour a page says is
// handed to the store directly.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: (command: string) =>
    Promise.resolve(
      command === 'list_themes' ? [] : command === 'read_custom_css' ? '' : undefined,
    ),
}))

// This project hands a stylesheet imported as text over empty; glass's sides are read
// out of the sheet itself, so it is handed the file.
vi.mock('@nib/themes/glass', () => ({
  glassCss: readFileSync(resolve('../../packages/themes/src/glass.css'), 'utf8'),
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

/** Tabs move through the Web Animations API, which jsdom does not have. */
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

/** jsdom answers no media query; a system asking for nothing in particular. */
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaQueryList

const { workspace } = await import('../../src/lib/workspace.svelte')
const { theme } = await import('../../src/lib/theme.svelte')
const { viewport } = await import('../../src/lib/viewport.svelte')
const { chrome } = await import('../../src/lib/glass/chrome.svelte')
const { grounds } = await import('../../src/lib/glass/grounds.svelte')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default

const BLACK = 'https://black.example/'
const WHITE = 'https://white.example/'

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

/** Every value the shell's colour took, in order. */
let tints: string[] = []
let watching: MutationObserver | null = null

/** Lets the theme's door and the effect behind it run. */
async function settle() {
  await vi.dynamicImportSettled()
  for (let turn = 0; turn < 4; turn++) {
    await new Promise((go) => setTimeout(go, 0))
    flushSync()
  }
}

function tint(): string {
  return document.documentElement.style.getPropertyValue('--glass-tint')
}

beforeEach(async () => {
  localStorage.clear()
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'

  theme.init()
  theme.setScheme('light')
  theme.select('glass')
  await settle()

  target = document.createElement('div')
  document.body.append(target)

  tints = []
  watching = new MutationObserver(() => {
    const now = tint()
    if (tints.at(-1) !== now) tints.push(now)
  })
  watching.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
})

afterEach(() => {
  watching?.disconnect()
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  theme.select('default')
})

test('a switch moves the frame from one tab’s colour to the next in one step', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  const white = workspace.openPage(WHITE) ?? ''
  grounds.said(white, WHITE, '#ffffff')
  // Last, because a page opened over a blank note puts the note away.
  workspace.openBlank('Notes', '# Notes')
  const note = workspace.active?.id ?? ''
  shown = mount(Tabs, { target, props: { paneId: workspace.panes.focusedId } })

  workspace.activate(black)
  await settle()
  expect(tint()).toBe('#0f0f0f')
  // A black page under the light scheme: the frame wears the dark side's words.
  expect(chrome.theme).toBe('dark')
  const active = () => target.querySelector<HTMLElement>('.tab.active')
  expect(active()?.style.getPropertyValue('--web-ground')).toBe('#0f0f0f')
  // The strip is in the page's scheme, so the tab on it says nothing of its own.
  expect(active()?.hasAttribute('data-theme')).toBe(false)

  tints = []
  workspace.activate(white)
  await settle()
  expect(tints).toEqual(['#ffffff'])
  expect(chrome.theme).toBeUndefined()

  // A note: a tone of the accent in the reader's own scheme, and its tab is the paper.
  tints = []
  workspace.activate(note)
  await settle()
  expect(tints).toHaveLength(1)
  expect(tints[0]).toMatch(/^#[0-9a-f]{6}$/)
  expect(chrome.theme).toBeUndefined()
  expect(active()?.style.getPropertyValue('--web-ground')).toBe('')
})

test('a note’s tab inside a strip turned dark by a page keeps the paper’s words', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()

  // The strip is dark for the page in front; a note's tab, open in it, is the paper's.
  expect(chrome.theme).toBe('dark')
  expect(chrome.tabTheme('some-note')).toBe('light')
  expect(chrome.tabTheme(black)).toBeUndefined()
})

test('the wash is worked out again over whatever the root says the window stands on', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#ffffff')
  workspace.activate(black)
  await settle()
  const opaque = document.documentElement.style.getPropertyValue('--glass-tinted')

  // Acrylic is the desk itself, so a white page over it needs more of its colour than
  // over its own paper; said on the root, as material.ts says it.
  document.documentElement.dataset.translucent = 'acrylic'
  await settle()
  expect(chrome.material).toBe('acrylic')
  expect(document.documentElement.style.getPropertyValue('--glass-tinted')).not.toBe(opaque)
  delete document.documentElement.dataset.translucent
  await settle()
})

test('leaving glass takes every colour and word it put on the window away', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()
  expect(document.documentElement.hasAttribute('data-tinted')).toBe(true)

  theme.select('default')
  await settle()
  expect(document.documentElement.hasAttribute('data-tinted')).toBe(false)
  expect(tint()).toBe('')
  expect(chrome.theme).toBeUndefined()
  expect(localStorage.getItem('nib:glass-chrome')).toBeNull()
})

test('the next launch opens on the colour it was left on, before anything is worked out', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()
  const kept = localStorage.getItem('nib:glass-chrome')
  expect(kept).toContain('#0f0f0f')

  // A launch: the window's root as a new page has it, and the store read afresh.
  chrome.sleep()
  vi.resetModules()
  localStorage.setItem('nib:glass-chrome', kept ?? '')
  const fresh = (await import('../../src/lib/glass/chrome.svelte')).chrome
  fresh.wake('light')
  expect(tint()).toBe('#0f0f0f')
  expect(fresh.theme).toBe('dark')
  expect(fresh.barOf(black)?.colour).toBe('#0f0f0f')
  fresh.sleep()
})

test('the shell, the bar and the open tab ease the colour rather than jump to it', () => {
  const source = (path: string) => readFileSync(resolve(path), 'utf8')
  expect(source('src/App.svelte')).toMatch(
    /background: var\(--shell-ground\);\s*transition: background var\(--dur-/,
  )
  expect(source('src/lib/web-tab/WebBar.svelte')).toMatch(/background-color var\(--dur-/)
  expect(source('src/lib/Tabs.svelte')).toMatch(/transition: --tab-ground var\(--dur-/)
  expect(source('../../packages/themes/src/glass.css')).toMatch(/@property --tab-ground/)
})
