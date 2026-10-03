import { describe, expect, test } from 'vitest'
import type { Row } from '@nib/bases'
import { scanNote, type ScannedNote, type SpaceLinks } from '../scan-note'
import { scanRows } from '../scan-rows'
import { type Host, type RowsChange, RowsStore } from './store'

/** The rows of every space, driven by a stand-in for the app: disks of words, a link
 *  index of the open space, and the file operations told by hand. */

const WORK = '/spaces/Work'
const HOME = '/spaces/Home'

/** A note as `scan_links` reads one, rows' fields and all. */
function scanned(path: string, content: string): ScannedNote {
  return {
    ...scanNote(path, content),
    ...scanRows(content),
    stamp: { size: content.length, mtime: 1, ctime: 1 },
  }
}

interface Rig {
  store: RowsStore
  disk: Map<string, string>
  heard: RowsChange[]
  /** Lets the next scan of a root answer. */
  answer: (root: string) => void
  /** Settles everything in the air. */
  settled: () => Promise<void>
}

/** A store over disks of notes, by absolute path. The open space is `open`, whose
 *  notes the link index already holds; every other space waits on `answer`. */
function rig(disk: Record<string, string>, open: string | null = null): Rig {
  const files = new Map(Object.entries(disk))
  const waiting = new Map<string, () => void>()
  const notesOf = (root: string) =>
    [...files]
      .filter(([path]) => path.startsWith(`${root}/`))
      .map(([path, text]) => scanned(path.slice(root.length + 1), text))

  const host: Host = {
    // A whole space answers when the test says; a folder of one at once.
    scan: (root) =>
      new Promise<SpaceLinks>((go) => {
        const answer = () => go({ notes: notesOf(root), files: [] })
        if ([WORK, HOME].includes(root)) waiting.set(root, answer)
        else answer()
      }),
    read: (path) => Promise.resolve(files.get(path) ?? null),
    open: () => ({
      root: open,
      scanned: () => Promise.resolve(),
      notes: () => (open ? notesOf(open) : []),
    }),
    breathe: () => Promise.resolve(),
    now: () => 42,
  }

  const store = new RowsStore(host)
  const heard: RowsChange[] = []
  store.watch((change) => heard.push(change))

  const settled = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  }

  return {
    store,
    disk: files,
    heard,
    answer: (root) => {
      waiting.get(root)?.()
      waiting.delete(root)
    },
    settled,
  }
}

const tasks = (rows: readonly Row[]) =>
  rows
    .filter((row) => row.kind === 'task')
    .map((row) => `${row.space}:${row.path}:${row.task?.text}`)

