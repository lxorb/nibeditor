/** A web tab dragged by its mark: Emil, 2026-09-30, *"When I try to drag a web page
 *  and start with my cursor on the icon, it tries to drag the icon instead of the
 *  actual tab."* The favicon is an `<img>`, which a browser drags as a picture of its
 *  own unless told not to, and that drag takes the pointer away from the tab's.
 *
 *  jsdom has no native drag to start, so what this holds is the other half: a press
 *  on the picture is the tab's press, and the tab goes where it is carried. That the
 *  picture itself never drags is `draggable="false"`, which undraggable.test.ts holds
 *  for every picture the app draws. Mounted, because the press has to go down on the
 *  element a reader's pointer lands on. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// A browser build: no crate, and nothing about the strip is a platform's.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

// jsdom does no layout, so it has no observer for a box changing size, and the strip
// never learns its width: every tab is the standard width, which is what this wants.
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

/** Tabs grow in and slide along through the Web Animations API, which jsdom does not
 *  have. How they move is paint, and a drive looks at that. */
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

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default

/** Where the strip is on the glass: the top of a window a thousand pixels wide. The
 *  strip asks whether the pointer is still its own by this, and jsdom's own answer is
 *  a box of nothing, which would put every drag out over the panes. */
const STRIP = { left: 0, right: 1000, top: 0, bottom: 38, x: 0, y: 0, width: 1000, height: 38 }

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = this.classList.contains('tabs') ? STRIP : { ...STRIP, right: 0, bottom: 0 }
    return { ...box, toJSON: () => box }
  })
})

afterEach(() => {
  target.remove()
  vi.restoreAllMocks()
})

/** A pointer event at a point along the strip, as a mouse sends it. */
function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
    clientY: 20,
  })
}

test('a web tab pressed on its favicon and carried along moves the tab', async () => {
  workspace.tabs = []
  for (let at = 0; at < 3; at++) workspace.openWebsite()
  const paneId = workspace.panes.focusedId
  const strip = workspace.tabsIn(paneId)
  expect(strip).toHaveLength(3)
  for (const one of strip) pages.of(one.id).icon = 'https://example.com/favicon.ico'
  const first = strip[0]?.id

  const app = mount(Tabs, { target, props: { paneId } })
  flushSync()

  const icon = target.querySelector<HTMLImageElement>(`[data-box="${first}"] img`)
  expect(icon, 'the first tab wears its favicon').not.toBeNull()
  if (!icon) return
  expect(icon.getAttribute('draggable')).toBe('false')

  // Down on the picture, twenty pixels into the first tab, and along the strip past
  // the tabs after it, which a Chrome tab's drag follows one to one.
  icon.dispatchEvent(pointer('pointerdown', 28))
  icon.dispatchEvent(pointer('pointermove', 300))
  icon.dispatchEvent(pointer('pointermove', 700))
  flushSync()
  icon.dispatchEvent(pointer('pointerup', 700))
  flushSync()

  expect(
    workspace
      .tabsIn(paneId)
      .map((one) => one.id)
      .indexOf(first ?? ''),
  ).toBe(2)

  // The press fetched what a carried tab is drawn and landed with; waited for here, so
  // nothing of it is still loading once the test's environment is gone.
  await Promise.all([
    import('../../src/lib/tab-strip/TabChip.svelte'),
    import('../../src/lib/tab-strip/carrying'),
  ])
  void unmount(app, { outro: false })
})
