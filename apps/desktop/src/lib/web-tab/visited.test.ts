import { expect, test, vi } from 'vitest'

/** Storage for the test, since node has none; what the app writes is read back from
 *  here. */
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

const { visited } = await import('./visited')

test('a space that keeps its web data apart keeps its history apart', () => {
  visited.saw('nib:web-visits', 'a', 'https://ethz.ch/', 'ETH')
  visited.saw('nib:web-visits:0-work', 'b', 'https://moodle-app2.let.ethz.ch/', 'Moodle')

  expect(visited.suggest('nib:web-visits', 'moodle')).toEqual([])
  expect(visited.suggest('nib:web-visits:0-work', 'moodle').map((one) => one.url)).toEqual([
    'https://moodle-app2.let.ethz.ch/',
  ])
  expect(localStorage.getItem('nib:web-visits:0-work')).toContain('moodle-app2')
  expect(localStorage.getItem('nib:web-visits')).not.toContain('moodle-app2')
})

/** The words a row of the history under a held arrow reads. */
test("says what a page called itself, whatever the address's fragment", () => {
  visited.saw('nib:web-visits:titles', 'c', 'https://svelte.dev/docs', 'Svelte docs')

  expect(visited.titleOf('nib:web-visits:titles', 'https://svelte.dev/docs#intro')).toBe(
    'Svelte docs',
  )
  expect(visited.titleOf('nib:web-visits:titles', 'https://svelte.dev/blog')).toBe('')
})
