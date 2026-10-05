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

/** A build held open, for the tests about a pane that goes away in the middle of one.
 *  Null while `web_open` is to answer at once, which is every other test. */
let holding: Promise<void> | null = null

/** A command the crate refuses, for the tests about what the window may conclude from
 *  one. Every call into the crate can fail - a webview taken down while a call was in
 *  the air, an engine that would not answer - and what the window does with that is the
 *  difference between a page it builds again and a page left drawn over the app. */
let refuses: string | null = null

/** Whether the crate says it cuts the app's layers out of a page, as the system's engine
 *  on Windows does, rather than having the window hide the page behind its picture. */
let cuts = false

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    if (command === refuses) return Promise.reject(new Error(`${command} was refused`))
    if (command === 'web_open' && holding) return holding
    if (command === 'web_place') return Promise.resolve(cuts)
    return Promise.resolve(undefined)
  },
}))

// The one listener the store starts for the window. Tauri's own needs the window's
// internals, which a test has none of.
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

/** jsdom never lays anything out, so nothing is ever resized; what each observer is
 *  watching is kept, so a test can say an element changed size. */
class NoLayout {
  static readonly all: NoLayout[] = []
  readonly watched = new Set<Element>()

  constructor(readonly heard: ResizeObserverCallback) {
    NoLayout.all.push(this)
  }

  observe(node: Element) {
    this.watched.add(node)
  }

  unobserve(node: Element) {
    this.watched.delete(node)
  }

  disconnect() {
    this.watched.clear()
  }
}

