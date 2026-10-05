import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

/** Whether the system holds quick add's key for nib, as the crate answers it.
 *
 *  The key from any app keeps nib in the tray (docs/tasks.md decision 6), and that was
 *  read off the switch in Settings rather than off the crate: where the key was not held
 *  after all - another app has it, or the build is a probe, which never takes the
 *  reader's key - nib still stayed in the tray for a key it did not have, and a probe's
 *  window closed into a tray icon on somebody's taskbar instead of ending. In the jsdom
 *  project because the answer lands in an effect. */

let answer: string | null = null

vi.mock('../../src/lib/tauri', async (original) => ({
  ...(await original<typeof import('../../src/lib/tauri')>()),
  invoke: vi.fn((command: string) =>
    Promise.resolve(command === 'quick_add_key' ? answer : undefined),
  ),
}))

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: { request: (_name: string, _how: unknown, held: () => Promise<void>) => held() },
})

const { listen } = await import('../../src/lib/quick-add/anywhere.svelte')
const { quickAdd } = await import('../../src/lib/quick-add/asked.svelte')

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  quickAdd.anywhere = true
})

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) {
    flushSync()
    await Promise.resolve()
  }
}

test('is what the crate holds, not what the switch asks for', async () => {
  quickAdd.anywhere = true
  answer = null
  stop = listen()
  await settled()
  expect(quickAdd.held).toBe(false)

  answer = 'Control+Alt+Space'
  quickAdd.anywhere = false
  await settled()
  quickAdd.anywhere = true
  await settled()
  expect(quickAdd.held).toBe(true)

  answer = null
  quickAdd.anywhere = false
  await settled()
  expect(quickAdd.held).toBe(false)
})
