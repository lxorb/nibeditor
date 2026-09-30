/** Settings > Sync, under either engine.
 *
 *  v1 keeps its conflict rule, its waiting list and its own log until it is retired.
 *  Under v2 the rule is gone (docs/sync-v2.md section 4, "What goes away"), what is
 *  waiting is the notes the engine holds - a press opens one, and the question with it
 *  - and the passes are the store's log, read again after every pass.
 *
 *  In the jsdom project because the pane follows the engine from inside an effect. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

/** The waiting list fades in through the Web Animations API, which jsdom has not got. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { settings } = await import('../../src/lib/settings.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { connectFake } = await import('../../src/lib/sync2/fake-engine.svelte')
const SyncPane = (await import('../../src/lib/SyncPane.svelte')).default

const PLAN = {
  id: 'Plan',
  path: '/space/Plan.md',
  name: 'Plan',
  mine: { device: 'Laptop', at: 1_000, excerpt: { text: 'noon', marks: [] } },
  theirs: { device: 'iPhone', at: 2_000, excerpt: { text: 'one', marks: [] } },
}

let target: HTMLElement
let shown: ReturnType<typeof mount>
let stop: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(SyncPane, { target })
  flushSync()
})

afterEach(() => {
  stop?.()
  stop = undefined
  void unmount(shown)
  target.remove()
  vi.restoreAllMocks()
})

test('v1 keeps its rule for a note written on two devices', () => {
  expect(target.textContent).toContain('When the same note was written twice')
  expect(target.textContent).toContain('On two devices')
})

test('v2 has no rule, and lists the notes it holds', () => {
  const fake = connectFake([PLAN])
  stop = fake.stop
  flushSync()

  expect(target.textContent).not.toContain('When the same note was written twice')
  expect(target.textContent).not.toContain('On two devices')
  expect(target.textContent).toContain('Waiting for you')
  expect(target.querySelector('.held')?.textContent).toContain('Plan')
})

test('a press on a held note opens it, out from under the settings', async () => {
  const opened = vi.spyOn(workspace, 'open').mockResolvedValue(undefined)
  const fake = connectFake([PLAN])
  stop = fake.stop
  settings.open = true
  flushSync()

  target.querySelector<HTMLButtonElement>('.held')?.click()
  await vi.waitFor(() => expect(opened).toHaveBeenCalledWith('/space/Plan.md'))
  expect(settings.open).toBe(false)
})

test('the passes are the store’s, and a new one is read as it is written', async () => {
  const fake = connectFake([])
  stop = fake.stop
  fake.engine.spaces = [
    { space_id: 's1', root: '/spaces/Work', cursor: 0, role: null, store: null },
  ]
  flushSync()

  fake.engine.emit('pass', { at: 1_000, space: 's1', pulled: 3, pushed: 1, failed: null })
  await vi.waitFor(() => expect(target.querySelector('.pass')).not.toBeNull())
  const pass = target.querySelector('.pass')?.textContent ?? ''
  expect(pass).toContain('3 down')
  expect(pass).toContain('1 up')
  expect(pass).toContain('Work')
  // The store keeps its own last thousand; there is nothing for the reader to clear.
  expect(target.textContent).not.toContain('Clear the list')
})