/** Says to every observer watching `node` that it changed size. */
function resized(node: Element) {
  for (const one of NoLayout.all) {
    if (one.watched.has(node)) one.heard([], one)
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

  // A layer a test has put somewhere of its own.
  const given = this.getAttribute('data-box')
  if (given !== null) {
    const rect = JSON.parse(given) as { x: number; y: number; width: number; height: number }
    return {
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }
  }

  // A tab's hover card, where its translate puts it, at its width and its height with a
  // still. Read off the attribute, because jsdom's style object does not know `translate`.
  const placed = this.classList.contains('card')
    ? /translate:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(this.getAttribute('style') ?? '')
    : null
  if (placed) {
    const rect = { x: Number(placed[1]), y: Number(placed[2]), width: 256, height: 216 }
    return {
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
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

/** jsdom plays no animations, so no layer of a test's is ever on its way in or out. */
Element.prototype.getAnimations = () => []

/** And no Web Animations API, which a tab's hover card arrives and leaves through. How it
 *  moves is paint. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    // Over as soon as it is asked how it ends, so a card on its way out leaves the document.
    set onfinish(done: (() => void) | null) {
      queueMicrotask(() => done?.())
    },
  }) as unknown as Animation

/** jsdom has no `CSS` namespace; the card finds the pane it hangs over by `CSS.escape`. */
Object.defineProperty(globalThis, 'CSS', { value: { escape: (text: string) => text } })

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
const { hovering } = await import('../../src/lib/tab-strip/hover-card.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default

// What the pages store fetches the first time it is asked for something, loaded before
// any clock is stopped. A module that has to be compiled is the one wait below that no
// clock can move, and it is how a busy machine used to make a page arrive after the
// frames a test had given it; see `frames`.
await Promise.all([
  import('../../src/lib/web-tab/visited'),
  import('../../src/lib/web-tab/web-data.svelte'),
  import('../../src/lib/web-tab/keys'),
  import('../../src/lib/web-tab/downloads.svelte'),
])

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
  asked.length = 0
  over = null
  holding = null
  refuses = null
  cuts = false
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  // A hover card left up by a test that failed half way puts nothing over the next one.
  hovering.hush()
  for (const pane of document.querySelectorAll('body > [data-pane]')) pane.remove()
  target.remove()
  vi.useRealTimers()
})

/** Long enough for every frame, turn and timer the pane sets going to have had its
 *  go, on a clock the test moves: `startup.turn` waits for a painted frame, a layer on
 *  its way out is looked at again every frame until it has gone, and each of those is a
 *  timer.
 *
 *  Moved by hand rather than waited for. With a real clock a machine busy enough could
 *  hold the process past the test's timer and a chain of the pane's own, and the test's
 *  went first: the page was asked for after the test had looked. Here the timers go off
 *  in the order they are due whatever the machine is doing, and nothing waits. */
async function frames(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300)
}

/** The launch, over: every stage has had its turn, so a pane asks for its page in the
 *  breath it mounts. */
async function launched(): Promise<void> {
  startup.reset()
  const shown = startup.shown()
  await frames()
  await shown
}

test('switching away from a web tab keeps the page and switching back does not build one', async () => {
  await launched()

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

/** One of the app's layers, as the theme package shapes it, at `box`. */
function layer(kind: string, box = { x: 100, y: 100, width: 240, height: 200 }): HTMLElement {
  const made = document.createElement('div')
  made.className = kind
  made.setAttribute('data-box', JSON.stringify(box))
  document.body.append(made)
  return made
}

/** A native webview draws above every pixel of HTML in the window, so a layer the app
 *  opens over the page has to be answered by the page - and it has to be answered the
 *  moment the overlay opens rather than at the next press, because a palette row opens
 *  the next overlay and Escape closes one. An engine that cannot cut the layer out of the
 *  page hides the page, photographed first. See `coverOf` in WebTab.svelte and
 *  overlays.ts. */
test('the page is hidden while a layer of the app is over it, and comes back when it goes', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/over'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  // A menu: on the overlay stack, and a `.nib-layer` over the page.
  asked.length = 0
  const menu = layer('nib-layer')
  const off = overlays.show(() => undefined)
  await frames()

  const hidden = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(hidden?.args.visible).toBe(false)
  // And the page was photographed first, so the pane holds the page rather than nothing
  // while the menu is over it: a picture asked for after the page went out of sight is
  // a picture of nothing.
  const said = asked.map((one) => one.command)
  expect(said).toContain('web_shot')
  expect(said.indexOf('web_shot')).toBeLessThan(
    asked.findIndex((one) => one.command === 'web_place' && one.args.visible === false),
  )

  asked.length = 0
  off()
  menu.remove()
  await frames()

  const shown = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(shown?.args.visible).toBe(true)

  void unmount(app)
})

/** Emil, 2026-10-03: *"While a toast shows or while hovering things, the website is
 *  sometimes invisible until he stops."* Anything open anywhere used to hide every page in
 *  the window: a tab's hover card over the strip, a menu over the file list. A layer that
 *  is not over the page leaves it alone. */
test('a layer that is not over the page leaves it alone', async () => {
  const { app } = await opened('https://example.com/beside')

  asked.length = 0
  const card = layer('nib-bubble', { x: 820, y: 10, width: 200, height: 120 })
  const off = overlays.show(() => undefined)
  await frames()

  expect(asked.filter((one) => one.command === 'web_place' && one.args.visible === false)).toEqual(
    [],
  )
  expect(asked.map((one) => one.command)).not.toContain('web_shot')

  off()
  card.remove()
  void unmount(app)
})

/** On an engine that cuts (the system's own on Windows), a menu over the page is cut out
 *  of it in its own shape: the page stays on screen round it and is never hidden, and the
 *  menu going puts the whole page back. See web_cut.rs. */
test('a menu over the page is cut out of it, and the page stays', async () => {
  cuts = true
  const { app } = await opened('https://example.com/cut')

  asked.length = 0
  const menu = layer('nib-layer', { x: 100, y: 140, width: 240, height: 200 })
  const off = overlays.show(() => undefined)
  await frames()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  expect(placed.at(-1)?.args.cut).toEqual({
    all: false,
    hollows: [{ x: 100, y: 100, width: 240, height: 200, radius: 0 }],
  })

  asked.length = 0
  off()
  menu.remove()
  await frames()

  const back = asked.filter((one) => one.command === 'web_place').at(-1)
  expect(back?.args).toMatchObject({ visible: true, cut: null })

  void unmount(app)
})

/** Emil, 2026-10-03, a picture of a hovered tab: under the strip, where the page should
 *  have been, black. His build hid every page under a tab's hover card behind its still,
 *  and a page with no still left the pane empty for as long as the card was up. On an
 *  engine that cuts, the card is cut out of the page and nothing else of it changes:
 *  the page is never hidden, never all cut away, and never waits on a photograph. */
async function hoverOver(tab: import('../../src/lib/workspace.svelte').Tab) {
  // The pane the page is in, under where the card hangs.
  const pane = document.createElement('div')
  pane.setAttribute('data-pane', tab.paneId)
  pane.setAttribute('data-box', JSON.stringify({ x: 0, y: 0, width: 800, height: 600 }))
  document.body.append(pane)
  hovering.enter({ tab, box: { left: 100, right: 300, bottom: 38 }, widest: 238, focused: true })
  await frames()
  return () => hovering.hush()
}

test('a tab’s hover card over the page is cut out of it, and the page never blanks', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/hovered')
  pages.of(tab.id).shot = null

  asked.length = 0
  const done = await hoverOver(tab)
  expect(document.querySelector('.card')).not.toBeNull()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.length).toBeGreaterThan(0)
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  expect(placed.some((one) => (one.args.cut as { all: boolean } | null)?.all === true)).toBe(false)
  expect(placed.at(-1)?.args.cut).toMatchObject({ all: false })

  asked.length = 0
  done()
  await frames()
  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args).toMatchObject({
    visible: true,
    cut: null,
  })
  void unmount(app)
})

