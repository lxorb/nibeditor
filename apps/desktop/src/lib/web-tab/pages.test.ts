/** A page is built somewhere else now, and this is what follows from that.
 *
 *  It used to be built inline: the crate answered the window on the window's own
 *  thread, so nothing could happen in between. That is exactly what froze the app -
 *  see src-tauri/src/web_tabs.rs - and the fix means the wait is real. A pane can be
 *  dragged while a page is on its way, a tab can be switched away from, and a tab can
 *  be closed altogether, all before the crate answers. Every one of those is here. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

/** A window for the store to listen on. The two listeners the window keeps are started
 *  with the first page in it, and a desktop with no window is not a thing the app can
 *  be; see `listen`. Nothing reads anything off it - the runtime's own `listen` is
 *  mocked below - so an empty object is the whole of what this needs to be. */
vi.stubGlobal('window', {})

/** What `web_open` is waiting for. The test resolves it, so "while the page is
 *  being built" is a state this file can stand in and look around from. */
let building: (() => void) | null = null

/** Whether the crate refuses to build one at all, which is the card. */
let refuse = false

/** What the page says when it is asked where it has got to. */
let looked: Record<string, unknown> | null = null

/** A freeze or a thaw the crate has not answered yet, while a test holds one. */
let pausing: Promise<void> | null = null

/** Whether the engine refuses to freeze a page, as WebView2 does one in a call. */
let refusing = false

/** A photograph the engine has not answered yet, while a test holds one. */
let photographing: Promise<void> | null = null

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {} })
    if (command === 'web_pause' && pausing) await pausing
    if (command === 'web_shot' && photographing) await photographing
    if (command === 'web_pause') return !(refusing && args?.paused === true)
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

/** What the window is listening for, by name, so a test can say a page moved. The
 *  crate is the only thing that raises these in the app. */
const heard = new Map<string, (event: { payload: unknown }) => void>()

// The window hears about pages through one listener, which under node has nothing
// to listen to.
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, tell: (event: { payload: unknown }) => void) => {
    heard.set(name, tell)
    return Promise.resolve(() => undefined)
  },
}))

const { pages, readOpening } = await import('./pages.svelte')

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

/** Waits until the window is listening for `name`, and hands back what it heard with.
 *
 *  The listeners are started with the first page and fetched on the way - see `listen`
 *  in pages.svelte.ts - so `nib://web-tab` is three imports behind the first of them,
 *  and nothing in the store waits for the last. Nor can a count of turns: in a whole
 *  gate those imports are compiled cold on a busy machine, which has outlasted every
 *  test that runs before the first one here to listen. So this waits for the listener
 *  itself. */
