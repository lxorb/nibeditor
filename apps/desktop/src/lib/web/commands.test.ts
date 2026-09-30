import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetRow, FileRow, SnapshotRow } from './store'

/** The browser's stand-in for the file commands, driven against a disk that
 *  lives in a Map rather than in IndexedDB. Node has no IndexedDB, and the
 *  point of these is the path arithmetic and the trash bookkeeping - not the
 *  database underneath, which `store.ts` is the only thing that touches. */

const disk = vi.hoisted(() => {
  const files = new Map<string, FileRow>()
  const assets = new Map<string, AssetRow>()
  const meta = new Map<string, string>()
  const snapshots: SnapshotRow[] = []
  /** Every stretch of the files read at once, as the rows it answered. */
  const reads: FileRow[][] = []
  /** Whether the listing says how long each file is, as a listing written since it
   *  kept sizes does, and the sizes a scan wrote back into it. */
  const sized = { yes: true }
  const learnt = new Map<string, number>()

  return { files, assets, meta, snapshots, reads, sized, learnt }
})

vi.mock('./store', () => ({
  KEEP: '.keep',
  files: {
    get: (path: string) => Promise.resolve(disk.files.get(path)),
    all: () => Promise.resolve([...disk.files.values()]),
    paths: () => Promise.resolve([...disk.files.keys()].sort()),
    each: (visit: (row: FileRow) => void) => {
      // In key order, which is what a cursor over the real store gives.
      for (const path of [...disk.files.keys()].sort()) visit(disk.files.get(path)!)
      return Promise.resolve()
    },
    between: (from: string, to: string) => {
      const rows = [...disk.files.keys()]
        .sort()
        .filter((path) => path >= from && path <= to)
        .map((path) => disk.files.get(path)!)
      disk.reads.push(rows)
      return Promise.resolve(rows)
    },
    put: (row: FileRow) => Promise.resolve(void disk.files.set(row.path, row)),
    remove: (path: string) => Promise.resolve(void disk.files.delete(path)),
    // The real one is a single transaction; here it is a single statement,
    // which is the same promise from the caller's side.
    move: (rows: FileRow[], gone: string[]) => {
      for (const row of rows) disk.files.set(row.path, row)
      for (const path of gone) {
        if (!rows.some((row) => row.path === path)) disk.files.delete(path)
      }
      return Promise.resolve()
    },
  },
  assets: {
    get: (path: string) => Promise.resolve(disk.assets.get(path)),
    all: () => Promise.resolve([...disk.assets.values()]),
    paths: () => Promise.resolve([...disk.assets.keys()].sort()),
    put: (row: AssetRow) => Promise.resolve(void disk.assets.set(row.path, row)),
    remove: (path: string) => Promise.resolve(void disk.assets.delete(path)),
  },
  // Derived from the two maps rather than kept beside them, which is the
  // invariant the real store pays a transaction to hold: a path's listing says
  // what the file at that path says, always.
  stats: {
    all: () =>
      Promise.resolve([
        ...[...disk.files.values()].map((row) => {
          const size = disk.sized.yes ? row.content.length : disk.learnt.get(row.path)
          return {
            path: row.path,
            modified: row.modified,
            created: row.created,
            ...(size === undefined ? {} : { size }),
          }
        }),
        ...[...disk.assets.values()].map((row) => ({
          path: row.path,
          modified: row.modified,
          created: row.modified,
          ...(disk.sized.yes ? { size: row.data.length } : {}),
        })),
      ]),
    learn: (found: { path: string; size: number }[]) => {
      for (const one of found) disk.learnt.set(one.path, one.size)
      return Promise.resolve()
    },
  },
  meta: {
    get: (key: string) => Promise.resolve(disk.meta.get(key)),
    put: (key: string, value: string) => Promise.resolve(void disk.meta.set(key, value)),
    remove: (key: string) => Promise.resolve(void disk.meta.delete(key)),
    keys: () => Promise.resolve([...disk.meta.keys()].sort()),
  },
  snapshots: {
    put: (row: SnapshotRow) => Promise.resolve(void disk.snapshots.push(row)),
    remove: (id: number) => Promise.resolve(void disk.snapshots.splice(id, 1)),
    forNote: (notePath: string) =>
      Promise.resolve(disk.snapshots.filter((one) => one.notePath === notePath)),
  },
}))

