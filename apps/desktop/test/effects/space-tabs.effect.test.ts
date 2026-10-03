import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { root, watch } from './runes.svelte'

/** A space's own tabs, on the real workspace: a space set to Space keeps its tabs and
 *  the others get theirs, a switch swaps them in one step, a tab of a set out of sight
 *  comes forward with its space, and changing the choice either way loses nothing.
 *
 *  In the effects project because the store follows the list of spaces with an effect
 *  (a deleted space takes its set with it), and because "the first frame is the new
 *  set" is a question about what a watcher sees. The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
  { name: 'Uni', path: '/spaces/Uni' },
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

const { Disk } = await import('../disk')
disk.current = new Disk()

const { workspace } = await import('../../src/lib/workspace.svelte')
const { sets } = await import('../../src/lib/workspace/sets.svelte')
const { pane } = await import('../../src/lib/workspace/pane-tree')

const PLAN = '/spaces/Work/Plan.md'
const IDEAS = '/spaces/Work/Ideas.md'
const FOOD = '/spaces/Home/Food.md'
const NOTES = '/spaces/Work/Notes.md'

/** The names of the tabs on screen, pane by pane, in strip order. */
const onScreen = () =>
  workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))

const tabAt = (path: string) => {
  const found = workspace.tabs.find((tab) => tab.path === path)
  if (!found) throw new Error(`nothing open at ${path}`)
  return found
}

beforeEach(async () => {
  // Every space back to Global first, which merges whatever is put aside into the set on
  // screen; then nothing open at all.
  for (const space of workspace.spaces) await sets.choose(space.id, 'global')

  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(PLAN, '# Plan\n')
  one.files.set(IDEAS, '# Ideas\n')
  one.files.set(FOOD, '# Food\n')
  one.files.set(NOTES, '# Notes\n')

  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
    { id: 'uni', name: 'Uni', root: '/spaces/Uni' },
  ]
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  workspace.activeSpaceId = 'work'
  await workspace.loadTree()
  flushSync()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a space that keeps its own tabs', () => {
  test('keeps the ones that are its own, and the others stay shared', async () => {
    await workspace.openEntry(PLAN)
    await workspace.openEntry(FOOD)
    expect(onScreen()).toEqual(['Plan.md', 'Food.md'])

    await sets.choose('work', 'space')
    expect(onScreen()).toEqual(['Plan.md'])

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Food.md'])

    await workspace.showSpace('work')
    expect(onScreen()).toEqual(['Plan.md'])
    expect(workspace.active?.path).toBe(PLAN)
  })

  test('a space it never had a set for starts with an empty pane', async () => {
    await workspace.openEntry(PLAN)
    await sets.choose('uni', 'space')
    await workspace.showSpace('uni')

    expect(onScreen()).toEqual([])
    expect(workspace.panes.count).toBe(1)
    // Nothing closed: Plan is in the shared set, out of sight.
    expect(workspace.tabs.map((tab) => tab.name)).toEqual(['Plan.md'])
  })

  test('comes back arranged as it was left: panes, focus and the tab in front', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    workspace.split('row', tabAt(IDEAS).id)
    const focused = workspace.panes.focusedId
    const front = workspace.activeTabId

    await workspace.showSpace('home')
    expect(workspace.panes.count).toBe(1)

    await workspace.showSpace('work')
    expect(workspace.panes.count).toBe(2)
    expect(workspace.panes.focusedId).toBe(focused)
    expect(workspace.activeTabId).toBe(front)
  })

  /** Emil, 2026-10-03: a space switched away from and back came back on another note.
   *  Every pane's tab in front, the pane the keyboard was in and a pane put down with
   *  Ctrl+D, each exactly as left - with several tabs to a pane, the one in front not
   *  the last opened, and the focus in the first pane rather than the newest. */
  test('comes back exactly: each pane’s tab in front, the focused pane, a pane put down', async () => {
    await sets.choose('work', 'space')
    await sets.choose('home', 'space')
    for (const path of [PLAN, IDEAS, NOTES]) await workspace.openEntry(path)
    workspace.split('row', tabAt(NOTES).id)
    const [left, right] = workspace.panes.all
    if (!left || !right) throw new Error('no split')
    workspace.activate(tabAt(PLAN).id)
    const fronts = () => workspace.panes.all.map((one) => workspace.showing(one.id)?.name ?? null)
    expect(fronts()).toEqual(['Plan.md', 'Notes.md'])
    expect(workspace.panes.focusedId).toBe(left.id)

    for (const way of ['showSpace', 'selectSpace'] as const) {
      await workspace[way]('home')
      await workspace.openEntry(FOOD)
      await workspace[way]('work')
      expect(fronts(), way).toEqual(['Plan.md', 'Notes.md'])
      expect(workspace.panes.focusedId, way).toBe(left.id)
    }

    workspace.deselect(right.id)
    await workspace.showSpace('home')
    await workspace.showSpace('work')
    expect(fronts()).toEqual(['Plan.md', null])
    expect(workspace.panes.focusedId).toBe(left.id)
  })

  test('two spaces that share the set change nothing between them', async () => {
    await sets.choose('work', 'space')
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    const frame = workspace.panes.frame
    const tabs = [...workspace.tabs]

    await workspace.showSpace('uni')
    expect(workspace.panes.frame).toBe(frame)
    expect(workspace.tabs).toEqual(tabs)
    expect(onScreen()).toEqual(['Food.md'])
  })

  test('the first state anything sees after a switch is the new set, whole', async () => {
    await workspace.openEntry(PLAN)
    await sets.choose('work', 'space')
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    await workspace.showSpace('work')
    flushSync()

    const seen: string[] = []
    const stop = root(() => {
      watch(() => {
        seen.push(`${String(workspace.activeSpaceId)}: ${onScreen().join(', ')}`)
      })
    })
    flushSync()

    await workspace.showSpace('home')
    flushSync()
    await workspace.showSpace('work')
    flushSync()
    stop()

    expect(seen).toEqual(['work: Plan.md', 'home: Food.md', 'work: Plan.md'])
  })
})

