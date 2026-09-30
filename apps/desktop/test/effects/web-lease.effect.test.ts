/** What a web login that is another computer's looks like, mounted: the pane of a tab
 *  whose site another computer is using says where it is open and offers Use here, in
 *  place of its page; the button stays pressed while the handover runs; the surface goes
 *  when the lease comes here; a computer waiting for the web key says so under the bar;
 *  and a computer that has the key is asked in a bubble. See lease.svelte.ts,
 *  WebLocked.svelte and WebApprove.svelte. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// A desktop, whose pane is a hole a page is placed over. The launch never reaches the
// turn a page is asked for at, so no page is: the surface is what is under test.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: () => Promise.resolve(undefined),
}))

// The window's listeners are the runtime's, which jsdom has none of. Its keyboard is the
// crate's, asked through `invoke` above.
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

/** Svelte plays a surface's way in and out through the Web Animations API, which jsdom
 *  has none of: every animation is over as soon as somebody asks. */
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
    set onfinish(then: (() => void) | null) {
      queueMicrotask(() => then?.())
    },
  }) as unknown as Animation

class NoLayout {
  observe() {
    // jsdom does no layout; nothing is ever reported.
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
const { Approval } = await import('../../src/lib/web-tab/approval.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default
const WebApprove = (await import('../../src/lib/web-tab/WebApprove.svelte')).default

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  pages.waiting = null
})

function webTab() {
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  pages.of(tab.id).url = 'https://mail.example.com/'
  return tab
}

describe('a site another computer is using', () => {
  test('says where it is open, offers Use here, and goes when the lease comes here', async () => {
    const tab = webTab()
    const page = pages.of(tab.id)
    const take = vi.fn()
    page.lock = { device: 'Laptop', pressed: false, take }

    const app = mount(WebTab, { target, props: { tab, focused: true } })
    flushSync()

    const locked = target.querySelector('.hole .locked')
    expect(locked?.textContent).toContain('Open on Laptop')
    const button = locked?.querySelector('button')
    expect(button?.textContent.trim()).toBe('Use here')

    button?.click()
    expect(take).toHaveBeenCalledTimes(1)

    // The handover is running: the press stays down.
    page.lock = { device: 'Laptop', pressed: true, take }
    flushSync()
    expect(target.querySelector('.use')?.classList.contains('pressed')).toBe(true)

    // The lease is here: the surface goes, and the pane asks for its page again.
    page.lock = null
    flushSync()
    await vi.waitFor(() => {
      expect(target.querySelector('.locked')).toBeNull()
    })

    void unmount(app)
    workspace.close(tab.id)
  })

  test('says nothing of a computer during the breath before it is named', () => {
    const tab = webTab()
    pages.of(tab.id).lock = { device: '', pressed: false, take: () => undefined }

    const app = mount(WebTab, { target, props: { tab, focused: true } })
    flushSync()

    const where = target.querySelector('.where')
    expect(where?.textContent.trim()).toBe('')
    expect(where?.classList.contains('said')).toBe(false)

    void unmount(app)
    workspace.close(tab.id)
  })
})

test('a computer waiting for the web key says which one and the six digits under the bar', () => {
  const tab = webTab()
  pages.waiting = { device: 'Desktop', digits: '482913' }

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()

  const line = target.querySelector('.waiting')
  expect(line?.textContent).toContain('Waiting for Desktop')
  expect(line?.querySelector('.digits')?.textContent).toBe('482 913')

  void unmount(app)
  workspace.close(tab.id)
})

test('a computer that has the key is asked in a bubble, with the digits, and answers', async () => {
  const sent: unknown[] = []
  const approval = new Approval({
    hub: {
      leads: true,
      on: () => () => undefined,
      opened: () => () => undefined,
      introduce: () => undefined,
      send: (frame) => {
        sent.push(frame)
        return true
      },
    },
    pub: () => Promise.resolve('bWluZQ=='),
    digits: () => Promise.resolve('000000'),
    wrap: (pub) => Promise.resolve({ wrapped: `for-${pub}`, generation: 1 }),
    accept: () => Promise.resolve(),
    rotate: () => Promise.resolve(1),
    devices: () => Promise.resolve([]),
    settle: () => Promise.resolve(),
  })
  approval.asking = [{ device: 'new-000001', name: 'Desktop', pub: 'bmV3', digits: '482913' }]

  const app = mount(WebApprove, { target, props: { approval } })
  flushSync()

  const bubble = target.querySelector('.approve')
  expect(bubble?.textContent).toContain('Desktop wants your web logins')
  expect(bubble?.querySelector('.digits')?.textContent).toBe('482 913')

  const allow = [...(bubble?.querySelectorAll('button') ?? [])].at(-1)
  expect(allow?.textContent.trim()).toBe('Allow')
  allow?.click()
  await vi.waitFor(() => {
    expect(sent).toEqual([{ t: 'grant-key', to: 'new-000001', wrapped: 'for-bmV3', generation: 1 }])
  })
  flushSync()
  await vi.waitFor(() => {
    expect(target.querySelector('.approve')).toBeNull()
  })

  void unmount(app)
})