/** The page's own store, which is where "has this device been seeded" lives
 *  everywhere but inside a packed plugin. */
function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { SCANNED_AT_ONCE, seed, webInvoke } = await import('./commands')
const { stamped, stampOf } = await import('../themes/validate')
const { forgetSeedStore, rememberSeedIn } = await import('../seeded')
const { WELCOME, WELCOME_PATH } = await import('../welcome')

const write = (path: string, content = '') => webInvoke('write_note', { path, content })
const read = (path: string) => webInvoke<string>('read_note', { path })
const paths = () => [...disk.files.keys()].sort()

beforeEach(() => {
  disk.files.clear()
  disk.assets.clear()
  disk.meta.clear()
  disk.snapshots.length = 0
  disk.reads.length = 0
  disk.sized.yes = true
  disk.learnt.clear()
  localStorage.clear()
  forgetSeedStore()
})

describe('notes', () => {
  test('are written, read back and deleted', async () => {
    await write('/Notes/Idea.md', '# Idea')
    expect(await read('/Notes/Idea.md')).toBe('# Idea')

    await webInvoke('delete_note', { path: '/Notes/Idea.md' })
    await expect(read('/Notes/Idea.md')).rejects.toThrow()
  })

  test('keep the moment they were made across a rewrite', async () => {
    await write('/Notes/Idea.md', 'one')
    const made = disk.files.get('/Notes/Idea.md')?.created

    await write('/Notes/Idea.md', 'two')
    expect(disk.files.get('/Notes/Idea.md')?.created).toBe(made)
  })
})

describe('renaming', () => {
  test('takes everything under a folder along', async () => {
    await write('/Notes/Work/a.md', 'a')
    await write('/Notes/Work/deep/b.md', 'b')

    await webInvoke('rename_note', { from: '/Notes/Work', to: '/Notes/Done' })

    expect(paths()).toEqual(['/Notes/Done/a.md', '/Notes/Done/deep/b.md'])
    expect(await read('/Notes/Done/deep/b.md')).toBe('b')
  })

  test('refuses a name a note already has', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/b.md' }),
    ).rejects.toThrow()
    expect(await read('/Notes/b.md')).toBe('b')
  })

  /** A folder has no row of its own - it exists because something is in it -
   *  so asking about the exact path finds nothing and the rename went ahead,
   *  putting the note inside the folder under the folder's own name. */
  test('refuses a name a folder already has', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/Work/b.md', 'b')

    await expect(
      webInvoke('rename_note', { from: '/Notes/a.md', to: '/Notes/Work' }),
    ).rejects.toThrow()

    expect(paths()).toEqual(['/Notes/Work/b.md', '/Notes/a.md'])
  })

  test('refuses to rename something that is not there', async () => {
    await expect(
      webInvoke('rename_note', { from: '/Notes/gone.md', to: '/Notes/here.md' }),
    ).rejects.toThrow()
  })
})

