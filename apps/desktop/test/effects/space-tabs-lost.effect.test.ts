import { expect, test, vi } from 'vitest'

/** A set out of sight comes back after a restart on the tab it was left on. Two runs of
 *  the store, the second a fresh import of every module reading what the first wrote,
 *  the way a relaunch reads it; see space-tabs-restart.effect.test.ts. */

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

/** The tab in front of a set out of sight is written as its place along the strip. A
 *  tab before it that cannot come back - its file deleted while nib was closed - used
 *  to move every place after it one along, and the set came back on another note. */
test('a set comes back on the tab it was left on when one before it has gone', async () => {
  const IDEAS = '/spaces/Work/Ideas.md'
  const NOTES = '/spaces/Work/Notes.md'
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  for (const path of [PLAN, IDEAS, NOTES, FOOD]) disk.current.files.set(path, '# Words\n')
  localStorage.clear()

  {
    const { workspace } = await run()
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/spaces/Work' },
      { id: 'home', name: 'Home', root: '/spaces/Home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    const { sets } = await import('../../src/lib/workspace/sets.svelte')
    await sets.choose('work', 'space')
    await workspace.showSpace('work')
    for (const path of [PLAN, IDEAS, NOTES]) await workspace.openEntry(path)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.persist()
  }

  disk.current.files.delete(IDEAS)
  vi.resetModules()
  const { workspace, onScreen } = await run()
  await workspace.restore()
  const { tabSets } = await import('../../src/lib/workspace/spaces')
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true))
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Notes.md'))

  await workspace.showSpace('work')
  expect(onScreen()).toEqual(['Plan.md', 'Notes.md'])
  expect(workspace.active?.path).toBe(NOTES)
})
