import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ImportPlan, Planned } from './plan'

/** Every write the import made: the command and the path it was handed. The
 *  point of the last two tests is that this stays empty. */
const wrote: { command: string; path: string }[] = []

/** A path the disk refuses, for the import that fails partway. */
let refusing: string | null = null

/** What the import handed the undo stack. */
const recorded: unknown[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (args.path === refusing) return Promise.reject(new Error('the disk is full'))
    wrote.push({ command, path: String(args.path) })
    return Promise.resolve()
  },
  // Enough of the real one for a test; which separator a platform writes is not
  // what any of this is about.
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    files: [],
    undone: { record: (action: unknown) => void recorded.push(action) },
    loadTree: () => Promise.resolve(),
  },
}))

/** What the link index was told, in order. */
const heard: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void heard.push(`saved ${path}`),
    cameBack: (path: string) => void heard.push(`came back ${path}`),
  },
}))
vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

const { applyImport, restamped } = await import('./apply')

beforeEach(() => {
  wrote.length = 0
  heard.length = 0
  recorded.length = 0
  refusing = null
})

function planOf(files: Planned[]): ImportPlan {
  return { format: 'markdown', files, lost: [] }
}

function note(path: string, text: string): Planned {
  return { kind: 'note', path, text }
}

function file(path: string): Planned {
  return { kind: 'file', path, bytes: Uint8Array.from([1]) }
}

function textAt(files: readonly Planned[], path: string): string {
  const found = files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('where an import lands', () => {
  test('is inside the folder it was given', () => {
    const stamped = restamped(planOf([note('A.md', '# A'), file('assets/x.png')]), new Set(), 'In')

    expect(stamped.files.map((one) => one.path)).toEqual(['In/A.md', 'In/assets/x.png'])
    expect(stamped.stepped).toBe(0)
  })

  test('is the space itself when no folder was named', () => {
    const stamped = restamped(planOf([note('A.md', '# A')]), new Set(), '')

    expect(stamped.files[0]?.path).toBe('A.md')
  })
})

describe('a name that is already taken', () => {
  test('steps aside rather than writing over what is there', () => {
    const taken = new Set(['a.md'])
    const stamped = restamped(planOf([note('A.md', '# A')]), taken, '')

    expect(stamped.files[0]?.path).toBe('A 2.md')
    expect(stamped.stepped).toBe(1)
  })

  test('and the links inside the import follow it', () => {
    const taken = new Set(['kit.md'])
    const stamped = restamped(
      planOf([note('Trip.md', 'See [[Kit]] and [[Kit|the kit]].'), note('Kit.md', '# Kit')]),
      taken,
      '',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['Trip.md', 'Kit 2.md'])
    expect(textAt(stamped.files, 'Trip.md')).toBe('See [[Kit 2]] and [[Kit 2|the kit]].')
  })

  test('a picture that steps aside is still the picture the note shows', () => {
    const taken = new Set(['assets/shot.png'])
    const stamped = restamped(
      planOf([note('Trip.md', '![](assets/shot.png)'), file('assets/shot.png')]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Trip.md')).toBe('![](assets/shot%202.png)')
  })

  test('a link from a note in a folder follows it too', () => {
    const taken = new Set(['assets/shot.png'])
    const stamped = restamped(
      planOf([note('Deep/Trip.md', '![](../assets/shot.png)'), file('assets/shot.png')]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Deep/Trip.md')).toBe('![](../assets/shot%202.png)')
  })

  test('two of the import1s own notes cannot land on one name', () => {
    const taken = new Set(['a.md', 'a 2.md'])
    const stamped = restamped(planOf([note('A.md', 'one'), note('A.md', 'two')]), taken, '')

    expect(stamped.files.map((one) => one.path)).toEqual(['A 3.md', 'A 4.md'])
  })

  test('counts as taken whatever the case of the name', () => {
    const stamped = restamped(planOf([note('Plan.md', 'x')]), new Set(['PLAN.MD']), '')

    expect(stamped.files[0]?.path).toBe('Plan 2.md')
  })
})

/** The write site judges what it is about to write, whatever the reader handed
 *  it. Every format reader puts each part of a name through `safeName`, so a path
 *  that climbs out of the space means a reader forwarded a zip entry's own name -
 *  a bug, and one nothing further along would have caught. */
describe('a path no space would take', () => {
  const target = { root: '/Work', folder: '' }

  test('is refused before a single file is written, when it climbs out', async () => {
    const plan = planOf([note('Plan.md', '# Plan'), note('../../outside.md', '# not yours')])

    await expect(applyImport(plan, target)).rejects.toThrow(/outside the space/)
    expect(wrote).toEqual([])
  })

  test('and when it names a disk of its own', async () => {
    const plan = planOf([file('C:/Windows/System32/drivers/etc/hosts')])

    await expect(applyImport(plan, target)).rejects.toThrow(/outside the space/)
    expect(wrote).toEqual([])
  })

  test('while an import of ordinary names writes every one of them', async () => {
    const landed = await applyImport(planOf([note('Plan.md', '# Plan'), file('assets/x.png')]), {
      root: '/Work',
      folder: 'In',
    })

    expect(wrote).toEqual([
      { command: 'write_note', path: '/Work/In/Plan.md' },
      { command: 'write_bytes', path: '/Work/In/assets/x.png' },
    ])
    expect(landed.paths).toEqual(['/Work/In/Plan.md', '/Work/In/assets/x.png'])
  })

  test('and tells the link index about each of them, a picture as much as a note', async () => {
    await applyImport(planOf([note('Plan.md', '# Plan'), file('assets/x.png')]), {
      root: '/Work',
      folder: '',
    })

    expect(heard).toEqual(['saved /Work/Plan.md', 'came back /Work/assets/x.png'])
  })
})

describe('an import that fails partway', () => {
  /** A full disk on the third of three files. The sheet says it failed; what
   *  had already landed used to be on the disk with no undo that could take it
   *  back. */
  test('is still one thing to undo for what it wrote', async () => {
    refusing = '/Space/C.md'

    await expect(
      applyImport(planOf([note('A.md', 'a'), note('B.md', 'b'), note('C.md', 'c')]), {
        root: '/Space',
        folder: '',
      }),
    ).rejects.toThrow('the disk is full')

    expect(recorded).toEqual([{ kind: 'import', paths: ['/Space/A.md', '/Space/B.md'] }])
  })
})