describe('copying', () => {
  test('takes everything under a folder, both stores, and leaves the original', async () => {
    await write('/Notes/Trip/Trip.md', '# Trip')
    disk.assets.set('/Notes/Trip/map.png', {
      path: '/Notes/Trip/map.png',
      type: 'image/png',
      data: 'AQID',
      modified: 1,
    })

    await webInvoke('copy_path', { from: '/Notes/Trip', to: '/Notes/Trip copy' })

    expect(await read('/Notes/Trip copy/Trip.md')).toBe('# Trip')
    expect(await read('/Notes/Trip/Trip.md')).toBe('# Trip')
    expect(disk.assets.get('/Notes/Trip copy/map.png')?.data).toBe('AQID')
  })

  test("brings a PDF's highlights along", async () => {
    disk.assets.set('/Notes/paper.pdf', {
      path: '/Notes/paper.pdf',
      type: '',
      data: '',
      modified: 1,
    })
    await webInvoke('write_highlights', { path: '/Notes/paper.pdf', content: '{"version":1}' })

    await webInvoke('copy_path', { from: '/Notes/paper.pdf', to: '/Notes/paper copy.pdf' })

    expect(disk.assets.has('/Notes/paper copy.pdf')).toBe(true)
    expect(disk.files.get('/Notes/paper copy.pdf.highlights.json')?.content).toBe('{"version":1}')
  })

  test('never writes over anything, and never into itself', async () => {
    await write('/Notes/a.md', 'a')
    await write('/Notes/b.md', 'b')
    await write('/Notes/Work/c.md', 'c')

    await expect(
      webInvoke('copy_path', { from: '/Notes/a.md', to: '/Notes/b.md' }),
    ).rejects.toThrow()
    await expect(
      webInvoke('copy_path', { from: '/Notes/Work', to: '/Notes/Work/Work' }),
    ).rejects.toThrow()
    expect(await read('/Notes/b.md')).toBe('b')
  })
})

describe('spaces', () => {
  test('are the folders under the root, in order, dot folders left out', async () => {
    await write('/Work/a.md')
    await write('/Notes/b.md')
    await write('/.trash/1/c.md')

    expect(await webInvoke('list_spaces')).toEqual([
      { name: 'Notes', path: '/Notes' },
      { name: 'Work', path: '/Work' },
    ])
  })

  test('step their name rather than joining an existing one', async () => {
    expect(await webInvoke('create_space', { name: 'Notes' })).toEqual({
      name: 'Notes',
      path: '/Notes',
    })
    expect(await webInvoke('create_space', { name: 'Notes' })).toEqual({
      name: 'Notes 2',
      path: '/Notes 2',
    })
  })
})

describe('the trash', () => {
  test('holds what was deleted and puts it back where it came from', async () => {
    await write('/Notes/Idea.md', '# Idea')

    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    expect(paths()).toEqual([`/.trash/${entry.id}/Idea.md`])
    expect(await webInvoke('list_trash')).toMatchObject([{ kind: 'note', name: 'Idea.md' }])

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea.md')
    expect(await read('/Notes/Idea.md')).toBe('# Idea')
    expect(await webInvoke('list_trash')).toEqual([])
  })

  test('puts a note back beside the one that took its place', async () => {
    await write('/Notes/Idea.md', 'first')
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    await write('/Notes/Idea.md', 'second')

    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea 2.md')
    expect(await read('/Notes/Idea.md')).toBe('second')
    expect(await read('/Notes/Idea 2.md')).toBe('first')
  })

  test('says so when what it held is already gone', async () => {
    await write('/Notes/Idea.md', '# Idea')
    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    await webInvoke('purge_trash', { id: entry.id })
    await expect(webInvoke('restore_trash', { id: entry.id })).rejects.toThrow()
  })

  test('refuses to delete the root, or itself', async () => {
    await expect(webInvoke('trash_item', { path: '/', kind: 'space' })).rejects.toThrow()
    await expect(webInvoke('trash_item', { path: '/.trash', kind: 'space' })).rejects.toThrow()
  })

  test('reads a manifest nothing can be made of as an empty one', async () => {
    // The manifest is a string in the browser's own storage, written by some
    // version of this app and possibly by one interrupted halfway. Read as the
    // shape the code wants, a truncated entry is a crash on the way to Recently
    // deleted - and Recently deleted is where somebody goes to get a note back.
    for (const held of ['', 'not json', '{"id":"1"}', '42', 'null']) {
      disk.meta.set('trash', held)
      expect(await webInvoke('list_trash'), held).toEqual([])
    }

    // An entry that is not describable goes; the ones around it stay.
    disk.meta.set(
      'trash',
      JSON.stringify([
        { id: '1', kind: 'note', name: 'a.md', from: '/Notes/a.md', trashedAt: 1 },
        null,
        { id: '2', name: 'b.md' },
        { id: '3', kind: 'note', name: 'c.md', from: '/Notes/c.md', trashedAt: '3' },
      ]),
    )

    expect(await webInvoke<{ id: string }[]>('list_trash')).toEqual([
      { id: '1', kind: 'note', name: 'a.md', from: '/Notes/a.md', trashedAt: 1 },
    ])
  })

  test('writing to a manifest nothing can be made of does not lose the note', async () => {
    disk.meta.set('trash', 'not json')
    await write('/Notes/Idea.md', '# Idea')

    const entry = await webInvoke<{ id: string }>('trash_item', {
      path: '/Notes/Idea.md',
      kind: 'note',
    })

    expect(await webInvoke('list_trash')).toMatchObject([{ id: entry.id, name: 'Idea.md' }])
    expect(await webInvoke('restore_trash', { id: entry.id })).toBe('/Notes/Idea.md')
  })
})