describe('what is open in a set out of sight', () => {
  test('a tab of it brought to the front brings its space', async () => {
    await workspace.openEntry(PLAN)
    await sets.choose('work', 'space')
    await workspace.showSpace('home')
    const plan = tabAt(PLAN)

    workspace.activate(plan.id)
    await vi.waitFor(() => expect(workspace.activeSpaceId).toBe('work'))
    await vi.waitFor(() => expect(workspace.activeTabId).toBe(plan.id))
  })

  test('opening it again goes to where it is, and makes no second tab', async () => {
    await workspace.openEntry(PLAN)
    await sets.choose('work', 'space')
    await workspace.showSpace('home')

    await workspace.openEntry(PLAN)
    await vi.waitFor(() => expect(workspace.activeSpaceId).toBe('work'))
    expect(workspace.tabs.filter((tab) => tab.path === PLAN)).toHaveLength(1)
  })

  test('a deleted space takes its set with it', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    workspace.openBlank()
    await workspace.showSpace('home')
    expect(workspace.tabs).toHaveLength(2)

    workspace.spaces = workspace.spaces.filter((one) => one.id !== 'work')
    flushSync()
    expect(workspace.tabs).toHaveLength(0)
  })
})

describe('giving a space its tabs back', () => {
  test('on screen: the shared tabs join the end of the strip, and nothing is lost', async () => {
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    await sets.choose('work', 'space')
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)
    workspace.openBlank()

    await sets.choose('work', 'global')
    expect(onScreen()).toEqual(['Plan.md', 'Untitled', 'Food.md'])
    expect(sets.on).toBe('global')
  })

  test('out of sight: its tabs join the shared strip on screen', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)

    await sets.choose('work', 'global')
    expect(onScreen()).toEqual(['Food.md', 'Plan.md'])
  })
})

describe('the session', () => {
  test('writes no sets at all while every space shares the one on screen', async () => {
    await workspace.openEntry(PLAN)
    workspace.persist()

    const written = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as object
    expect('sets' in written).toBe(false)
  })

  test('writes the set on screen and every set put aside', async () => {
    await workspace.openEntry(FOOD)
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    workspace.persist()

    const written = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      sets?: { on: string; aside: Record<string, { layout: { frame: unknown } }> }
    }
    expect(written.sets?.on).toBe('work')
    expect(JSON.stringify(written.sets?.aside.global?.layout.frame)).toContain(FOOD)
    expect(JSON.stringify(written.sets?.aside.global?.layout.frame)).not.toContain(PLAN)
  })
})
