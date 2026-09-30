import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Ctrl+S, which every hand still presses and nothing needs: a silent write of what
 *  is owed, never a question, never a file picker, and never the browser's own Save
 *  page as. See `writeKey` in shortcuts.svelte.ts. */

const writeNow = vi.fn(() => Promise.resolve())
vi.mock('./workspace.svelte', () => ({ workspace: { writeNow } }))

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

  test('and no command of the registry has it', () => {
    expect(shortcuts.handle(press('s', { ctrl: true }), {} as never)).toBe(false)
  })
})