describe('the tree', () => {
  test('holds folders before notes, and each sorted by name', async () => {
    await write('/Notes/b.md')
    await write('/Notes/a.md')
    await write('/Notes/Work/c.md')

    const tree = await webInvoke<{ children: { name: string; is_dir: boolean }[] }>('read_tree', {
      root: '/Notes',
    })

    expect(tree.children.map((one) => one.name)).toEqual(['Work', 'a.md', 'b.md'])
  })

  /** A page note is a file in a space like a canvas is, and the list of kinds the
   *  tree shows left it out: a page note was drawn in a tab and in nothing else -
   *  no row in the file list, nothing for a search to read, and nothing for the
   *  mirror to send, since the mirror walks this tree. */
  test('shows a page note, which is a file in the space like any other', async () => {
    await write('/Notes/Journal.pages')
    await write('/Notes/Board.canvas')
    await write('/Notes/a.md')

    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })

    expect(tree.children.map((one) => one.name)).toEqual(['a.md', 'Board.canvas', 'Journal.pages'])
  })

  test('keeps an empty folder alive through its marker, and shows no marker', async () => {
    await webInvoke('create_folder', { path: '/Notes/Empty' })

    const tree = await webInvoke<{ children: { name: string; children: unknown[] }[] }>(
      'read_tree',
      { root: '/Notes' },
    )

    expect(tree.children.map((one) => one.name)).toEqual(['Empty'])
    expect(tree.children[0]?.children).toEqual([])
  })

  test('leaves out hidden notes unless asked for them', async () => {
    await write('/Notes/.private.md')
    await write('/Notes/a.md')

    const shown = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })
    expect(shown.children.map((one) => one.name)).toEqual(['a.md'])

    const all = await webInvoke<{ children: { name: string }[] }>('read_tree', {
      root: '/Notes',
      options: { showHidden: true },
    })
    expect(all.children.map((one) => one.name)).toEqual(['.private.md', 'a.md'])
  })

  test('lists the PDFs beside the notes, and nothing else', async () => {
    await write('/Notes/a.md')
    disk.assets.set('/Notes/paper.pdf', {
      path: '/Notes/paper.pdf',
      type: 'application/pdf',
      data: '',
      modified: 1,
    })
    disk.assets.set('/Notes/shot.png', {
      path: '/Notes/shot.png',
      type: 'image/png',
      data: '',
      modified: 1,
    })
    await write('/Notes/paper.pdf.highlights.json', '{}')

    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root: '/Notes' })
    expect(tree.children.map((one) => one.name)).toEqual(['a.md', 'paper.pdf'])
  })
})