/** Emil, 2026-10-05, a picture of a hovered tab: the card had slid on from the tab beside
 *  it, and the page was still cut round where the card had been - all of the card but a
 *  strip, where the two places met, stood behind the page. A slide opens nothing on the
 *  overlay stack, so the page never looked again. Now it hears of the slide, and the cut
 *  goes where the card went. */
test('a hover card sliding on to the next tab takes its cut with it', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/slid')
  const hollow = () =>
    (
      asked.filter((one) => one.command === 'web_place').at(-1)?.args.cut as {
        hollows: { x: number; y: number }[]
      } | null
    )?.hollows[0]

  const done = await hoverOver(tab)
  expect(hollow()).toMatchObject({ x: 100 })

  hovering.enter({ tab, box: { left: 420, right: 620, bottom: 38 }, widest: 238, focused: true })
  await frames()
  expect(hovering.card?.sliding).toBe(true)
  expect(hollow()).toMatchObject({ x: 420 })

  done()
  await frames()
  void unmount(app)
})

/** A layer can grow while it is open - the address field's suggestions as they arrive -
 *  which is neither a press nor a change to the overlay stack. The page watches the
 *  layers over it as it watches its own hole, and is cut round the layer as it is now. */
test('a layer that grows while it is open is cut out of the page at its new size', async () => {
  cuts = true
  const { app } = await opened('https://example.com/grown')
  const hollow = () =>
    (
      asked.filter((one) => one.command === 'web_place').at(-1)?.args.cut as {
        hollows: { height: number }[]
      } | null
    )?.hollows[0]

  const suggest = layer('nib-layer', { x: 100, y: 60, width: 400, height: 40 })
  const off = overlays.show(() => undefined)
  await frames()
  expect(hollow()).toMatchObject({ height: 40 })

  suggest.setAttribute('data-box', JSON.stringify({ x: 100, y: 60, width: 400, height: 240 }))
  resized(suggest)
  await frames()
  expect(hollow()).toMatchObject({ height: 240 })

  off()
  suggest.remove()
  await frames()
  void unmount(app)
})

/** An engine that cannot cut hides a page behind its still for the card - and a page the
 *  engine would not photograph is left in front of the card instead, since behind it there
 *  would be nothing but an empty pane. */
test('a hover card never hides a page there is no picture of', async () => {
  const { tab, app } = await opened('https://example.com/unpictured')
  pages.of(tab.id).shot = null

  asked.length = 0
  const done = await hoverOver(tab)

  expect(asked.map((one) => one.command)).toContain('web_shot')
  expect(asked.filter((one) => one.command === 'web_place' && one.args.visible === false)).toEqual(
    [],
  )
  // And the card gives way rather than stand half behind the page.
  expect(hovering.card).toBeNull()

  done()
  await frames()
  void unmount(app)
})

/** A sheet over its scrim covers all of the page, and the page's picture is what the scrim
 *  dims. A page with none yet has the sheet cut out of it first - never the sheet behind
 *  the page, never an empty pane - and all of it once the picture is in. */