async function hearing(name: string): Promise<(event: { payload: unknown }) => void> {
  return vi.waitFor(
    () => {
      const tell = heard.get(name)
      if (!tell) throw new Error(`nothing is listening for ${name}`)
      return tell
    },
    { timeout: 10_000 },
  )
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
  /** A new tab has no address, and its first build is refused; an address typed while
   *  that refusal is on its way is built at once rather than left on the card. */
  test('an address given while a blank tab is being refused is built', async () => {
    refuse = true
    const shown = pages.show('a', '', PANE)
    const refusing = await asked()

    void pages.go('a', SITE)
    void pages.show('a', SITE, PANE)
    building = null
    refusing()
    const second = await asked()
    refuse = false
    second()
    await shown
    await settle()

    expect(commands().filter((one) => one === 'web_open')).toHaveLength(2)
    expect(last('web_open')).toMatchObject({ tab: 'a', url: SITE })
    expect(pages.of('a').live).toBe(true)
    expect(pages.of('a').openable).toBe(true)
  })

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

/** A web login another of the person's computers is using: the page is asked about
 *  before it is built, and one it may not run is never built at all, so nothing of the
 *  site's runs here. See lease.svelte.ts. */
describe("a site whose login is another computer's", () => {
  afterEach(() => {
    pages.watch = null
  })

  test('is never built', async () => {
    const admitted: string[] = []
    pages.watch = {
      admit: (tab) => {
        admitted.push(tab)
        return Promise.resolve(false)
      },
      moved: () => undefined,
      closed: () => undefined,
    }

    await pages.show('a', SITE, PANE)
    await settle()

    expect(admitted).toEqual(['a'])
    expect(commands()).not.toContain('web_open')
    expect(pages.of('a').live).toBe(false)
  })

  test('is built once the login is this computer’s', async () => {
    pages.watch = {
      admit: () => Promise.resolve(true),
      moved: () => undefined,
      closed: () => undefined,
    }

    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown

    expect(pages.of('a').live).toBe(true)
  })

  test('hears where each page goes, whether it settled, and each tab that closed', async () => {
    const moved: [string, boolean][] = []
    const closed: string[] = []
    pages.watch = {
      admit: () => Promise.resolve(true),
      moved: (tab, _page, settled) => moved.push([tab, settled]),
      closed: (tab) => closed.push(tab),
    }

    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    const tell = await hearing('nib://web-tab')
    const load = (loading: boolean) =>
      tell({ payload: { tab: 'a', url: SITE, title: '', back: false, forward: false, loading } })
    load(true)
    load(false)
    pages.forget('a')

    expect(moved).toEqual([
      ['a', false],
      ['a', true],
    ])
    expect(closed).toEqual(['a'])
  })

  test('a page whose login went elsewhere while it was being built is put away as it lands', async () => {
    pages.watch = {
      admit: () => Promise.resolve(true),
      moved: () => undefined,
      closed: () => undefined,
    }

    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    pages.of('a').lock = { device: 'Laptop', pressed: false, take: () => undefined }
    arrive()
    await shown
    await settle()

    expect(pages.of('a').live).toBe(false)
    expect(last('web_close')).toMatchObject({ tab: 'a', keep: true })
    pages.of('a').lock = null
  })

  test('typed into the bar of a running page stops the page instead of sending it', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    pages.watch = {
      admit: () => Promise.resolve(false),
      moved: () => undefined,
      closed: () => undefined,
    }

    await pages.go('a', 'https://elsewhere.example/')
    await settle()

    expect(commands()).not.toContain('web_navigate')
    expect(last('web_close')).toMatchObject({ tab: 'a', keep: true })
  })
})

/** A tab whose pane is measured while something of the app's is still over it.
 *
 *  This is what "browser tabs take an eternity to load" was. Every way of opening a
 *  website except clicking its row in the file list goes through a layer - the
 *  palette, the app menu, the chooser Ctrl+T opens - and a layer that has closed is
 *  still in the document for the fifth of a second it takes to play its way out. The
 *  pane mounted under it, the hit test said covered, and the page was not asked for at
 *  all; nothing asked again, because the rectangle had not changed. The tab sat on an
 *  empty pane until the reader clicked something.
 *
 *  So what is over the hole decides how the page is placed and never whether there is
 *  one: the page is built, and built out of sight, because a native webview drawn over
 *  a menu is the other half of the same bug. See `show` and `look` in WebTab.svelte. */
describe('a page asked for while something is over the pane', () => {
  test('is built anyway', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)
    expect(pages.of('a').live).toBe(true)
  })

  test('and is put out of sight rather than over the thing that covered it', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: false })
    // And nothing is photographed: a page built this moment has nothing on it worth
    // standing in for it, and a photograph is the most expensive thing the crate does.
    expect(commands()).not.toContain('web_shot')
  })

  test('and is shown the moment nothing is over it any more', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()
    calls.length = 0

    await pages.show('a', SITE, PANE, true)
    await settle()

    expect(commands()).not.toContain('web_open')
    expect(last('web_place')).toMatchObject({ tab: 'a', visible: true })
  })
})

