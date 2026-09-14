/** A page is built somewhere else now, and this is what follows from that.
 *
 *  It used to be built inline: the crate answered the window on the window's own
 *  thread, so nothing could happen in between. That is exactly what froze the app -
 *  see src-tauri/src/web_tabs.rs - and the fix means the wait is real. A pane can be
 *  dragged while a page is on its way, a tab can be switched away from, and a tab can
 *  be closed altogether, all before the crate answers. Every one of those is here. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Call {
  command: string
  args: Record<string, unknown>
}

const calls: Call[] = []

/** Where the reading got to is kept in this device's storage, and there is none
 *  under node; a map stands in for one. See place.ts. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

/** What `web_open` is waiting for. The test resolves it, so "while the page is
 *  being built" is a state this file can stand in and look around from. */
let building: (() => void) | null = null

/** Whether the crate refuses to build one at all, which is the card. */
let refuse = false

/** What the page says when it is asked where it has got to. */
let looked: Record<string, unknown> | null = null

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {} })
    if (command === 'web_look') {
      if (!looked) throw new Error('that page said nothing')
      return looked
    }
    if (command !== 'web_open') return undefined

    await new Promise<void>((go) => (building = go))
    if (refuse) throw new Error('no webview to be had here')
    return undefined
  },
}))

// The window hears about pages through one listener, which under node has nothing
// to listen to.
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

const { pages } = await import('./pages.svelte')

const SITE = 'https://example.com/'
const PANE = { x: 0, y: 0, width: 800, height: 600 }
const MOVED = { x: 260, y: 40, width: 540, height: 600 }

/** Waits until the crate has been asked for a page and is holding the answer. */
async function asked(): Promise<() => void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (building) return building
    await new Promise<void>((go) => setTimeout(go, 0))
  }
  throw new Error('no page was ever asked for')
}

/** Lets everything that was waiting on a microtask run. */
async function settle(): Promise<void> {
  for (let turns = 0; turns < 5; turns += 1) await new Promise<void>((go) => setTimeout(go, 0))
}

function commands(): string[] {
  return calls.map((one) => one.command)
}

function last(command: string): Record<string, unknown> | undefined {
  return calls.filter((one) => one.command === command).at(-1)?.args
}

beforeEach(async () => {
  pages.forget('a')
  pages.forget('b')
  // A close asks the page where it got to before it takes it down, so the last
  // test's tabs are still closing for a turn or two; see `closing`.
  await settle()
  calls.length = 0
  building = null
  refuse = false
  looked = null
  localStorage.clear()
})

describe('while a page is being built', () => {
  test('a second placement asks for no second page', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    // The pane moved a frame later. The crate is already building one, and a second
    // webview under the same label is not a thing that can exist.
    void pages.show('a', SITE, MOVED)
    await settle()
    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)

    arrive()
    await shown
    await settle()

    // And it lands where the pane has got to rather than where it was asked from.
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: MOVED, visible: true })
  })

  test('a tab switched away from does not have its page appear over the next one', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    pages.hide('a', PANE)
    await settle()
    // Nothing to hide yet: there is no page to place until there is a page.
    expect(commands()).toEqual(['web_open'])

    arrive()
    await shown
    await settle()

    expect(last('web_place')).toMatchObject({ tab: 'a', visible: false })
  })

  test('a tab that was closed takes its page with it', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    pages.forget('a')
    arrive()
    await shown
    await settle()

    // Twice: once when the tab went, and once for the page that arrived after it.
    expect(commands()).toEqual(['web_open', 'web_close', 'web_close'])
  })
})

test('a page the crate will not build leaves the pane its card', async () => {
  refuse = true
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown

  const page = pages.of('a')
  expect(page.openable).toBe(false)
  expect(page.live).toBe(false)
})

test('a page that was built is placed and shown', async () => {
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown

  expect(pages.of('a').live).toBe(true)
  expect(last('web_open')).toMatchObject({ tab: 'a', url: SITE, pane: PANE })
})

/** A tab closed on the page somebody was reading.
 *
 *  Where the reading got to is this device's, kept by the note's path, so opening the
 *  note again lands back on it - which is the whole of what makes a web note a browser
 *  tab rather than a bookmark. Switching away wrote it down; closing the tab in front
 *  of you did not, so the one case a reader actually presses Ctrl+W in lost the place
 *  and the trail. See `forget` and place.ts. */
describe('a tab closed while its page is in front', () => {
  const FILE = '/space/A site.url'
  const PLACE = {
    url: 'https://example.com/read',
    x: 0,
    y: 640,
    trail: ['https://example.com/', 'https://example.com/read'],
    at: 1,
  }

  async function reading(): Promise<void> {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    pages.of('a').path = FILE
    looked = PLACE
    calls.length = 0
  }

  test('writes down where the reading was before the page goes', async () => {
    await reading()

    pages.forget('a')
    await settle()

    const { placeOf } = await import('./place')
    expect(placeOf(FILE)).toMatchObject({ url: PLACE.url, y: 640, at: 1 })
    expect(placeOf(FILE)?.trail).toEqual(PLACE.trail)
  })

  test('asks the page where it is before it takes the page down', async () => {
    await reading()

    pages.forget('a')
    await settle()

    expect(commands()).toEqual(['web_look', 'web_close'])
    expect(last('web_close')).toMatchObject({ tab: 'a', keep: false })
  })

  test('and closes the page anyway when it will not say where it is', async () => {
    await reading()
    looked = null

    pages.forget('a')
    await settle()

    expect(commands()).toContain('web_close')
  })
})
