import { flushSync } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Move to space, on the real workspace: the same tab goes to the other space's set - its
 *  own, or the shared one - and takes with it what makes it that space's: its file, or
 *  the space as its home. Nothing is closed and opened again, so nothing is lost.
 *
 *  In the effects project beside space-tabs.effect.test.ts, whose sets this moves tabs
 *  between. The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))
const histories = vi.hoisted(() => [] as string[])

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
    if (command.startsWith('terminal_history')) {
      histories.push(`${command.slice('terminal_history_'.length)} ${String(args?.space)}`)
      return Promise.resolve(null)
    }
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk } = await import('../disk')
disk.current = new Disk()

const { workspace } = await import('../../src/lib/workspace.svelte')
const { sets } = await import('../../src/lib/workspace/sets.svelte')
const { pane } = await import('../../src/lib/workspace/pane-tree')
const { moveToSpace } = await import('../../src/lib/workspace/moving-space')
const { written } = await import('../../src/lib/parting')

const PLAN = '/spaces/Work/Plan.md'
const IDEAS = '/spaces/Work/Ideas.md'
const FOOD = '/spaces/Home/Food.md'

const onScreen = () =>
  workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))

const tabAt = (path: string) => {
  const found = workspace.tabs.find((tab) => tab.path === path)
  if (!found) throw new Error(`nothing open at ${path}`)
  return found
}

/** A new note with words in it and no file yet. */
const blank = (words: string) => {
  workspace.openBlank()
  const draft = workspace.tabs.at(-1)
  if (!draft) throw new Error('no draft')
  draft.note.live.replace(words)
  return draft
}

const files = () => {
  if (!disk.current) throw new Error('no disk')
  return disk.current.files
}

beforeEach(async () => {
  for (const space of workspace.spaces) await sets.choose(space.id, 'global')

  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(PLAN, '# Plan\n')
  one.files.set(IDEAS, '# Ideas\n')
  one.files.set(FOOD, '# Food\n')
  histories.length = 0

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

describe('a tab moved to a space that keeps its own tabs', () => {
  test('leaves the strip, is in front of that space’s, and the window stays where it is', async () => {
    await sets.choose('work', 'space')
    await sets.choose('home', 'space')
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    const ideas = tabAt(IDEAS)

    await moveToSpace([ideas.id], 'home')
    expect(workspace.activeSpaceId).toBe('work')
    expect(onScreen()).toEqual(['Plan.md'])
    expect(workspace.active?.path).toBe(PLAN)

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Ideas.md'])
    expect(workspace.activeTabId).toBe(ideas.id)
  })

  test('its file goes with it, into the root of that space', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'home')
    expect(files().has(PLAN)).toBe(false)
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Plan\n')
    expect(plan.path).toBe('/spaces/Home/Plan.md')
    expect(workspace.tabs).toContain(plan)
  })

  test('an unsaved note keeps its words and is saved in its new space', async () => {
    await sets.choose('work', 'space')
    const draft = blank('# Shopping\n\nmilk')

    await moveToSpace([draft.id], 'uni')
    expect(draft.note.home).toBe('uni')
    expect(draft.note.text).toBe('# Shopping\n\nmilk')
    expect(onScreen()).toEqual([])

    await workspace.showSpace('uni')
    expect(onScreen()).toEqual([draft.name])
    expect(workspace.spaceOf(draft.note)).toBe('uni')
  })

  test('a terminal is the same tab, its lines moved to the new space’s folder', async () => {
    await sets.choose('home', 'space')
    workspace.openUnsaved(
      'terminal',
      JSON.stringify({ shell: 'cmd', folder: '/spaces/Work', key: 'k1' }),
      'Command Prompt',
    )
    const shell = workspace.tabs.at(-1)
    if (!shell) throw new Error('no terminal')
    const doc = shell.note

    await moveToSpace([shell.id], 'home')
    await written()
    expect(workspace.tabs).toContain(shell)
    expect(shell.note).toBe(doc)
    expect(shell.note.home).toBe('home')
    expect(histories).toEqual(['read work', 'forget work'])

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Command Prompt'])
  })

  test('a preview moved is kept, and the pane it left falls back to the tab before', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    await workspace.open(IDEAS, { preview: true })
    const ideas = tabAt(IDEAS)
    expect(workspace.previewTabId).toBe(ideas.id)

    await moveToSpace([ideas.id], 'home')
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.active?.path).toBe(PLAN)
  })

  test('a file takes every view of it, and a pane left with nothing goes', async () => {
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    await workspace.openEntry(IDEAS)
    workspace.split('row', tabAt(IDEAS).id)
    expect(workspace.panes.count).toBe(2)

    await moveToSpace([tabAt(IDEAS).id], 'home')
    expect(workspace.panes.count).toBe(1)
    expect(onScreen()).toEqual(['Plan.md'])
  })
})

describe('a tab moved to a Global space', () => {
  test('joins the shared set', async () => {
    await sets.choose('work', 'space')
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    await workspace.showSpace('work')
    const draft = blank('notes')

    await moveToSpace([draft.id], 'uni')
    expect(onScreen()).toEqual([])

    await workspace.showSpace('home')
    expect(onScreen()).toEqual(['Food.md', draft.name])
  })

  test('from another Global space, it stays on screen and only its space changes', async () => {
    const draft = blank('notes')
    const frame = workspace.panes.frame

    await moveToSpace([draft.id], 'home')
    expect(draft.note.home).toBe('home')
    expect(workspace.panes.frame).toBe(frame)
    expect(onScreen()).toEqual([draft.name])
  })
})

describe('what is never lost', () => {
  test('a file whose name is taken there stays, and so does its tab', async () => {
    files().set('/spaces/Home/Plan.md', '# Another plan\n')
    await sets.choose('work', 'space')
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'home')
    expect(files().get(PLAN)).toBe('# Plan\n')
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Another plan\n')
    expect(plan.path).toBe(PLAN)
    expect(onScreen()).toEqual(['Plan.md'])
  })

  test('words typed a moment before the move are in the file where it went', async () => {
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)
    plan.note.live.replace('# Plan\n\nfresh words')

    await moveToSpace([plan.id], 'home')
    await workspace.writeNow()
    expect(files().get('/spaces/Home/Plan.md')).toBe('# Plan\n\nfresh words')
  })

  test('the space it is in already is no move at all', async () => {
    await workspace.openEntry(PLAN)
    const plan = tabAt(PLAN)

    await moveToSpace([plan.id], 'work')
    expect(plan.path).toBe(PLAN)
    expect(files().has(PLAN)).toBe(true)
  })
})

describe('the session', () => {
  test('writes the tab under the space it went to', async () => {
    await sets.choose('work', 'space')
    const draft = blank('notes')

    await moveToSpace([draft.id], 'uni')
    workspace.persist()
    const written = localStorage.getItem('nib:workspace') ?? ''
    expect(written).toContain('"space":"uni"')
  })
})