/** A page arriving is one photograph, however many times the engine says so.
 *
 *  The crate reports where a page is again whenever its title or its mark arrives, so
 *  a page landing is three reports in a few milliseconds. Each of them threw the still
 *  picture away and asked for another, and a photograph is a fifth of a second of the
 *  window's own thread - three of them at once, in the breath the reader is watching
 *  the page appear. Counted rather than timed: the count is the same number on a busy
 *  machine as on an idle one. */
test('a page that lands is photographed once, not once per report', async () => {
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown
  await settle()
  const moved = await hearing('nib://web-tab')
  calls.length = 0

  const said = { tab: 'a', url: SITE, title: '', back: false, forward: false }
  moved({ payload: { ...said, loading: true } })
  moved({ payload: { ...said, loading: false, title: 'Example Domain' } })
  moved({ payload: { ...said, loading: false } })
  await settle()

  expect(commands().filter((one) => one === 'web_shot')).toHaveLength(1)
})

/** The site's mark, as the engine says it.
 *
 *  Emil, 2026-09-28: *"sometimes whatsapp just doesn't get its icon and keeps at the
 *  default icon."* The engine now says a page's mark every time it changes, as the
 *  picture itself, and the tab follows every one of them - WhatsApp redraws its mark
 *  with an unread count. The file keeps only the one each load arrived with, so an
 *  unread count never rewrites the note. See web_icons.rs. */
describe("a page's mark", () => {
  const PLAIN = 'data:image/png;base64,cGxhaW4='
  const BADGED = 'data:image/png;base64,YmFkZ2Vk'
  const NEW = 'data:image/png;base64,bmV3'

  async function loaded() {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    const moved = await hearing('nib://web-tab')
    const iconed = await hearing('nib://web-icon')

    const load = (loading: boolean) =>
      moved({ payload: { tab: 'a', url: SITE, title: '', back: false, forward: false, loading } })
    const mark = (icon: string) => iconed({ payload: { tab: 'a', icon } })
    return { load, mark, page: pages.of('a') }
  }

  /** The clock the window's own rule reads, moved by hand. */
  let now = 0
  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('the tab follows every change and the file keeps the one it arrived with', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    mark(BADGED)

    expect(page.icon).toBe(BADGED)
    expect(page.kept).toBe(PLAIN)
  })

  // web.whatsapp.com's own shape: the site's `/favicon.ico` while the page loads, and
  // its real mark added by a script a moment after the load.
  test('a mark set just after the load is still the one it arrived with', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 1_300
    mark(NEW)

    expect(page.kept).toBe(NEW)
  })

  test('the next load brings a new mark to the file', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    load(true)
    mark(NEW)
    load(false)

    expect(page.icon).toBe(NEW)
    expect(page.kept).toBe(NEW)
  })

  test('a page with no mark leaves the tab bare and the file its own', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    load(true)
    mark('')

    expect(page.icon).toBeNull()
    expect(page.kept).toBe(PLAIN)

    // A mark that arrives after the page said it had none is still one it arrived
    // with: an empty answer is never kept.
    mark(NEW)
    expect(page.icon).toBe(NEW)
    expect(page.kept).toBe(NEW)
  })

  test('what is not a mark is not heard', async () => {
    const { mark, page } = await loaded()
    heard.get('nib://web-icon')?.({ payload: { tab: 'a', icon: 7 } })
    heard.get('nib://web-icon')?.({ payload: null })
    expect(page.icon).toBeNull()

    mark(PLAIN)
    expect(page.icon).toBe(PLAIN)
  })
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

