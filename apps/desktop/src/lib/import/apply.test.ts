import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ImportPlan, Planned } from './plan'

/** Every write the import made: the command and the path it was handed. The
 *  point of the last two tests is that this stays empty. */
const wrote: { command: string; path: string }[] = []

/** A path the disk refuses, for the import that fails partway. */
let refusing: string | null = null

/** What the import handed the undo stack. */
const recorded: unknown[] = []

/** What each note was written as. */
const said = new Map<string, string>()

/** What is on the disk already, which the file list may not show: a picture, a file
 *  in a hidden folder, a file of a space that is not the one open. */
const onDisk = new Set<string>()

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'file_stamp') {
      return Promise.resolve(onDisk.has(String(args.path)) ? { modified: 1, len: 1 } : null)
    }
    if (args.path === refusing) return Promise.reject(new Error('the disk is full'))
    if (command === 'write_note') said.set(String(args.path), String(args.content))
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
  onDisk.clear()
  said.clear()
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

  test('a picture a vault embeds by its name follows it, its size and all', () => {
    const taken = new Set(['brain/photo.png', 'brain/home.md'])
    const stamped = restamped(
      planOf([note('Home.md', 'Look: ![[photo.png]] and ![[photo.png|300]]\n'), file('photo.png')]),
      taken,
      'Brain',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['Brain/Home 2.md', 'Brain/photo 2.png'])
    expect(textAt(stamped.files, 'Brain/Home 2.md')).toBe(
      'Look: ![[photo 2.png]] and ![[photo 2.png|300]]\n',
    )
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

  test('a link written as an example in code stays as it was written', () => {
    const guide = 'Type `[[Plan]]` to link, or [[Plan]].\n\n```\n[[Plan]] and ![](shot.png)\n```\n'
    const stamped = restamped(
      planOf([note('Guide.md', guide), note('Plan.md', '# Plan'), file('shot.png')]),
      new Set(['plan.md', 'shot.png']),
      '',
    )

    expect(textAt(stamped.files, 'Guide.md')).toBe(
      'Type `[[Plan]]` to link, or [[Plan 2]].\n\n```\n[[Plan]] and ![](shot.png)\n```\n',
    )
  })

  test('a canvas card follows the note it shows', () => {
    const board = '{"nodes":[{"id":"a","type":"file","file":"Plan.md"}],"edges":[]}'
    const stamped = restamped(
      planOf([
        note('Plan.md', '# Plan'),
        { kind: 'file', path: 'Board.canvas', bytes: new TextEncoder().encode(board) },
      ]),
      new Set(['plan.md']),
      '',
    )
    const canvas = stamped.files.find((one) => one.path === 'Board.canvas')

    expect(canvas?.kind === 'file' && new TextDecoder().decode(canvas.bytes)).toBe(
      board.replace('Plan.md', 'Plan 2.md'),
    )
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

  test('counts as taken however its accents are composed', () => {
    const decomposed = 'Cafe\u0301.md'
    const stamped = restamped(planOf([note(decomposed, 'x')]), new Set(['caf\u00e9.md']), '')

    expect(stamped.files[0]?.path).toBe('Cafe\u0301 2.md')
  })
})

/** A vault read and then landed in the folder `Inbox` of a space that already holds
 *  `taken`. */
async function vaultLanded(taken: string[], ...files: [string, string?][]): Promise<Planned[]> {
  const { readAs } = await import('./read')
  const { sourceOf } = await import('./sources')
  const sources = [['.obsidian/app.json', '{}'] as const, ...files].map(([path, body]) =>
    sourceOf(path, new TextEncoder().encode(body ?? 'x')),
  )
  return restamped(await readAs('obsidian', sources), new Set(taken), 'Inbox').files
}

describe('a vault landed beside notes of the same name', () => {
  test('keeps a link to the root Plan on it when only Projects/Plan steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/projects/plan.md'],
      ['Plan.md', '# The root plan'],
      ['Projects/Plan.md', '# The project plan'],
      ['Home.md', 'Start with [[Plan]].'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Projects/Plan 2.md')
    expect(textAt(files, 'Inbox/Home.md')).toBe('Start with [[Plan]].\n')
  })

  test('has a link that names the folder follow its note when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/projects/plan.md'],
      ['Plan.md', '# The root plan'],
      ['Projects/Plan.md', '# The project plan'],
      ['Home.md', 'See [[Projects/Plan]].'],
    )

    expect(textAt(files, 'Inbox/Home.md')).toBe('See [[Projects/Plan 2]].\n')
  })

  test('has a link written in another case follow its note, in the case it was written', async () => {
    const files = await vaultLanded(
      ['inbox/kit.md'],
      ['Kit.md', '# Kit'],
      ['Trip.md', 'Pack the [[kit]].'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Kit 2.md')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('Pack the [[kit 2]].\n')
  })

  test('has a link with words in a table follow its note when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/kit.md'],
      ['Kit.md', '# Kit'],
      ['Trip.md', '| What | Where |\n| --- | --- |\n| [[Kit\\|the kit]] | hall |\n'],
    )

    expect(textAt(files, 'Inbox/Trip.md')).toBe(
      '| What | Where |\n| --- | --- |\n| [[Kit 2\\|the kit]] | hall |\n',
    )
  })

  test('has a markdown link to a picture follow it with its title kept', async () => {
    const files = await vaultLanded(
      ['inbox/shot.png'],
      ['shot.png'],
      ['Trip.md', '![](shot.png "The view")'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/shot 2.png')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('![](shot%202.png "The view")\n')
  })

  test('has a markdown link to a page of a PDF follow it with the page kept', async () => {
    const files = await vaultLanded(
      ['inbox/paper.pdf'],
      ['Paper.pdf'],
      ['Trip.md', 'Read [page 3](Paper.pdf#page=3).'],
    )

    expect(textAt(files, 'Inbox/Trip.md')).toBe('Read [page 3](Paper%202.pdf#page=3).\n')
  })

  test('has a picture whose name holds brackets follow it when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/screenshot (1).png'],
      ['Screenshot (1).png'],
      ['Trip.md', '![](Screenshot%20(1).png)'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Screenshot (1) 2.png')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('![](Screenshot%20%281%29%202.png)\n')
  })
})

