import { describe, expect, test, vi } from 'vitest'

/** Signing out under sync v2, as the app does it: the account forgets the session and,
 *  in the same moment, syncing is told to stop. The runner's way out writes v1's mirrors
 *  from the sync store first; the stop must not close that store under it. */

const forgotten = vi.hoisted(() => [] as string[])
vi.mock('./store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store')>()),
  forgetSyncStore: (id: string) => {
    forgotten.push(id)
    return Promise.resolve()
  },
}))

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

const { runner } = await import('./runner.svelte')

/** An engine kept as far as the way out reads it: one space whose first pass is done,
 *  in a store that refuses to be read once it is closed, the way the real one does. */
function engineWithOneSpace() {
  let open = true
  const store = {
    // Answered a moment later, as the crate answers: a read is a round trip.
    read: async (gets: readonly unknown[]) => {
      await new Promise((settle) => setTimeout(settle, 5))
      if (!open) throw new Error('the sync store is not open')
      return gets.map(() => ({ key: 'first', value: 1 }))
    },
    close: () => {
      open = false
      return Promise.resolve()
    },
  }
  const space = { id: 's1', row: { root: '/Notes', role: 'owner' }, entries: new Map() }
  return {
    core: { spaces: new Map([['s1', space]]), store, isHeld: () => false, world: {} },
    quit: () => Promise.resolve(),
    stop: () => undefined,
  }
}

describe('signing out', () => {
  test('writes the mirrors before the store is closed, though syncing stops at once', async () => {
    Object.assign(runner, { engine: engineWithOneSpace() })

    const leaving = runner.signedOut('u1')
    const stopping = runner.stop()
    await Promise.all([leaving, stopping])

    const kept = JSON.parse(localStorage.getItem('nib:mirrors') ?? 'null') as {
      account: string
      mirrors: Record<string, { spaceId: string }>
    } | null
    expect(kept?.account).toBe('u1')
    expect(kept?.mirrors['/Notes']?.spaceId).toBe('s1')
    expect(forgotten).toEqual(['u1'])
  })
})
