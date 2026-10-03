/** The plus on a phone, pressed: a draft rather than a file, and the keyboard in it.
 *
 *  Emil, 2026-10-03: *"'+' creates Untitled.md at once, the keyboard doesn't come up,
 *  and a hardware Enter makes more."* A phone raises its keyboard only for focus given
 *  inside the tap, so the editor has to be on the page and focused before the handler
 *  returns; and the plus has to let the keyboard go, or Enter presses it again. See
 *  write-new.ts. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const written: string[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'write_note') written.push(String(args?.path))
    return Promise.resolve(undefined)
  },
}))

// jsdom has no observer for a box changing size; the pane's scrollbar asks for one.
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

window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia

const { workspace } = await import('../../src/lib/workspace.svelte')
const { writeNew } = await import('../../src/lib/write-new')
const { isDraft } = await import('../../src/lib/workspace/drafts')
const Pane = (await import('../../src/lib/Pane.svelte')).default

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  written.length = 0
  target = document.createElement('div')
  document.body.append(target)
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  workspace.tabs = []
})

/** The plus, pressed: the button in the hand, focused as a tap or a key leaves it. */
function press(plus: HTMLButtonElement) {
  plus.focus()
  writeNew({ currentTarget: plus } as unknown as Event)
}

test('a draft, with the caret in it before the tap is over, and no file', async () => {
  const pane = workspace.panes.focused
  shown = mount(Pane, { target, props: { pane } })
  flushSync()

  const plus = document.createElement('button')
  document.body.append(plus)
  press(plus)

  const tab = workspace.active
  expect(tab && isDraft(tab.note)).toBe(true)
  // Synchronously: a phone keeps its keyboard down for focus given a frame later.
  expect(document.activeElement?.classList.contains('cm-content')).toBe(true)

  await vi.dynamicImportSettled()
  expect(written).toEqual([])
  plus.remove()
})

test('the plus lets the keyboard go, so an Enter types rather than pressing it again', () => {
  const plus = document.createElement('button')
  document.body.append(plus)

  press(plus)

  expect(document.activeElement).not.toBe(plus)
  plus.remove()
})