describe('an import into a space that already holds an earlier copy', () => {
  test('does not write over a picture the file list does not show', async () => {
    // A picture is not in the file list, which lists only what a tab can hold.
    onDisk.add('/Space/Brain/photo.png')
    onDisk.add('/Space/Brain/.obsidian/app.json')
    const landed = await applyImport(
      planOf([
        note('Home.md', 'Look: ![[photo.png]]\n'),
        file('photo.png'),
        file('.obsidian/app.json'),
      ]),
      { root: '/Space', folder: 'Brain' },
    )

    expect(landed.paths).toEqual([
      '/Space/Brain/Home.md',
      '/Space/Brain/photo 2.png',
      '/Space/Brain/.obsidian/app 2.json',
    ])
    expect(landed.stepped).toBe(2)
  })

  test('has the note follow the picture that stepped aside', async () => {
    onDisk.add('/Space/Brain/photo.png')
    await applyImport(planOf([note('Home.md', 'Look: ![[photo.png]]\n'), file('photo.png')]), {
      root: '/Space',
      folder: 'Brain',
    })

    expect(said.get('/Space/Brain/Home.md')).toBe('Look: ![[photo 2.png]]\n')
    expect(wrote.map((one) => one.path)).not.toContain('/Space/Brain/photo.png')
  })

  test('does not write over notes of a space that is not the one open', async () => {
    // The file list is the open space's; this one is only on the disk.
    onDisk.add('/Other/Brain/Home.md')
    onDisk.add('/Other/Brain/Home 2.md')
    const landed = await applyImport(planOf([note('Home.md', '# Home, the new copy\n')]), {
      root: '/Other',
      folder: 'Brain',
    })

    expect(landed.paths).toEqual(['/Other/Brain/Home 3.md'])
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