describe("a PDF's highlights", () => {
  const pdf = '/Notes/paper.pdf'
  const sidecar = '/Notes/paper.pdf.highlights.json'

  test('are written beside it and read back', async () => {
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })
    expect(disk.files.get(sidecar)?.content).toBe('{"version":1}')
    expect(await webInvoke<string>('read_highlights', { path: pdf })).toBe('{"version":1}')
  })

  test('read as nothing for a PDF nobody has marked', async () => {
    expect(await webInvoke<string>('read_highlights', { path: pdf })).toBe('')
  })

  test('take the file with them once the last one is gone', async () => {
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })
    await webInvoke('write_highlights', { path: pdf, content: '' })

    expect(disk.files.has(sidecar)).toBe(false)
  })

  test('follow the PDF when it moves, since a folder rename takes both stores', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('rename_note', { from: '/Notes', to: '/Reading' })

    expect(disk.assets.has('/Reading/paper.pdf')).toBe(true)
    expect(disk.files.has('/Reading/paper.pdf.highlights.json')).toBe(true)
  })

  test('go when the PDF goes', async () => {
    disk.assets.set(pdf, { path: pdf, type: 'application/pdf', data: '', modified: 1 })
    await webInvoke('write_highlights', { path: pdf, content: '{"version":1}' })

    await webInvoke('delete_note', { path: pdf })

    expect(disk.assets.has(pdf)).toBe(false)
    expect(disk.files.has(sidecar)).toBe(false)
  })

  test('belong to a PDF and to nothing else', async () => {
    await expect(webInvoke('read_highlights', { path: '/Notes/Idea.md' })).rejects.toThrow()
    await expect(
      webInvoke('write_highlights', { path: '/Notes/Idea.md', content: '{}' }),
    ).rejects.toThrow()
  })
})

describe('a pasted picture', () => {
  const save = (notePath: string, folder: string) =>
    webInvoke<string>('save_asset', { notePath, folder, name: 'pic.png', bytes: [1, 2, 3] })

  test('goes in the folder the window asked for and is named relative to the note', async () => {
    expect(await save('/Notes/Read me.md', 'assets')).toBe('assets/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/assets/pic.png'])
  })

  test('lands beside the note when no folder is named', async () => {
    expect(await save('/Notes/Read me.md', '')).toBe('pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/pic.png'])
  })

  test('climbs to the space’s own assets folder from a note further down', async () => {
    expect(await save('/Notes/Work/Plan.md', '../assets')).toBe('../assets/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/assets/pic.png'])
  })

  test('goes in a folder named after the note', async () => {
    expect(await save('/Notes/Read me.md', 'Read me')).toBe('Read me/pic.png')
    expect([...disk.assets.keys()]).toEqual(['/Notes/Read me/pic.png'])
  })

  test('refuses a folder that climbs out of the space', async () => {
    await expect(save('/Notes/Read me.md', '../../elsewhere')).rejects.toThrow()
    await expect(save('/Notes/Work/Plan.md', '../../Other/assets')).rejects.toThrow()
    expect([...disk.assets.keys()]).toEqual([])
  })

  test('keeps the folder an older build wrote when none is sent', async () => {
    const written = await webInvoke<string>('save_asset', {
      notePath: '/Notes/Read me.md',
      name: 'pic.png',
      bytes: [1],
    })

    expect(written).toBe('assets/pic.png')
  })
})

/** The store installs a theme by writing a file into a folder. In a browser the
 *  folder is a prefix in storage, which is what makes the gallery work in the web
 *  build as well as on a desktop. */
