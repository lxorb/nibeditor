import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Ctrl+S, which means one thing: put it on the disk. For a file, a silent write of
 *  what is owed - never a question, never a file picker, and never the browser's own
 *  Save page as; for a tab with no file, where it goes. See `writeKey` in
 *  shortcuts.svelte.ts. */

const writeNow = vi.fn(() => Promise.resolve())
/** The tab in front: a note with a file unless a test says otherwise. */
const front = {
  active: { id: 'tab', note: { path: '/s/a.md' as string | null, shared: null, kind: 'note' } },
}
vi.mock('./workspace.svelte', () => ({
  workspace: {
    writeNow,
    fileOps: { follow: () => () => undefined },
    get active() {
      return front.active
    },
  },
}))

const askPlace = vi.fn()
vi.mock('./save-place/ask', () => ({ askPlace }))

/** The store asks the browser what kind of machine this is, and reads its storage. */
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

const { shortcuts } = await import('./shortcuts.svelte')

/** A press as the window hears it. */
function press(key: string, held: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  let prevented = false
  const event = {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: held.ctrl ?? false,
    metaKey: held.meta ?? false,
    shiftKey: held.shift ?? false,
    altKey: false,
    get defaultPrevented() {
      return prevented
    },
    preventDefault: () => {
      prevented = true
    },
  }
  // A keystroke is all the chord reads; the rest of the DOM's event is not needed.
  return event as unknown as KeyboardEvent
}

beforeEach(() => {
  writeNow.mockClear()
  askPlace.mockClear()
  front.active.note.path = '/s/a.md'
  front.active.note.kind = 'note'
})

describe('Ctrl+S', () => {
  test('writes what is owed now, and takes the press from the browser', () => {
    const event = press('s', { ctrl: true })

    expect(shortcuts.writeKey(event)).toBe(true)
    expect(writeNow).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  /** Nothing is on Ctrl+Shift+S any more; it is left to whatever somebody puts there. */
  test('and not with Shift, which is not the chord', () => {
    expect(shortcuts.writeKey(press('S', { ctrl: true, shift: true }))).toBe(false)
    expect(writeNow).not.toHaveBeenCalled()
  })

  /** A command somebody put on Ctrl+S answered first; this is only the default. */
  test('and nothing where something else already answered the press', () => {
    const event = press('s', { ctrl: true })
    event.preventDefault()

    expect(shortcuts.writeKey(event)).toBe(false)
    expect(writeNow).not.toHaveBeenCalled()
  })

  /** VS Code's Ctrl+S on an untitled editor, without its file dialog: the one thing
   *  about a new tab nobody has said is where it goes. */
  test('asks where a tab with no file goes, and writes nothing', async () => {
    front.active.note.path = null

    expect(shortcuts.writeKey(press('s', { ctrl: true }))).toBe(true)
    await vi.waitFor(() => expect(askPlace).toHaveBeenCalledWith('tab'))
    expect(writeNow).not.toHaveBeenCalled()
  })

  test('and the same of a web tab nobody has kept', async () => {
    front.active.note.path = null
    front.active.note.kind = 'web'

    shortcuts.writeKey(press('s', { ctrl: true }))
    await vi.waitFor(() => expect(askPlace).toHaveBeenCalledWith('tab'))
  })

  test('and no command of the registry has it', () => {
    expect(shortcuts.handle(press('s', { ctrl: true }), {} as never)).toBe(false)
  })
})
