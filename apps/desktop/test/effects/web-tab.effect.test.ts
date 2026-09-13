/** The pane that shows a website, mounted, which is the only way to see this bug.
 *
 *  What it was. `WebTab.svelte` asks the store for its page from a `$derived` -
 *  `const page = $derived(pages.of(tab.id))` - because the tab under a pane can be
 *  swapped and the page has to follow. `pages.of` made the page the first time it was
 *  asked for, in a `SvelteMap`. A derived is a reaction, and Svelte forbids a reaction
 *  from writing to state that was made outside it, so the first read threw
 *  `state_unsafe_mutation` while the component was being built: the pane came up with
 *  nothing in it at all - no bar, no card - and the batch Svelte was flushing was
 *  abandoned, which leaves the whole window drawn and no longer reactive.
 *
 *  It is reproducible in a browser with no child webview anywhere near it, which is
 *  what this file is: open a website from the palette, draw its pane, and look for the
 *  bar. Nothing in the node project could have seen it - a rune compiled for the
 *  server has no reactions in it, so no read is inside one. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// A browser build: no crate, no child webview, and the pane is a card over a frame.
// The bug is the store and the component, and neither of those is about a platform.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

// jsdom does no layout, so it has no observer for a box changing size. The pane asks
// for one to follow the hole it leaves for the page; here it never fires, which is
// the honest stand-in for a window nobody has resized.
class NoLayout {
  observe() {
    // Nothing ever moves in jsdom, so nothing is ever reported.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  vi.useRealTimers()
})

test('a pane draws the bar for a website nothing has asked about before', () => {
  // The palette's own gesture: a web tab with no file and no page state anywhere.
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  expect(tab?.kind).toBe('web')
  if (!tab) return

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  expect(() => flushSync()).not.toThrow()

  // The bar, which is what a pane showing a website always has - before any address,
  // on every platform, and whether the page is a webview, a frame or a card.
  expect(target.querySelector('.web')).not.toBeNull()
  expect(target.querySelector('input')).not.toBeNull()

  // And the page the pane read is the one the store hands out, so the bar and the
  // crate are looking at the same tab.
  expect(pages.of(tab.id)).toBe(pages.of(tab.id))

  void unmount(app)
  workspace.close(tab.id)
})

/** The bar's address field reports typing so the pane can leave the page alone while
 *  somebody is in it. The field loses the keyboard when the pane swaps the tab under
 *  it - which is the same moment the component is destroyed - so that report arrives
 *  after the `$derived` the component read its page from is gone: Svelte says
 *  `derived_inert`, and the page handed back may be the tab before this one's. The
 *  store is asked by id instead, which is true whenever the report comes. */
test('the bar can report typing after its own pane has gone', () => {
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  const said: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...words) => {
    said.push(words.map((one) => String(one)).join(' '))
  })

  try {
    const app = mount(WebTab, { target, props: { tab, focused: true } })
    flushSync()

    const field = target.querySelector('input')
    if (!field) throw new Error('no address field')

    // The keyboard really in the field, so that taking the pane away is what takes
    // it out: a focused element being removed loses the keyboard, and the blur that
    // says so lands while the component is being destroyed. That is the moment.
    field.focus()
    flushSync()
    expect(pages.of(tab.id).typing).toBe(true)

    void unmount(app)
    flushSync()

    expect(pages.of(tab.id).typing).toBe(false)
    expect(said.filter((one) => one.includes('derived_inert'))).toEqual([])
  } finally {
    warn.mockRestore()
    workspace.close(tab.id)
  }
})
