import { beforeEach, expect, test, vi } from 'vitest'

/** The rename said once, to the installs that knew the old name. */

const held = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: (at: number) => [...held.keys()][at] ?? null,
  get length() {
    return held.size
  },
})

/** Loaded once here rather than in the first test; see docs/conventions.md. */
await import('./renamed.svelte')

/** The notice as a fresh launch finds it. */
async function launched() {
  vi.resetModules()
  const { renamed } = await import('./renamed.svelte')
  return renamed
}

beforeEach(() => held.clear())

test('is said to an install an earlier version wrote settings into', async () => {
  held.set('nib:theme', 'dark')
  expect((await launched()).showing).toBe(true)
})

test('is said once, however many launches follow', async () => {
  held.set('nib:session', '{}')
  const first = await launched()
  first.dismiss()
  expect(first.showing).toBe(false)

  expect((await launched()).showing).toBe(false)
})

test('is never said to a fresh install, on this launch or the next', async () => {
  expect((await launched()).showing).toBe(false)

  // The fresh install's own settings, written during its first run.
  held.set('nib:theme', 'dark')
  expect((await launched()).showing).toBe(false)
})

test('reads nothing but its own app’s settings as an earlier version', async () => {
  held.set('somebody-else', 'yes')
  expect((await launched()).showing).toBe(false)
})
