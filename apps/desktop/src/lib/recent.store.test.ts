import { expect, test, vi } from 'vitest'

/** The recent list is two lists: the app's own, which the palette and File > Open
 *  Recent read, and the system's, which the Dock icon's menu reads. Opening a note
 *  puts it in both, so clearing has to take it out of both - otherwise Clear Menu
 *  empties the menu and the Dock goes on naming the notes. See recent.rs. */

const asked: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string) => {
    asked.push(command)
    return undefined
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

const { workspace } = await import('./workspace.svelte')

test('clearing the recent list clears the system one too', () => {
  workspace.device.remember('/space/One.md')
  expect(workspace.recent).toEqual(['/space/One.md'])

  workspace.forgetRecent()

  expect(workspace.recent).toEqual([])
  expect(asked).toContain('forget_recent')
})