describe('installed themes', () => {
  test('an empty store holds none', async () => {
    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a written theme is listed, read back, and taken away again', async () => {
    const path = await webInvoke<string>('write_theme', {
      id: 'warm-paper',
      css: '/*! nib-theme */',
    })

    expect(await webInvoke('list_themes')).toEqual([
      { id: 'file:warm-paper', name: 'Warm paper', path },
    ])
    expect(await webInvoke('read_theme', { path })).toBe('/*! nib-theme */')

    await webInvoke('remove_theme', { id: 'warm-paper' })
    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a second write replaces the first, as a file would', async () => {
    await webInvoke('write_theme', { id: 'mono', css: 'one' })
    await webInvoke('write_theme', { id: 'mono', css: 'two' })

    expect(await webInvoke('list_themes')).toHaveLength(1)
    expect(await webInvoke('read_theme', { path: 'themes/mono.css' })).toBe('two')
  })

  test('an id that is not one never becomes a key', async () => {
    for (const id of ['../custom', 'Mono', 'a b', '']) {
      await expect(webInvoke('write_theme', { id, css: 'x' })).rejects.toThrow()
    }

    expect(await webInvoke('list_themes')).toEqual([])
  })

  test('a theme that is not there reads as nothing rather than throwing', async () => {
    expect(await webInvoke('read_theme', { path: 'themes/nothing.css' })).toBe('')
  })

  /** What the dropdown needs after the tab is closed and opened again: the theme
   *  is still there, and it still knows the name and the version the store gave
   *  it rather than one worked out from the key it lives under. */
  test('comes back with its stamp, which is what the dropdown reads its name from', async () => {
    const css = stamped({ id: 'rose', name: 'Rose', author: 'Nib', version: '2.0.0' }, ':root {}')
    await webInvoke('write_theme', { id: 'rose', css })

    const listed = await webInvoke<{ id: string; path: string }[]>('list_themes')
    expect(listed).toHaveLength(1)

    const read = await webInvoke<string>('read_theme', { path: listed[0]?.path ?? '' })
    expect(stampOf(read)).toEqual({ id: 'rose', name: 'Rose', author: 'Nib', version: '2.0.0' })
  })
})

describe('what the browser cannot do', () => {
  test('answers the shape that makes the app hide the feature', async () => {
    expect(await webInvoke('has_pandoc')).toBe(false)
    expect(await webInvoke('file_stamp', { path: '/Notes/Idea.md' })).toBeNull()
    expect(await webInvoke('theme_dir')).toBe('')
  })

  test('says so outright for a command nobody has stood in for', async () => {
    await expect(webInvoke('open_the_pod_bay_doors')).rejects.toThrow()
  })
})

/** The welcome note, once per device.
 *
 *  Emptiness is what is here now; it is not whether this device has been introduced,
 *  and reading it as though it were is how a reader who deleted every note gets the
 *  welcome note back - and, signed in, gets it in their account. See welcome.ts for
 *  what that did to Emil's. */
describe('the welcome note', () => {
  test('is written on a first visit', async () => {
    await seed()
    expect(await read(WELCOME_PATH)).toBe(WELCOME)
  })

  test('is not written twice, even with nothing left on the disk', async () => {
    await seed()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })

  test('is not written to a device that already had notes', async () => {
    await write('/Notes/Mine.md', 'my own')

    await seed()
    expect(paths()).toEqual(['/Notes/Mine.md'])
  })

  test('and that device is not seeded later either, once it is empty', async () => {
    await write('/Notes/Mine.md', 'my own')
    await seed()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })

  /** A packed plugin's page storage belongs to a port that never comes back, so the
   *  answer has to live somewhere that outlives a launch; the plugin hands one over.
   *  See seeded.ts. */
  test('asks the store that survives a launch, where there is one', async () => {
    let kept = false
    rememberSeedIn({
      read: () => Promise.resolve(kept),
      write: () => {
        kept = true
        return Promise.resolve()
      },
    })

    await seed()
    expect(kept).toBe(true)

    // A new launch: the page's own storage is somebody else's and the disk is empty.
    localStorage.clear()
    disk.files.clear()

    await seed()
    expect(paths()).toEqual([])
  })
})

