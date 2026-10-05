import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The hint store: which card goes up, when, and that one put away stays away. */

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {},
    toggleAttribute: () => false,
  },
})

/** Loaded once here rather than in the first test, which would spend its budget
 *  compiling; see docs/conventions.md. */
await import('./hints.svelte')

/** The store and the modes it reads, as a fresh start of the app finds them. */
async function restarted() {
  vi.resetModules()
  const { hints } = await import('./hints.svelte')
  const { modes } = await import('./modes.svelte')
  modes.restore()
  hints.restore()
  return { hints, modes }
}

beforeEach(() => localStorage.clear())

describe('a hint', () => {
  test('waits for the session to settle', async () => {
    const { hints } = await restarted()
    hints.want('graph', true)
    expect(hints.current).toBeNull()

    hints.settle()
    expect(hints.current).toBe('graph')
  })

  test('is the one that matters most of those wanted', async () => {
    const { hints } = await restarted()
    hints.want('palette', true)
    hints.want('sign-in', true)
    hints.settle()

    expect(hints.current).toBe('sign-in')
  })

  test('is one a session at most', async () => {
    const { hints } = await restarted()
    hints.want('sign-in', true)
    hints.want('graph', true)
    hints.settle()
    hints.dismiss('sign-in')

    expect(hints.current).toBeNull()
  })

  test('goes when its control no longer wants it', async () => {
    const { hints } = await restarted()
    hints.want('graph', true)
    hints.settle()
    hints.want('graph', false)

    expect(hints.current).toBeNull()
  })

  test('never shows in Silent mode', async () => {
    const { hints, modes } = await restarted()
    modes.toggleSilent()
    hints.want('graph', true)
    hints.settle()

    expect(hints.current).toBeNull()
  })

  test('put away stays away across a restart', async () => {
    const first = await restarted()
    first.hints.dismiss('sign-in')

    const { hints } = await restarted()
    expect(hints.seen).toEqual(['sign-in'])

    hints.want('sign-in', true)
    hints.want('palette', true)
    hints.settle()
    expect(hints.current).toBe('palette')
  })
})
