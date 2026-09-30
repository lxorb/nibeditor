/** A tab with no file, on screen: the dot after its name, which a web tab never wears
 *  and a saved tab loses; the press on the dot, which asks where it goes; and the
 *  layer that asks, whose Save writes the file there under the name typed. Emil,
 *  2026-09-30: *"When I open a new tab or note on nib it should be in an unsaved state
 *  (with no saving location) and there should be a dot behind it (indicating that). For
 *  web tabs there should not be the dot behind them if they're unsaved."* See
 *  workspace/drafts.ts and save-place/ask.ts. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const written: { path: string; content: string }[] = []

// A browser build: no crate, and a write is somewhere the test can read it back.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'write_note') {
      written.push({ path: String(args?.path), content: String(args?.content) })
    }
    return Promise.resolve(undefined)
  },
}))

// jsdom does no layout; the strip is every tab at the standard width, which is enough.
class NoLayout {
  observe() {
    // Nothing moves in jsdom.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

/** A reader who asked for less movement, so what comes and goes does it at once: jsdom
 *  plays no transition to its end. See motion.ts. */
window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia

/** Tabs grow in through the Web Animations API, which jsdom has not got. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { workspace } = await import('../../src/lib/workspace.svelte')
const { overlays } = await import('../../src/lib/overlays')
const { askPlace } = await import('../../src/lib/save-place/ask')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
  written.length = 0
  target = document.createElement('div')
  document.body.append(target)
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = null
})

afterEach(() => {
  if (app) void unmount(app, { outro: false })
  app = null
  while (overlays.escape()) {
    // Every layer a test left open, closed.
  }
  flushSync()
  document.body.replaceChildren()
})

function strip() {
  app = mount(Tabs, { target, props: { paneId: workspace.panes.focusedId } })
  flushSync()
}

const dotOn = (tabId: string) => target.querySelector(`[data-tab="${tabId}"] .nib-unsaved`)

test('a new note wears the dot, a new web tab none, and a saved note loses it', async () => {
  workspace.openBlank()
  const note = workspace.active
  // Written in, so the web tab opened next does not take its place as an empty page.
  note?.note.live.replace('# Plan', true)
  workspace.openWebsite()
  const web = workspace.active
  if (!note || !web) throw new Error('nothing opened')
  strip()

  expect(dotOn(note.id)).not.toBeNull()
  expect(dotOn(web.id)).toBeNull()

  await workspace.save(note, '/space', 'Plan.md')
  flushSync()

  expect(dotOn(note.id)).toBeNull()
})

test('a press on the dot asks where, and Save writes it there under the name typed', async () => {
  workspace.openBlank()
  const note = workspace.active
  if (!note) throw new Error('nothing opened')
  note.note.live.replace('# Plan\n\nwords', true)
  strip()

  dotOn(note.id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  // The layer is fetched with the press; here it is asked for directly as well, so the
  // test does not wait on the door's import.
  askPlace(note.id)
  flushSync()

  const layer = document.body.querySelector<HTMLElement>('[role="dialog"]')
  const name = layer?.querySelector<HTMLInputElement>('input')
  expect(name?.value).toBe('Plan')
  if (!layer || !name) return

  name.value = 'Monday'
  name.dispatchEvent(new Event('input', { bubbles: true }))
  layer
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  flushSync()

  await vi.waitFor(() => expect(note.path).toBe('/space/Monday.md'))
  expect(written).toEqual([{ path: '/space/Monday.md', content: '# Plan\n\nwords' }])
})

test('Escape leaves it as it was', () => {
  workspace.openBlank()
  const note = workspace.active
  if (!note) throw new Error('nothing opened')

  askPlace(note.id)
  flushSync()
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

  expect(overlays.escape()).toBe(true)
  flushSync()

  expect(note.path).toBeNull()
  expect(written).toEqual([])
})