test('a sheet over the page covers all of it once its picture is in', async () => {
  cuts = true
  const { tab, app } = await opened('https://example.com/sheet')
  pages.of(tab.id).shot = null

  asked.length = 0
  const scrim = layer('nib-scrim', { x: 0, y: 0, width: 800, height: 600 })
  const sheet = layer('nib-screen', { x: 200, y: 100, width: 400, height: 300 })
  const off = overlays.show(() => undefined)
  await frames()

  const placed = asked.filter((one) => one.command === 'web_place')
  expect(placed.every((one) => one.args.visible === true)).toBe(true)
  // The sheet alone first, then all of it: the photograph was asked for in between.
  const first = placed.findIndex((one) => (one.args.cut as { all: boolean } | null)?.all === false)
  expect(first).toBeGreaterThanOrEqual(0)
  expect(asked.map((one) => one.command)).toContain('web_shot')

  off()
  scrim.remove()
  sheet.remove()
  await frames()
  void unmount(app)
})

/** A tab carried out of its strip hangs under the pointer over the panes, and every
 *  pane puts its drop zones up under it. Neither is on the overlay stack, and the tab
 *  lifts ten pixels after its own press - whenever the hand gets there - so nothing the
 *  pane was already listening for said the page had to go. In the native app the page
 *  stayed in front: the carried tab vanished as it left the strip and the zones were
 *  lit behind the page. See `covered` in WebTab.svelte. */
test('the page is hidden while a drag is over the panes, and comes back when it ends', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/carried'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).shown).toBe(true)

  asked.length = 0
  workspace.panes.dragging = { tabId: tab.id }
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(asked.map((one) => one.command)).toContain('web_shot')

  asked.length = 0
  workspace.panes.dropped()
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(true)

  void unmount(app)
})

/** Emil, 2026-09-18: *"For some reason a browser tab displayed above everything else.
 *  For example when I switched to a note, there was still the browser open."*
 *
 *  A native webview is an operating system surface over the window and obeys nothing
 *  about the app's stacking, so a page that is not put away covers the note, the tab
 *  strip and every menu: the app is unreachable and nothing on screen says why. The
 *  pane going away has to say so, and this is the assertion that it does. */
test('a pane that goes away puts its page out of sight', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/away'

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)
  expect(pages.of(tab.id).shown).toBe(true)

  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
})

/** The same, for a pane that goes away while its page is still being built.
 *
 *  A page takes a hundred and forty milliseconds to arrive and a tab switch takes one
 *  press, so this is not a rare order: the build answers into a window that has already
 *  moved on, and what it must not do is show the page it was asked for. */
