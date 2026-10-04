import { beforeEach, describe, expect, test, vi } from 'vitest'

const sent: unknown[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push([command, args])
    return Promise.resolve()
  },
}))

/** A window whose early script asked, as src/early.ts does, and was answered with
 *  what the crate read. */
function arrived(answer: unknown) {
  vi.stubGlobal('window', { nibEarly: Promise.resolve(answer) })
}

const ROOT = 'C:\\Nib\\Work'
const TREE = { name: 'Work', path: ROOT, is_dir: true, modified: 0, created: 0, children: [] }

const READ = {
  plan: { root: ROOT, options: { showHidden: false }, notes: [`${ROOT}\\Plan.md`], web: false },
  spaces: [{ name: 'Work', path: ROOT }],
  tree: TREE,
  notes: { [`${ROOT}\\Plan.md`]: '# Plan' },
}

/** The module afresh, since what it received is kept for the launch. */
async function fresh() {
  vi.resetModules()
  return import('./ahead')
}

beforeEach(() => {
  sent.length = 0
  vi.unstubAllGlobals()
})

describe('what was read ahead', () => {
  test('goes to the question it answers, once', async () => {
    arrived(READ)
    const ahead = await fresh()

    expect(await ahead.spacesAhead()).toEqual(READ.spaces)
    expect(await ahead.spacesAhead()).toBeNull()

    expect(await ahead.treeAhead(ROOT, { showHidden: false })).toEqual(TREE)
    expect(await ahead.treeAhead(ROOT, { showHidden: false })).toBeNull()

    expect(await ahead.noteAheadPeek(`${ROOT}\\Plan.md`)).toBe('# Plan')
    expect(await ahead.noteAhead(`${ROOT}\\Plan.md`)).toBe('# Plan')
    expect(await ahead.noteAhead(`${ROOT}\\Plan.md`)).toBeNull()
  })

  test('and to no other: another space, other options, another note', async () => {
    arrived(READ)
    const ahead = await fresh()

    expect(await ahead.treeAhead('C:\\Nib\\Home', { showHidden: false })).toBeNull()
    expect(await ahead.treeAhead(ROOT, { showHidden: true })).toBeNull()
    expect(await ahead.noteAhead(`${ROOT}\\Other.md`)).toBeNull()
    // Still there for the question it does answer.
    expect(await ahead.treeAhead(ROOT, { showHidden: false })).toEqual(TREE)
  })

  test('is let go of once the launch is past its reads', async () => {
    arrived(READ)
    const ahead = await fresh()

    ahead.forgetAhead()
    await Promise.resolve()
    await Promise.resolve()
    expect(await ahead.treeAhead(ROOT, { showHidden: false })).toBeNull()
    expect(await ahead.noteAhead(`${ROOT}\\Plan.md`)).toBeNull()
  })

  test('is nothing where nothing was asked, or the answer is not one', async () => {
    vi.stubGlobal('window', {})
    const none = await fresh()
    expect(await none.spacesAhead()).toBeNull()

    arrived({ something: 'else' })
    const odd = await fresh()
    expect(await odd.treeAhead(ROOT, { showHidden: false })).toBeNull()
  })
})

describe('what the next launch asks for first', () => {
  test('is written down when it changes, and only then', async () => {
    arrived(null)
    const ahead = await fresh()
    const plan = {
      root: ROOT,
      options: { showHidden: false },
      notes: [`${ROOT}\\Plan.md`],
      web: false,
    }

    ahead.plan(plan)
    ahead.plan({ ...plan, notes: [...plan.notes] })
    ahead.plan({ ...plan, root: 'C:\\Nib\\Home' })

    expect(sent).toEqual([
      ['remember_launch', { plan }],
      ['remember_launch', { plan: { ...plan, root: 'C:\\Nib\\Home' } }],
    ])
  })
})
