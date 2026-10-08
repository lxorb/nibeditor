import { beforeEach, expect, test, vi } from 'vitest'

/** The browser build's one question, asked once per browser. */

const held = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})

/** Loaded once here rather than in the first test; see docs/conventions.md. */
await import('./first-visit.svelte')

/** The store as a fresh load of the page finds it. */
async function reloaded() {
  vi.resetModules()
  const { firstVisit } = await import('./first-visit.svelte')
  return firstVisit
}

beforeEach(() => held.clear())

test('is asked on the visit that wrote the welcome note', async () => {
  const firstVisit = await reloaded()
  firstVisit.ask()
  expect(firstVisit.asking).toBe(true)
})

test('answered, is not asked again in that browser', async () => {
  const first = await reloaded()
  first.ask()
  first.answered()
  expect(first.asking).toBe(false)

  const again = await reloaded()
  again.ask()
  expect(again.asking).toBe(false)
})