describe('the rows of every space', () => {
  test("the open space's rows are the link index's scan, and the others are read after", async () => {
    const { store, answer, settled } = rig(
      {
        [`${WORK}/Plan.md`]: '- [ ] Ship it 📅 2026-10-06\n',
        [`${HOME}/Errands.md`]: '# Kitchen\n- [ ] Descale\n',
      },
      WORK,
    )

    store.spacesAre([
      { root: WORK, name: 'Work' },
      { root: HOME, name: 'Home' },
    ])
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Ship it'])
    expect(store.ready).toBe(false)

    answer(HOME)
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Ship it', 'Home:Errands.md:Descale'])
    expect(store.of('Home')[1]?.task?.section).toEqual(['Kitchen'])
    expect(store.of(HOME)).toBe(store.of(HOME))
    expect(store.ready).toBe(true)
  })

  test('a note saved is read again from what was written, and said once', async () => {
    const { store, heard, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] One\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    heard.length = 0

    store.saved(`${WORK}/Plan.md`, '---\nstatus: open\n---\n- [x] One\n- [ ] Two\n')

    expect(tasks(store.of())).toEqual(['Work:Plan.md:One', 'Work:Plan.md:Two'])
    expect(store.of()[0]?.note).toEqual({ status: 'open' })
    expect(store.of()[1]?.task?.done).toBe(true)
    expect(store.of()[1]?.anchor?.line).toBe(3)
    expect(heard).toHaveLength(1)
    expect(heard[0]?.path).toBe('Plan.md')
    expect(heard[0]?.removed).toHaveLength(2)
    expect(heard[0]?.added).toHaveLength(3)
    // Its creation time is kept; what it was written at is now.
    expect(store.of()[0]?.file.ctime).toBe(1)
    expect(store.of()[0]?.file.mtime).toBe(42)
  })

  test('a note made, moved into a folder and removed takes its rows each way', async () => {
    const { store, disk, settled } = rig({}, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    disk.set(`${WORK}/New.md`, '- [ ] Fresh\n')
    await store.follow({ op: 'created', path: `${WORK}/New.md`, kind: 'file', root: WORK })
    expect(tasks(store.of())).toEqual(['Work:New.md:Fresh'])

    void store.follow({
      op: 'moved',
      from: `${WORK}/New.md`,
      to: `${WORK}/Done/Old.md`,
      kind: 'file',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Work:Done/Old.md:Fresh'])
    expect(store.of()[0]?.file).toMatchObject({ name: 'Old.md', basename: 'Old', folder: 'Done' })

    void store.follow({
      op: 'moved',
      from: `${WORK}/Done`,
      to: `${WORK}/Archive`,
      kind: 'folder',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Work:Archive/Old.md:Fresh'])

    void store.follow({ op: 'removed', path: `${WORK}/Archive`, kind: 'folder', root: WORK })
    expect(store.of()).toEqual([])
  })

  test("a note moved to another space is that space's now", async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Go\n' }, WORK)
    store.spacesAre([
      { root: WORK, name: 'Work' },
      { root: HOME, name: 'Home' },
    ])
    await settled()
    answer(HOME)
    await settled()

    void store.follow({
      op: 'moved',
      from: `${WORK}/Plan.md`,
      to: `${HOME}/Plan.md`,
      kind: 'file',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Home:Plan.md:Go'])
    const [, moved] = store.of()
    expect(moved && store.rootOf(moved)).toBe(HOME)
  })

  test('what happens while a space is being read is done again over what it brings back', async () => {
    const { store, disk, answer, settled } = rig({
      [`${HOME}/Kept.md`]: '- [ ] Kept\n',
      [`${HOME}/Gone.md`]: '- [ ] Gone\n',
      [`${HOME}/Old/Moved.md`]: '- [ ] Moved\n',
    })
    store.spacesAre([{ root: HOME, name: 'Home' }])
    await settled()

    // The read is in the air: a note saved, one deleted, one moved.
    store.saved(`${HOME}/Kept.md`, '- [x] Kept\n')
    void store.follow({ op: 'removed', path: `${HOME}/Gone.md`, kind: 'file', root: HOME })
    disk.delete(`${HOME}/Old/Moved.md`)
    disk.set(`${HOME}/New/Moved.md`, '- [ ] Moved\n')
    await store.follow({
      op: 'moved',
      from: `${HOME}/Old`,
      to: `${HOME}/New`,
      kind: 'folder',
      root: HOME,
    })
    // The scan read the disk before the moves.
    disk.set(`${HOME}/Gone.md`, '- [ ] Gone\n')
    disk.set(`${HOME}/Old/Moved.md`, '- [ ] Moved\n')
    disk.delete(`${HOME}/New/Moved.md`)

    answer(HOME)
    await settled()
    expect(tasks(store.of()).sort()).toEqual(['Home:Kept.md:Kept', 'Home:New/Moved.md:Moved'])
    expect(
      store.of().find((row) => row.path === 'Kept.md' && row.kind === 'task')?.task?.done,
    ).toBe(true)
  })

  test('a space renamed keeps its rows under its new name, and one gone takes them', async () => {
    const { store, heard, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Go\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    store.spacesAre([{ root: WORK, name: 'Job' }])
    expect(tasks(store.of())).toEqual(['Job:Plan.md:Go'])
    expect(heard.at(-1)?.path).toBeNull()

    void store.follow({ op: 'moved', from: WORK, to: '/spaces/Job', kind: 'space', root: null })
    expect(store.at('/spaces/Job/Plan.md')).toHaveLength(2)

    store.spacesAre([])
    expect(store.of()).toEqual([])
    expect(heard.at(-1)?.removed).toHaveLength(2)
  })

  test('a sub-task knows its parent, and a heading ends the run', async () => {
    const { store, settled } = rig(
      { [`${WORK}/Plan.md`]: '- [ ] A\n  - [ ] B\n    - [ ] C\n  - [ ] D\n## Next\n  - [ ] E\n' },
      WORK,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    const parents = store
      .of()
      .filter((row) => row.task)
      .map((row) => [row.task?.text, row.task?.parent])
    expect(parents).toEqual([
      ['A', undefined],
      ['B', 0],
      ['C', 1],
      ['D', 0],
      ['E', undefined],
    ])
  })

  test('a note the index read again without its rows is read once more', async () => {
    const files = { [`${WORK}/Plan.md`]: '- [ ] Saved since\n' }
    const { store, settled } = rig(files, WORK)
    // The index's copy of a note saved after its scan carries no rows' fields.
    const host = (store as unknown as { host: Host }).host
    const open = host.open.bind(host)
    host.open = () => ({ ...open(), notes: () => [scanNote('Plan.md', '- [ ] Saved since\n')] })

    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Saved since'])
  })
})