test('a page that arrives after its pane has gone is never shown', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/late'

  // The build held open, so the pane can go away in the middle of one - which is what
  // switching tabs a moment after opening a website is.
  let land: () => void = () => undefined
  holding = new Promise<void>((go) => {
    land = go
  })

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(asked.map((one) => one.command)).toContain('web_open')

  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  land()
  holding = null
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
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
  await launched()

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

/** Mounts a web tab with a page behind it, for the tests below. */
async function opened(url: string) {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no web tab was opened')

  pages.of(tab.id).url = url

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  expect(pages.of(tab.id).live).toBe(true)

  return { tab, app }
}

/** What the window may conclude from a call the crate refused.
 *
 *  `live` is the window's own idea of whether there is a webview behind a tab, and every
 *  command used to write it from its own failure: one refused address, one refused step,
 *  one refused placement, and the window had decided the page was gone. It is a guess,
 *  and it is the guess that cost Emil his window - a page the window thinks is gone is a
 *  page nothing places again, and a native webview nothing places is drawn over the
 *  note, the tab strip and every menu until the tab is closed. See `place`. */
test('a refused address is not a page that has gone', async () => {
  const { tab, app } = await opened('https://example.com/refused')

  refuses = 'web_navigate'
  await pages.go(tab.id, 'https://example.com/elsewhere')
  refuses = null

  // The page is still there as far as anything here knows, so the pane goes on placing
  // it - and if it really has gone, the next placement is what finds that out.
  expect(pages.of(tab.id).live).toBe(true)

  refuses = 'web_step'
  await pages.step(tab.id, 'back')
  refuses = null
  expect(pages.of(tab.id).live).toBe(true)

  void unmount(app)
})

/** Emil, 2026-09-18: *"For some reason a browser tab displayed above everything else.
 *  For example when I switched to a note, there was still the browser open."*
 *
 *  The pane going away says so - that is the test above this block - and it used to say
 *  so only while the window believed there was a page to say it about. One refused call
 *  anywhere took that belief away, and the hide then did nothing at all: the webview
 *  stayed exactly where it was, on top of whatever the pane showed next, with nothing
 *  left in the window able to reach it.
 *
 *  So the belief gates showing a page and never hiding one. Being wrong about a page
 *  that is gone costs one refused call; being wrong the other way costs the window. */
test('a page the window has given up on is still put out of sight', async () => {
  const { tab, app } = await opened('https://example.com/given-up')

  // A placement that was refused, which is the one direction allowed to conclude that
  // the page has gone.
  refuses = 'web_place'
  await pages.place(tab.id, { x: 0, y: 40, width: 800, height: 560 }, true)
  refuses = null
  expect(pages.of(tab.id).live).toBe(false)

  // The tab strip switches to a note.
  asked.length = 0
  void unmount(app)
  flushSync()
  await frames()

  expect(asked.filter((one) => one.command === 'web_place').at(-1)?.args.visible).toBe(false)
  expect(pages.of(tab.id).shown).toBe(false)
})

/** The other half of the same rule, at the other end of a page's life.
 *
 *  The crate refuses a second page under one label, so a build that comes back refused
 *  may have been refused *because* there is already one - running, wherever it was last
 *  placed, and about to be a page the window has no record of. The pane is told there is
 *  no page only once the label is empty. */
test('a build the crate refuses leaves no page behind it', async () => {
  await launched()

  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) return

  pages.of(tab.id).url = 'https://example.com/refused-build'

  refuses = 'web_open'
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await frames()
  refuses = null

  expect(pages.of(tab.id).live).toBe(false)
  expect(pages.of(tab.id).openable).toBe(false)
  const closed = asked.filter((one) => one.command === 'web_close').at(-1)
  expect(closed?.args.keep).toBe(false)

  void unmount(app)
})

/** The still picture, which is the half of this mechanism a photograph of the window
 *  cannot tell from the page: a reader cannot either.
 *
 *  Asked because of the same report. A page put out of sight leaves the pane holding a
 *  picture of it, and a picture left drawn where a note now is would look exactly like a
 *  browser that never went away - and it would be a picture, so asking the window
 *  whether the webview is hidden would say yes the whole time.
 *
 *  It is drawn in one place, which is the hole inside the web surface, and the hole goes
 *  with the pane: there is nowhere for it to be left. That is what this holds to. */
test('the still picture goes with the pane it was taken for', async () => {
  const { tab, app } = await opened('https://example.com/still')

  const shot = 'data:image/png;base64,iVBORw0KGgo='
  pages.of(tab.id).shot = shot
  flushSync()

  const hole = target.querySelector('.hole')
  expect(hole?.getAttribute('style')).toContain(shot)

  void unmount(app)
  flushSync()
  await frames()

  expect(document.querySelector('.hole')).toBe(null)
  expect(document.body.innerHTML).not.toContain(shot)
})

/** A picture is of one size of page. The notices row coming or going, or a divider
 *  moving, puts the page at another, and the old picture under the next menu then left
 *  a band of empty pane below it - seen in the native app once the update notice went. */
test('a picture of the page goes when the page is shown at another size', async () => {
  const { tab, app } = await opened('https://example.com/resized')
  const shot = 'data:image/png;base64,iVBORw0KGgo='
  const pane = pages.of(tab.id).pane
  if (!pane) throw new Error('the page was never placed')

  pages.of(tab.id).shot = shot
  await pages.place(tab.id, pane, true)
  expect(pages.of(tab.id).shot).toBe(shot)

  await pages.place(tab.id, { ...pane, height: pane.height - 78 }, true)
  expect(pages.of(tab.id).shot).toBeNull()

  void unmount(app)
})
