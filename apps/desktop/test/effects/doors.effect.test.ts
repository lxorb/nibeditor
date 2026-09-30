import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { held, latched } from '../../src/lib/surfaces.svelte'
import { reactive, root, watch } from './runes.svelte'

/** A door whose fetch failed.
 *
 *  hunt-7 found it: every door kept its promise, and a promise that had failed was the
 *  answer to every ask after it. One chunk lost to a flaky network, or to a deploy under
 *  a tab that stayed open, and the palette, the right-click menu, the prompt sheet,
 *  sign-in and the format bar were dead for the rest of the session without a word. A
 *  door tries twice now and forgets a fetch that failed both times; see door.ts in
 *  @nib/markdown for the helper and reloading.svelte.ts for what the page does about a
 *  module the browser will not fetch again.
 *
 *  In the jsdom project because a latched door is asked from an `$effect` in App.svelte,
 *  and what has to hold is that the failure does not wake that effect: a door that read
 *  the state it resets would ask again, fail again and reset again for as long as the
 *  page is open. */

/** A simulated dynamic import that fails its first `failures` calls. */
function flakyImport<T>(component: T, failures: number) {
  let calls = 0
  const load = vi.fn(() => {
    calls++
    return calls <= failures
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : Promise.resolve({ default: component })
  })
  return load
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('a sheet whose fetch failed twice is fetched again by the next ask', async () => {
  const load = flakyImport('Palette', 2)
  const sheet = latched(load)

  void sheet.ask()
  await vi.runAllTimersAsync()

  expect(load).toHaveBeenCalledTimes(2)
  expect(sheet.asked).toBeNull()

  await expect(sheet.ask()).resolves.toBe('Palette')
  expect(load).toHaveBeenCalledTimes(3)
  await expect(sheet.asked).resolves.toBe('Palette')
})

test('a sheet whose first try failed arrives on the second without anybody asking again', async () => {
  const load = flakyImport('Palette', 1)
  const sheet = latched(load)

  const asked = sheet.ask()
  await vi.runAllTimersAsync()

  await expect(asked).resolves.toBe('Palette')
  await expect(sheet.asked).resolves.toBe('Palette')
})

test('neither the markup nor whoever asked is handed the failure: the page answers it', async () => {
  const sheet = latched(flakyImport('Palette', 2))
  const heard = vi.fn()
  void sheet.ask().then(heard, heard)
  void sheet.asked?.then(heard, heard)

  await vi.runAllTimersAsync()

  expect(heard).not.toHaveBeenCalled()
  expect(sheet.asked).toBeNull()
})

test('the effect that asked is not woken by the failure', async () => {
  const load = flakyImport('Palette', 2)
  const sheet = latched(load)
  const open = reactive({ palette: false })
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      if (open.palette) void sheet.ask()
    })
  })
  flushSync()

  open.palette = true
  flushSync()
  await vi.runAllTimersAsync()
  flushSync()

  expect(runs).toBe(2)
  expect(load).toHaveBeenCalledTimes(2)

  stop()
})

test('a surface whose fetch failed is fetched again by the next tab of its kind', async () => {
  const load = flakyImport('Canvas', 2)
  const surface = held(load)

  const failed = surface()
  const settled = expect(failed).rejects.toThrow('Failed to fetch')
  await vi.runAllTimersAsync()
  await settled

  await expect(surface()).resolves.toBe('Canvas')
  expect(load).toHaveBeenCalledTimes(3)
})