describe('reading a whole space for the link index', () => {
  /** More notes than one chunk of the scan holds, so the pass is read in several
   *  and the answer still has to be the whole space in one order. */
  const MANY = 150

  test('answers every note in the space, in path order, however many chunks it took', async () => {
    for (let at = 0; at < MANY; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\nsee [[note-000]]\n`)
    }

    const found = await webInvoke<{
      notes: { path: string; links: unknown[] }[]
      files: string[]
    }>('scan_links', { root: '/Notes' })

    expect(found.notes).toHaveLength(MANY)
    expect(found.notes[0]?.path).toBe('note-000.md')
    expect(found.notes.at(-1)?.path).toBe(`note-${String(MANY - 1).padStart(3, '0')}.md`)
    // The links were read, which is the whole point of having read the bodies.
    expect(found.notes[5]?.links).toHaveLength(1)
  })

  test('leaves out the scaffolding and keeps the files beside the notes', async () => {
    await write('/Notes/Idea.md', '# idea')
    await write('/Notes/Deep/.keep', '')
    await write('/Notes/paper.pdf.highlights.json', '{}')
    await webInvoke('save_asset', {
      notePath: '/Notes/Idea.md',
      folder: 'pictures',
      name: 'shot.png',
      bytes: [1, 2, 3],
    })

    const found = await webInvoke<{ notes: { path: string }[]; files: string[] }>('scan_links', {
      root: '/Notes',
    })

    expect(found.notes.map((one) => one.path)).toEqual(['Idea.md'])
    // The picture, and neither the marker that keeps a folder nor the highlights
    // that are part of a paper.
    expect(found.files).toEqual(['pictures/shot.png'])
  })

  /** What a chunk read costs is what its notes are long, not how many there are:
   *  128 notes a chunk put a canvas of seven megabytes in one task with the notes
   *  beside it. So what is counted is the characters each read handed back. */
  test('reads a chunk of about the same length at a time, and a long file on its own', async () => {
    const page = 'the wind was steady and the ink took its time. '.repeat(90)
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\n${page}`)
    }
    const plane = JSON.stringify({ nodes: [], nib: { ink: [], padding: 'x'.repeat(3_000_000) } })
    await write('/Notes/note-150.canvas', plane)

    await webInvoke('scan_links', { root: '/Notes' })

    const lengths = disk.reads.map((rows) => rows.reduce((sum, row) => sum + row.content.length, 0))
    for (const [at, rows] of disk.reads.entries()) {
      if (rows.length > 1) expect(lengths[at]).toBeLessThanOrEqual(SCANNED_AT_ONCE)
    }

    // The plane, alone: nothing waits behind it and it waits behind nothing.
    const alone = disk.reads.find((rows) => rows.some((row) => row.path.endsWith('.canvas')))
    expect(alone?.map((row) => row.path)).toEqual(['/Notes/note-150.canvas'])
    // And every file was read exactly once.
    expect(disk.reads.flat()).toHaveLength(301)
  })

  test('a listing that does not know how long its files are is read as it always was', async () => {
    disk.sized.yes = false
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}`)
    }

    await webInvoke('scan_links', { root: '/Notes' })

    expect(disk.reads.map((rows) => rows.length)).toEqual([128, 128, 44])
  })

  test('and learns them as it reads, so the next scan is read by length', async () => {
    disk.sized.yes = false
    const page = 'the wind was steady and the ink took its time. '.repeat(90)
    for (let at = 0; at < 300; at++) {
      await write(`/Notes/note-${String(at).padStart(3, '0')}.md`, `# ${at}\n\n${page}`)
    }

    await webInvoke('scan_links', { root: '/Notes' })
    expect(disk.learnt.size).toBe(300)

    disk.reads.length = 0
    await webInvoke('scan_links', { root: '/Notes' })
    const lengths = disk.reads.map((rows) => rows.reduce((all, row) => all + row.content.length, 0))
    for (const length of lengths) expect(length).toBeLessThanOrEqual(SCANNED_AT_ONCE)
  })

  test('a space nothing is in answers nothing', async () => {
    await write('/Other/Idea.md', '# elsewhere')

    const found = await webInvoke<{ notes: unknown[]; files: string[] }>('scan_links', {
      root: '/Notes',
    })

    expect(found).toEqual({ notes: [], files: [] })
  })
})
