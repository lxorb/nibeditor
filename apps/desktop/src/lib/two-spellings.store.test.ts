import { beforeEach, describe, expect, test, vi } from 'vitest'

/** `Plan.md` and `plan.md` on a disk that calls them one file.
 *
 *  Windows and a Mac look a name up without its case, so a link, a caller or a sitting
 *  written down elsewhere can name a note in a spelling its listing does not have, and
 *  the disk answers it. Compared as written, that was a second note: a second document
 *  over the same file, whose writes replaced the first's, a second room, and a second
 *  row. It is one note, spelled the way the listing spells it; see space-paths.ts.
 *
 *  And a disk that tells case apart keeps them two, which is what Linux does. */

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
disk.current = new Disk(true)
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { answeredCase, samePath, within } = await import('./space-paths')

const ROOT = '/space'

/** Every path the list shows. */
function rows(): string[] {
  const out: string[] = []
  const walk = (one: { children: { path: string; children: unknown[] }[] }) => {
    for (const child of one.children) {
      out.push(child.path)
      walk(child as never)
    }
  }

  if (workspace.tree) walk(workspace.tree)
  return out
}

async function space(folds: boolean) {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folds = folds
  one.files.set(`${ROOT}/Plan.md`, '# Plan\n')
  answeredCase(ROOT, folds)

  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.panel = 'tree'
  await workspace.loadTree()
}

describe('on a disk that sets case aside', () => {
  beforeEach(() => space(true))

  test('opening Plan.md and plan.md is one document, in one room, on one row', async () => {
    await workspace.open(`${ROOT}/Plan.md`)
    await workspace.open(`${ROOT}/plan.md`)

    expect(workspace.documents).toHaveLength(1)
    expect(workspace.documents[0]?.path).toBe(`${ROOT}/Plan.md`)
    // A room is joined per open document; see `openNotes` and rooms.svelte.ts.
    expect(workspace.openNotes).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(1)

    workspace.touched(`${ROOT}/plan.md`)
    expect(rows()).toEqual([`${ROOT}/Plan.md`])
  })

  test('and asked for at once, in either order, still one', async () => {
    await Promise.all([workspace.open(`${ROOT}/plan.md`), workspace.open(`${ROOT}/PLAN.md`)])

    expect(workspace.documents).toHaveLength(1)
    expect(workspace.documentAt(`${ROOT}/pLaN.md`)?.path).toBe(`${ROOT}/Plan.md`)
  })

  test('a new note never takes a name the disk already has in another case', () => {
    expect(workspace.freeName(ROOT, 'plan.md')).toBe('plan 2.md')
  })

  test('and a name that only changes its case is still a rename', async () => {
    await workspace.rename(`${ROOT}/Plan.md`, 'plan.md')

    expect([...(disk.current?.files.keys() ?? [])]).toEqual([`${ROOT}/plan.md`])
  })
})

describe('on a disk that tells case apart', () => {
  beforeEach(() => space(false))

  test('they are two names, and one of them is nothing', async () => {
    await workspace.open(`${ROOT}/Plan.md`)
    await workspace.open(`${ROOT}/plan.md`)

    expect(workspace.documents.map((one) => one.path)).toEqual([`${ROOT}/Plan.md`])
    expect(workspace.freeName(ROOT, 'plan.md')).toBe('plan.md')
  })
})

describe('the one comparison', () => {
  test('sets the separator and the composition aside everywhere', () => {
    expect(samePath('C:\\Notes\\Plan.md', 'C:/Notes/Plan.md')).toBe(true)
    expect(samePath('/Notes/U\u0308bersicht.md', '/Notes/\u00dcbersicht.md')).toBe(true)
    expect(samePath('/Notes//Plan.md', '/Notes/Plan.md/')).toBe(true)
  })

  test('holds a folder a whole step at a time', () => {
    expect(within('/Notes/Work', '/Notes/Work/a.md')).toBe('a.md')
    expect(within('/Notes/Work', '/Notes/Workshop.md')).toBeNull()
    expect(within('/Notes/Work', '/Notes/Work')).toBe('')
  })
})
