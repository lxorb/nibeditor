import { expect, test, vi } from 'vitest'

/** The recent list is the app's own, which the palette reads. Nothing goes to the
 *  system's any more - the taskbar's Jump List, the Dock icon's menu, Recent Items -
 *  because a recent document there is a file handed back to nib from outside, and
 *  nib opens nothing from outside its spaces. And a note an older nib opened from
 *  elsewhere is not offered again. */

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async () => undefined,
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

test('the recent list is the notes in a space', () => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.device.remember('/downloads/Outside.md')
  workspace.device.remember('/space/One.md')

  expect(workspace.recent).toEqual(['/space/One.md'])
})