describe('where a page keeps what the site stores', () => {
  /** A private tab's page is the engine's private mode, in no space's store. */
  test('a private page is built private, in the store every space shares', async () => {
    const page = pages.of('a')
    page.inPrivate = true
    page.space = 'w'
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown
    expect(last('web_open')).toMatchObject({ tab: 'a', profile: { store: null, private: true } })
  })

  test('in the store every space shares, until its space keeps its own', async () => {
    pages.of('a').space = 'w'
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown

    expect(last('web_open')).toMatchObject({ tab: 'a', profile: { store: null, private: false } })
  })

  test('a choice made for the space builds its open pages again in the new store', async () => {
    const { webData } = await import('./web-data.svelte')
    pages.of('a').space = 'w'
    pages.of('b').space = 'h'
    for (const tab of ['a', 'b']) {
      const shown = pages.show(tab, SITE, PANE)
      ;(await asked())()
      building = null
      await shown
    }
    calls.length = 0

    webData.set('w', 'space')
    const rebuilt = pages.restore('w')
    ;(await asked())()
    await rebuilt
    await settle()

    // The page in the space that chose is built again, where it was, in the space's own
    // store; the other space's page is left alone.
    expect(calls.filter((one) => one.command === 'web_close').map((one) => one.args.tab)).toEqual([
      'a',
    ])
    expect(last('web_open')).toMatchObject({ tab: 'a', profile: { store: 'space_w' }, pane: PANE })
    webData.set('w', 'global')
  })

  test('a choice that leaves a page in the store it was built in loads nothing again', async () => {
    const { webData } = await import('./web-data.svelte')
    webData.set('w', 'space')
    pages.of('a').space = 'w'
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown
    calls.length = 0

    // What an agent writing the same choice again does; see agents/workspace/settings.ts.
    await pages.restore('w')
    await settle()

    expect(commands()).not.toContain('web_close')
    expect(pages.of('a').live).toBe(true)
    webData.set('w', 'global')
  })
})

/** Emil, 2026-10-01: *"When I cycle with Ctrl+Tab through my tabs, some of them fully
 *  reload every time."* A seventh running page parked the one looked at longest ago. A
 *  page out of sight is frozen now and comes back as it was; only Memory saver ever
 *  takes one down. See resting.ts. */
