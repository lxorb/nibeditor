import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The shells the crate found, which one a new terminal opens, and how large its type
 *  is. The crate itself is stood in for: what it answers is its own test, in
 *  src-tauri/src/terminal/shells.rs. */

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const answers: unknown[] = []
const invoke = vi.fn((command: string) => {
  if (command !== 'terminal_shells') return Promise.reject(new Error(command))
  return answers.length ? Promise.resolve(answers.shift()) : Promise.reject(new Error('no crate'))
})

vi.mock('../tauri', () => ({ isDesktop: true, invoke }))

const { shellName, shells, SIZES } = await import('./shells.svelte')

beforeEach(() => {
  invoke.mockClear()
  answers.length = 0
})

describe('the shells', () => {
  test('are asked for once, and read rather than trusted', async () => {
    answers.push([
      { id: 'pwsh', name: 'PowerShell' },
      { id: 'cmd', name: 'Command Prompt' },
      { id: 3, name: 'broken' },
      'nonsense',
    ])

    const found = await shells.ask()
    await shells.ask()

    expect(found.map((one) => one.id)).toEqual(['pwsh', 'cmd'])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  /** The platform's own is the first of the list; the one Settings chose wins while
   *  this machine still has it. */
  test('open the chosen one, and the platform’s own otherwise', () => {
    expect(shells.chosen?.id).toBe('pwsh')

    shells.choose('cmd')
    expect(shells.chosen?.id).toBe('cmd')
    expect(store.get('nib:terminal-shell')).toBe('cmd')

    shells.choose('wsl:Gone')
    expect(shells.chosen?.id).toBe('pwsh')
  })

  test('Command Prompt is called what Windows calls it, the rest their own names', () => {
    expect(shellName({ id: 'cmd', name: 'Command Prompt' })).toBe('Command Prompt')
    expect(shellName({ id: '/bin/zsh', name: 'zsh' })).toBe('zsh')
  })

  test('the type size stays inside what Settings offers', () => {
    shells.setSize(100)
    expect(shells.size).toBe(SIZES.most)
    shells.setSize(1)
    expect(shells.size).toBe(SIZES.least)
    shells.setSize(14.4)
    expect(shells.size).toBe(14)
    expect(store.get('nib:terminal-size')).toBe('14')
  })
})
