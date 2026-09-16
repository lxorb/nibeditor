/** Leaving a web tab and coming back to it, mounted.
 *
 *  A web note is a browser tab: its page goes on living while the app runs, so
 *  switching to a note and back must not close the webview and must not load the
 *  site again. The only way to see that is to mount the pane and unmount it, which
 *  is exactly what the tab strip does.
 *
 *  What it was. The pane's teardown asked the document where the hole had been -
 *  `rect()` - and closed the page outright when the answer was nothing. Svelte
 *  clears a `bind:this` while it destroys, and the hole is also gone from the
 *  document by then, so the answer was always nothing: every switch away from a web
 *  tab closed the webview, and coming back was a fresh `add_child` and a fresh load
 *  of the site. That is what "it loads for an eternity" was. */

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

/** A box for an element in the document, and a box of zeroes for one that is not.
 *
 *  jsdom does no layout, so every box is at the origin with no size and the pane would
 *  read its hole as not on screen; a box of its own is the honest stand-in for a window
 *  with a pane in it.
 *
 *  The second half is the part that matters, and it is what a real browser does rather
 *  than a convenience: an element out of the document measures nothing. That is the
 *  state the pane's own teardown runs in, because Svelte removes the DOM and then calls
 *  the teardowns - so a stand-in that handed out a rectangle there would hide the very
 *  bug this file is about. */
Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const gone = { x: 0, y: 0, width: 0, height: 0 }
  if (!this.isConnected) {
    return {
      ...gone,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => gone,
    }
  }

  const hole = this.classList.contains('hole')
  const rect = { x: 0, y: hole ? 40 : 0, width: 800, height: hole ? 560 : 600 }
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: 800,
    bottom: 600,
    toJSON: () => rect,
  }
}

/** What the hit test finds over the hole, or null for a pane with nothing over it.
 *
 *  A layer of the app's that has closed is still in the document while it plays its
 *  way out - 120 to 190 ms - and it is on no list by then: it took itself off the
 *  overlay stack the moment it closed. This is that element. */
let over: Element | null = null

// jsdom has no hit testing either. Nothing of the app's is over the page here unless
// a test has put something there, so the topmost element at the middle of the hole is
// the hole.
document.elementFromPoint = () => over ?? document.querySelector('.hole')

const { overlays } = await import('../../src/lib/overlays')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default

let target: HTMLElement

beforeEach(() => {
  asked.length = 0
  over = null
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  vi.useRealTimers()
})

/** A frame, twice over: `startup.turn` waits for one painted frame and jsdom's
 *  `requestAnimationFrame` is a timer. */
function frames(): Promise<void> {
  return new Promise((go) => setTimeout(go, 300))
}

test('switching away from a web tab keeps the page and switching back does not build one', async () => {
  startup.reset()
  await startup.shown()

  const tab = workspace.tabs.find((one) => one.kind === 'web') ?? null
  workspace.openWebsite()
  const made = workspace.tabs.at(-1)
  expect(made?.kind).toBe('web')
  if (!made || tab) return

  pages.of(made.id).url = 'https://example.com/a'

  const first = mount(WebTab, { target, props: { tab: made, focused: true } })
  flushSync()
  await frames()

  expect(asked.map((one) => one.command)).toContain('web_open')
  expect(pages.of(made.id).live).toBe(true)

  // The tab strip switches to a note: the pane's web surface goes.
  asked.length = 0
  void unmount(first)
  flushSync()
  await frames()

  // Out of sight, and still there.
  expect(asked.map((one) => one.command)).not.toContain('web_close')
  expect(pages.of(made.id).live).toBe(true)

  // And back: placed, not built.
  asked.length = 0
  const second = mount(WebTab, { target, props: { tab: made, focused: true } })
  flushSync()
  await frames()

  expect(asked.map((one) => one.command)).not.toContain('web_open')
  expect(asked.map((one) => one.command)).toContain('web_place')

  void unmount(second)
})

/** A native webview draws above every pixel of HTML in the window, so anything the app
 *  opens over the page has to be answered by hiding the page - and it has to be answered
 *  the moment the overlay opens rather than at the next press, because a palette row
 *  opens the next overlay and Escape closes one. What it used to ask instead was which
 *  element was on top at the middle of the hole, which left a menu over a corner of the
 *  page drawn behind the page. See `covered` in WebTab.svelte and overlays.ts. */
test('the page is hidden while anything of the app is over it, and comes back when it goes', async () => {
  startup.reset()
  await startup.shown()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/over'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  // A menu, a sheet, the palette: whatever it is, it is on the overlay stack.
  asked.length = 0
  const off = overlays.show(() => undefined)
  await frames()

  const hidden = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(hidden?.args.visible).toBe(false)
  // And the page was photographed first, so the pane holds the page rather than nothing
  // while the menu is over it.
  expect(asked.map((one) => one.command)).toContain('web_shot')

  asked.length = 0
  off()
  await frames()

  const shown = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(shown?.args.visible).toBe(true)

  void unmount(app)
})

/** A web tab opened from anywhere but a row in the file list.
 *
 *  This is what Emil meant by *"browser tabs take an eternity to load"*, and the
 *  eternity was not a slow load: the page was never asked for. Every way of opening a
 *  website except clicking its row goes through a layer - the palette, the app menu,
 *  the chooser Ctrl+T opens, a row's own menu - and a layer that has closed is still in
 *  the document for the 120 to 190 ms it takes to play its way out, with nothing on the
 *  overlay stack to say so. The pane mounted under it, the hit test said covered, and
 *  the one moment the page was ever asked for was spent. Nothing asked again: the
 *  rectangle had not changed and the stack was already empty, so the tab sat on an
 *  empty pane until the reader happened to click something.
 *
 *  Counted rather than timed. The page is asked for exactly once, whatever was over the
 *  pane when it mounted, and it is placed out of sight until the layer has gone. */
test('a web tab that mounts under a layer on its way out still asks for its page', async () => {
  startup.reset()
  await startup.shown()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/under'

  // The layer that opened this tab, still in the document and already off the stack.
  const leaving = document.createElement('div')
  document.body.append(leaving)
  over = leaving

  asked.length = 0
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()

  // Asked for, once, and out of sight: a native webview draws above every pixel of
  // HTML in the window, so a page built over the layer would be the other half of the
  // same bug.
  expect(asked.filter((one) => one.command === 'web_open')).toHaveLength(1)
  expect(pages.of(tab.id).live).toBe(true)
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)

  // The layer finishes leaving. Nothing tells the pane so - that is the whole of the
  // problem - and the page is on screen anyway.
  asked.length = 0
  over = null
  leaving.remove()
  await frames()

  expect(asked.filter((one) => one.command === 'web_open')).toHaveLength(0)
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(true)

  void unmount(app)
})
