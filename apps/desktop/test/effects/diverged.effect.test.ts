/** Sync v2's one question, from a held note to an answer.
 *
 *  The engine is the fake one (sync2/fake-engine.svelte.ts), which meets the interface
 *  the real engine hands over, and everything else is real: the workspace with notes
 *  open in tabs, the overlays stack, the sheet, the mark and the toast. What is asked
 *  is when the question comes up - only over the held note in front, only once the
 *  typing has paused and nothing else is over it, one at a time - and that each of its
 *  three answers, and closing it, does what docs/sync-v2.md section 4 says.
 *
 *  In the jsdom project because every one of those is an effect watching a store. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Held } from '../../src/lib/sync2/asking.svelte'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'windows',
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(command === 'read_note' ? `# ${String(args?.path)}` : undefined),
}))

/** The sheet and the toast move through the Web Animations API, which jsdom has not got.
 *  Each movement ends at once, so a sheet that closes is gone before the next test: the
 *  sheet stays mounted from one note to the next, as it does in the app. */
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
    set onfinish(done: (() => void) | null) {
      queueMicrotask(() => done?.())
    },
  }) as unknown as Animation

/** The sheet's scrollbar follows its content's size, which jsdom never changes. */
globalThis.ResizeObserver = class {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

const { overlays } = await import('../../src/lib/overlays')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { asking, QUIET } = await import('../../src/lib/sync2/asking.svelte')
const { connectFake } = await import('../../src/lib/sync2/fake-engine.svelte')
const { back } = await import('../../src/lib/sync2/resurrected.svelte')
const { UNDO_LINGER } = await import('../../src/lib/undo-toast.svelte')
const HeldMark = (await import('../../src/lib/sync2/HeldMark.svelte')).default
const UndoToast = (await import('../../src/lib/UndoToast.svelte')).default

const PATHS = ['/space/Plan.md', '/space/Trip.md', '/space/Other.md']

function held(id: string, path: string, mineAt: number, theirsAt: number): Held {
  return {
    id,
    path,
    name: id,
    mine: {
      device: 'Laptop',
      at: mineAt,
      excerpt: { text: 'We meet at noon on Friday.', marks: [[11, 15]] },
    },
    theirs: {
      device: 'iPhone',
      at: theirsAt,
      excerpt: {
        text: 'We meet at one on Saturday.',
        marks: [
          [11, 14],
          [18, 26],
        ],
      },
    },
  }
}

const PLAN = held('Plan', '/space/Plan.md', 1_000, 2_000)
const TRIP = held('Trip', '/space/Trip.md', 3_000, 1_000)

let fake: ReturnType<typeof connectFake>

function tabAt(path: string) {
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} is not open`)
  return tab
}

function inFront(path: string) {
  workspace.activeTabId = tabAt(path).id
  flushSync()
}

// The sheet mounts itself into the page with the first held note; see `sheet` in
// asking.svelte.ts.
const page = document.body
const dialog = () => page.querySelector<HTMLElement>('[role="dialog"]')
const keeps = () => [...page.querySelectorAll<HTMLButtonElement>('.keep')]
const both = () => page.querySelector<HTMLButtonElement>('.both')

/** A press with a pointer, which is never taken for a stray key. */
function press(button: HTMLButtonElement | null | undefined) {
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

beforeEach(async () => {
  for (const path of PATHS) await workspace.open(path)
  inFront('/space/Other.md')
  fake = connectFake([PLAN, TRIP])
  flushSync()
  // The same fetch the store made, so this waits for the sheet it mounted.
  await import('../../src/lib/sync2/Diverged.svelte')
  await Promise.resolve()
  flushSync()
})

afterEach(async () => {
  fake.stop()
  flushSync()
  await vi.waitFor(() => expect(dialog()).toBeNull())
  workspace.tabs = []
  document.documentElement.dir = 'ltr'
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('when it asks', () => {
  test('only while a held note is the one in front', () => {
    expect(dialog()).toBeNull()

    inFront('/space/Plan.md')
    expect(dialog()?.getAttribute('aria-label')).toBe('Plan')
    expect(page.textContent).toContain('We meet at noon on Friday.')
    expect(page.textContent).toContain('We meet at one on Saturday.')
  })

  test('about one note at a time, the next when its own note is in front', async () => {
    inFront('/space/Plan.md')
    expect(page.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog()?.getAttribute('aria-label')).toBe('Plan')

    press(keeps()[0])
    await vi.waitFor(() => expect(fake.engine.held.notes.map((one) => one.id)).toEqual(['Trip']))
    flushSync()
    expect(asking.asked).toBeNull()

    inFront('/space/Trip.md')
    expect(page.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog()?.getAttribute('aria-label')).toBe('Trip')
  })

  test('not while the keys are still going, and once they have paused', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

    inFront('/space/Plan.md')
    expect(dialog()).toBeNull()

    vi.advanceTimersByTime(QUIET)
    flushSync()
    expect(dialog()?.getAttribute('aria-label')).toBe('Plan')
  })

  test('not under anything else that is over the note, and once it has gone', () => {
    const off = overlays.show(() => undefined)
    inFront('/space/Plan.md')
    expect(dialog()).toBeNull()

    off()
    flushSync()
    expect(dialog()?.getAttribute('aria-label')).toBe('Plan')
  })
})

describe('the answers', () => {
  test.each([
    [0, 'mine'],
    [1, 'theirs'],
  ] as const)('the Keep on card %i keeps %s', async (card, answer) => {
    inFront('/space/Plan.md')
    press(keeps()[card])

    await vi.waitFor(() => expect(fake.engine.held.answered).toEqual([['Plan', answer]]))
    flushSync()
    expect(asking.asked).toBeNull()
  })

  test('Keep both keeps both, and opens the copy beside the note', async () => {
    const opened = vi.spyOn(workspace, 'openRow').mockResolvedValue(undefined)
    inFront('/space/Plan.md')
    press(both())

    await vi.waitFor(() => expect(opened).toHaveBeenCalled())
    expect(fake.engine.held.answered).toEqual([['Plan', 'both']])
    expect(opened).toHaveBeenCalledWith('/space/Plan (Laptop).md', {
      activate: false,
      beside: true,
    })
  })

  test('an answer that does not go through says so, and the question stays', async () => {
    fake.engine.held.failing = new Error('the account could not be reached')
    inFront('/space/Plan.md')
    press(keeps()[0])

    await vi.waitFor(() => expect(asking.wrong).toBe('the account could not be reached'))
    flushSync()
    expect(dialog()).not.toBeNull()
    expect(page.textContent).toContain('the account could not be reached')
    expect(fake.engine.held.notes.map((one) => one.id)).toEqual(['Plan', 'Trip'])
  })

  test('Escape changes nothing, and the note asks again when it is next in front', () => {
    inFront('/space/Plan.md')
    expect(overlays.escape()).toBe(true)
    flushSync()

    expect(asking.asked).toBeNull()
    expect(fake.engine.held.answered).toEqual([])
    expect(fake.engine.held.notes).toHaveLength(2)

    // Still in front: closed stays closed, whatever else moves.
    const off = overlays.show(() => undefined)
    off()
    flushSync()
    expect(asking.asked).toBeNull()

    inFront('/space/Other.md')
    inFront('/space/Plan.md')
    expect(asking.asked?.id).toBe('Plan')
  })
})

describe('the keyboard', () => {
  test('lands on the newer version, and Left and Right go between the two', () => {
    inFront('/space/Plan.md')
    // The other device wrote last in Plan.
    expect(document.activeElement).toBe(keeps()[1])

    keeps()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.activeElement).toBe(keeps()[0])
    keeps()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(keeps()[1])
  })

  test('which is mirrored where the interface reads right to left', () => {
    document.documentElement.dir = 'rtl'
    inFront('/space/Trip.md')
    // This device wrote last in Trip.
    expect(document.activeElement).toBe(keeps()[0])

    keeps()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.activeElement).toBe(keeps()[1])
  })

  test('keeps the one it is on, but not with a key that was already on its way', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    inFront('/space/Plan.md')

    // Enter on a button is a click with no pointer behind it.
    const key = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
    document.activeElement?.dispatchEvent(key())
    flushSync()
    expect(fake.engine.held.answered).toEqual([])

    now.mockReturnValue(10_500)
    document.activeElement?.dispatchEvent(key())
    await vi.waitFor(() => expect(fake.engine.held.answered).toEqual([['Plan', 'theirs']]))
  })
})

describe('what stands in for words', () => {
  test('a file that is not a note: its name, its size and, for a picture, the picture', () => {
    const picture = (device: string, at: number, size: number) => ({
      device,
      at,
      excerpt: { text: '', marks: [] },
      file: { name: 'Cover.png', size, picture: `blob:${device}` },
    })
    fake.engine.held.notes = [
      {
        id: 'Cover',
        path: '/space/Other.md',
        name: 'Cover.png',
        mine: picture('Laptop', 1_000, 2_048),
        theirs: picture('iPhone', 2_000, 3 * 1024 * 1024),
      },
    ]
    flushSync()

    const cards = [...page.querySelectorAll('.side')]
    expect(cards.map((card) => card.querySelector('.size')?.textContent)).toEqual([
      '2.0 KB',
      '3.0 MB',
    ])
    expect(cards.map((card) => card.querySelector('img')?.getAttribute('src'))).toEqual([
      'blob:Laptop',
      'blob:iPhone',
    ])
    expect(cards[0]?.querySelector('.called')?.textContent).toBe('Cover.png')
  })
})

describe('what a held note wears and says', () => {
  test('the mark, on the held note and nowhere else', () => {
    const marks = document.createElement('div')
    document.body.append(marks)
    const plan = mount(HeldMark, { target: marks, props: { path: '/space/Plan.md' } })
    const other = mount(HeldMark, { target: marks, props: { path: '/space/Other.md' } })
    flushSync()

    const found = marks.querySelectorAll('[role="img"]')
    expect(found).toHaveLength(1)
    expect(found[0]?.getAttribute('aria-label')).toBe('Waiting for you')

    fake.engine.held.notes = []
    flushSync()
    expect(marks.querySelectorAll('[role="img"]')).toHaveLength(0)

    void unmount(plan)
    void unmount(other)
    marks.remove()
  })

  test('a note that came back says so, for as long as the undo toast stays', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const notices = document.createElement('div')
    document.body.append(notices)
    const toast = mount(UndoToast, { target: notices })
    flushSync()

    fake.engine.emit('resurrected', { id: 'Plan', name: 'Plan', device: 'iPhone' })
    await vi.waitFor(() => expect(back.said).not.toBeNull())
    flushSync()
    expect(notices.textContent).toContain('Plan is back: iPhone was writing in it')

    vi.advanceTimersByTime(UNDO_LINGER)
    flushSync()
    expect(back.said).toBeNull()

    void unmount(toast)
    notices.remove()
  })
})
