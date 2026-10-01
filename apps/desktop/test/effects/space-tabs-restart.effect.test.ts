import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A restart brings back every space's own set: the one on screen as the session's own
 *  arrangement, the others built back through the same restore at the launch's last
 *  turn. Two runs of the store in one test, the second a fresh import of every module
 *  reading what the first wrote, the way a relaunch reads it. */

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
]

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve(SPACES)
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PLAN = '/spaces/Work/Plan.md'
const FOOD = '/spaces/Home/Food.md'

/** One run of the app's stores, freshly imported. */
async function run() {
  const { workspace } = await import('../../src/lib/workspace.svelte')
  const onScreen = () =>
    workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))
  return { workspace, onScreen }
}

test('each space comes back with its own tabs', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(PLAN, '# Plan\n')
  disk.current.files.set(FOOD, '# Food\n')
  localStorage.clear()

  // The first run: Home shares the global tabs, Work keeps its own.
  let first: unknown
  {
    const { workspace } = await run()
    first = workspace
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/spaces/Work' },
      { id: 'home', name: 'Home', root: '/spaces/Home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    await workspace.openEntry(FOOD)

    const { sets } = await import('../../src/lib/workspace/sets.svelte')
    await sets.choose('work', 'space')
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)
    workspace.persist()
  }

  // The second: everything read back from what the first wrote.
  vi.resetModules()
  const { workspace, onScreen } = await run()
  expect(workspace).not.toBe(first)
  await workspace.restore()
  flushSync()

  expect(workspace.activeSpaceId).toBe('work')
  expect(onScreen()).toEqual(['Plan.md'])

  // The shared set, built back behind the window at the launch's last turn.
  const { tabSets } = await import('../../src/lib/workspace/spaces')
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true))
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Food.md'))
  expect(onScreen()).toEqual(['Plan.md'])

  await workspace.showSpace('home')
  expect(onScreen()).toEqual(['Food.md'])

  await workspace.showSpace('work')
  expect(onScreen()).toEqual(['Plan.md'])
})