describe('a page out of sight', () => {
  const TABS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
  const MINUTES = 60_000

  afterEach(async () => {
    pausing = null
    refusing = false
    photographing = null
    for (const tab of TABS) pages.forget(tab)
    const { saver } = await import('./saver.svelte')
    saver.set('off')
    await settle()
  })

  /** A tab whose page has been built, on screen. */
  async function built(tab: string, url = SITE): Promise<void> {
    building = null
    const shown = pages.show(tab, url, PANE)
    ;(await asked())()
    await shown
  }

  /** Out of sight for this long. */
  function away(tab: string, minutes: number): void {
    pages.hide(tab, PANE)
    pages.of(tab).looked = Date.now() - minutes * MINUTES
  }

  /** Each freeze (true) and thaw (false) the crate was asked for, for one tab. */
  function lulls(tab: string): unknown[] {
    return calls
      .filter((one) => one.command === 'web_pause' && one.args.tab === tab)
      .map((one) => one.args.paused)
  }

  async function memorySaver(mode: 'off' | 'moderate' | 'balanced' | 'maximum'): Promise<void> {
    const { saver } = await import('./saver.svelte')
    saver.set(mode)
  }

  test('is never parked for the old cap or the old half hour, unless Memory saver says', async () => {
    for (const tab of TABS) {
      await built(tab)
      away(tab, 600)
    }
    pages.retime()

    // Ten hours out of sight, and eight of them: every one frozen, and none closed.
    await vi.waitFor(() => expect(TABS.map((tab) => lulls(tab))).toEqual(TABS.map(() => [true])))
    expect(commands()).not.toContain('web_close')
    expect(TABS.every((tab) => pages.of(tab).live)).toBe(true)
  })

  test('is frozen five minutes after it went out of sight, and not before', async () => {
    await built('t0')
    away('t0', 4)
    pages.retime()
    await settle()
    expect(lulls('t0')).toEqual([])

    pages.of('t0').looked = Date.now() - 5 * MINUTES
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
  })

  test('is never frozen while it plays, was heard a moment ago, may be in a call or may notify', async () => {
    const { grants, siteOf } = await import('./permissions.svelte')
    const CALL = 'https://call.example.com/'
    const CHAT = 'https://chat.example.com/'
    grants.remember(siteOf(CALL), 'camera', 'allow')
    grants.remember(siteOf(CHAT), 'notifications', 'allow')
    await built('t0')
    await built('t1')
    await built('t2', CALL)
    await built('t3', CHAT)
    await built('t4')
    pages.of('t0').playing = true
    pages.of('t1').heard = Date.now() - 2 * MINUTES
    for (const tab of ['t0', 't1', 't2', 't3', 't4']) away(tab, 30)
    pages.retime()

    // The one with nothing going on is frozen; the others go on running.
    await vi.waitFor(() => expect(lulls('t4')).toEqual([true]))
    expect(['t0', 't1', 't2', 't3'].map((tab) => lulls(tab))).toEqual([[], [], [], []])
    grants.remember(siteOf(CALL), 'camera', null)
    grants.remember(siteOf(CHAT), 'notifications', null)
  })

  test('is never frozen while an agent is acting in it', async () => {
    const { agentMarks } = await import('../agent-marks.svelte')
    await built('t0')
    await built('t1')
    agentMarks.on = { t0: { agent: 'claude', colour: '#000', paused: false } }
    away('t0', 30)
    away('t1', 30)
    pages.retime()

    await vi.waitFor(() => expect(lulls('t1')).toEqual([true]))
    expect(lulls('t0')).toEqual([])
    agentMarks.on = {}
  })

  test('the page on screen is never frozen, however long it has been looked at', async () => {
    await built('t0')
    pages.of('t0').looked = Date.now() - 60 * MINUTES
    pages.freeze('t0')
    pages.retime()
    await settle()

    expect(lulls('t0')).toEqual([])
  })

  test('comes back as it was: woken before it is placed, never built again', async () => {
    await built('t0')
    away('t0', 30)
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
    calls.length = 0

    await pages.show('t0', SITE, PANE)

    expect(commands()).toEqual(['web_pause', 'web_place'])
    expect(last('web_pause')).toMatchObject({ tab: 't0', paused: false })
    expect(last('web_place')).toMatchObject({ tab: 't0', visible: true })
  })

  test('a thaw waits for a freeze still on its way, so the page shown is never hidden', async () => {
    await built('t0')
    let answer = (): void => undefined
    pausing = new Promise<void>((go) => (answer = go))
    away('t0', 30)
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))

    // Ctrl+Tab comes round to it while the crate is still freezing it.
    const showing = pages.show('t0', SITE, PANE)
    await settle()
    expect(lulls('t0')).toEqual([true])
    expect(last('web_place')?.visible).toBe(false)

    pausing = null
    answer()
    await showing

    const order = calls
      .filter((one) => one.command === 'web_pause' || one.command === 'web_place')
      .slice(-3)
      .map((one) => `${one.command} ${String(one.args.paused ?? one.args.visible)}`)
    expect(order).toEqual(['web_pause true', 'web_pause false', 'web_place true'])
  })

  test('a page left while it is being photographed is hidden once the picture is in', async () => {
    await built('t0')
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    pages.of('t0').shot = null
    const shooting = pages.shoot('t0')
    calls.length = 0

    // The press that switches tabs photographed the page on its way.
    pages.hide('t0', PANE)
    await settle()
    const out = calls.filter((one) => one.command === 'web_place')
    expect(out).toHaveLength(1)
    expect(out[0]?.args).toMatchObject({ visible: true, pane: { x: -20_000, y: -20_000 } })

    landed()
    await shooting
    await settle()
    expect(last('web_place')).toMatchObject({ tab: 't0', pane: PANE, visible: false })
  })

  test('a freeze the engine refused leaves the page running, and is asked again later', async () => {
    await built('t0')
    refusing = true
    // Judged as it goes out of sight, once it has said where it is.
    away('t0', 30)
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
    await settle()

    expect(pages.of('t0').frozen).toBe(false)
    expect(pages.of('t0').resting).toBeDefined()
    // Shown again, it is placed and nothing is woken: it was never frozen.
    calls.length = 0
    await pages.show('t0', SITE, PANE)
    expect(commands()).toEqual(['web_place'])
  })

  test("Hidden tabs' Pause and the countdown are one freeze: never twice, woken once", async () => {
    await built('t0')
    away('t0', 0)
    pages.freeze('t0')
    pages.freeze('t0')
    pages.of('t0').looked = Date.now() - 30 * MINUTES
    pages.retime()
    await settle()
    await settle()
    expect(lulls('t0')).toEqual([true])

    await pages.thaw('t0')
    await pages.show('t0', SITE, PANE)
    expect(lulls('t0')).toEqual([true, false])
  })

  describe('with Memory saver on', () => {
    test('the pages out of sight beyond its count are parked, looked at longest ago first', async () => {
      await memorySaver('maximum')
      for (const [at, tab] of TABS.entries()) {
        await built(tab)
        away(tab, 20 - at)
      }

      // Six kept: the two away longest go as the seventh and eighth are built.
      await vi.waitFor(() =>
        expect(calls.filter((one) => one.command === 'web_close').map((one) => one.args)).toEqual([
          { tab: 't0', keep: true },
          { tab: 't1', keep: true },
        ]),
      )
    })

    test('a page out of sight for its time is parked, keeping its trail', async () => {
      await memorySaver('maximum')
      await built('t0')
      away('t0', 29)
      pages.retime()
      await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
      expect(commands()).not.toContain('web_close')

      pages.of('t0').looked = Date.now() - 31 * MINUTES
      pages.retime()
      await vi.waitFor(() => expect(last('web_close')).toEqual({ tab: 't0', keep: true }))
      expect(pages.of('t0').live).toBe(false)
    })

    test('never a page on screen, nor one under a menu, however many there are', async () => {
      await memorySaver('maximum')
      for (const tab of TABS) await built(tab)
      // One under a layer of the app's: hidden, and still the tab in front of its pane.
      await pages.show('t0', SITE, PANE, false)
      for (const tab of TABS) pages.of(tab).looked = Date.now() - 600 * MINUTES
      pages.retime()
      await settle()

      expect(pages.of('t0').shown).toBe(false)
      expect(commands()).not.toContain('web_close')
    })

    test('never one with something typed into it, nor a pinned one', async () => {
      await memorySaver('maximum')
      looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: true }
      await built('t0')
      away('t0', 60)
      await vi.waitFor(() => expect(pages.of('t0').edited).toBe(true))
      looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: false }
      await built('t1')
      pages.of('t1').pinned = true
      away('t1', 60)
      await built('t2')
      away('t2', 60)
      pages.retime()

      await vi.waitFor(() => expect(last('web_close')).toEqual({ tab: 't2', keep: true }))
      expect(calls.filter((one) => one.command === 'web_close')).toHaveLength(1)
    })
  })
})

/** A page asking for a window of its own, as the crate tells it: which tab, where, and
 *  whether the press that asked left the tab behind. Read, not trusted; see
 *  src-tauri/src/web_opens.rs for how the crate knows. */
describe('what a page asking for a window says', () => {
  test('carries whether the tab goes behind', () => {
    expect(readOpening({ tab: 't', url: 'https://example.com/', behind: true })).toEqual({
      tab: 't',
      url: 'https://example.com/',
      behind: true,
    })
  })

  test('is in front when it does not say, as a crate from before this said nothing', () => {
    expect(readOpening({ tab: 't', url: 'https://example.com/' })?.behind).toBe(false)
    expect(readOpening({ tab: 't', url: 'https://example.com/', behind: 'yes' })?.behind).toBe(
      false,
    )
  })

  test('names nothing a tab may not hold', () => {
    expect(readOpening({ tab: 't', url: 'file:///C:/Windows/', behind: true })).toBeNull()
    expect(readOpening({ url: 'https://example.com/' })).toBeNull()
  })
})
