import { describe, expect, test, vi } from 'vitest'

/** Settings, General, Terminal, on a desktop: a row for each key that is both the app's
 *  and the shell's (Emil, issue #213), which shows the answer a terminal was given and
 *  takes it back. A file of its own because the build is a desktop's here, which the
 *  other file's is not; see terminal/two-ways.ts. */

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

vi.mock('./tauri', async (actual) => ({
  ...(await actual<typeof import('./tauri')>()),
  isDesktop: true,
  invoke: () => Promise.reject(new Error('no crate')),
}))

const { preferences } = await import('./preferences')
const { shells } = await import('./terminal/shells.svelte')
const { shortcuts } = await import('./shortcuts.svelte')

function row(label: string) {
  const found = preferences()
    .flatMap((pane) => pane.groups)
    .find((group) => group.title === 'Terminal')
    ?.fields.find((one) => one.label === label)
  if (found?.kind !== 'select') throw new Error(`no ${label}`)
  return found
}

describe('a key that is both, in Settings', () => {
  test('has a row each, asking every time until answered', () => {
    for (const label of ['Ctrl+T in a terminal', 'Ctrl+N in a terminal']) {
      const one = row(label)
      expect(one.options.map((option) => option.value)).toEqual(['ask', 'app', 'shell'])
      expect(one.get()).toBe('ask')
    }
    expect(row('Ctrl+N in a terminal').options.map((option) => option.label)).toEqual([
      'Always ask',
      'Scratchpad',
      'Terminal',
    ])
  })

  test('shows the answer a terminal was given, and takes it back', () => {
    shells.setWay('app.scratchpad', 'shell')
    expect(row('Ctrl+N in a terminal').get()).toBe('shell')

    row('Ctrl+N in a terminal').set('ask')
    expect(shells.ways['app.scratchpad']).toBeUndefined()

    row('Ctrl+N in a terminal').set('app')
    expect(shells.ways['app.scratchpad']).toBe('app')
    shells.setWay('app.scratchpad', null)
  })

  /** Moved off Ctrl and a letter, the key is no shell's, so there is nothing to ask. */
  test('has none for a key moved where no shell reads', () => {
    shortcuts.set('app.scratchpad', 'Mod-Shift-y')
    try {
      expect(() => row('Ctrl+Shift+Y in a terminal')).toThrow()
      expect(() => row('Ctrl+N in a terminal')).toThrow()
    } finally {
      shortcuts.reset('app.scratchpad')
    }
  })
})
