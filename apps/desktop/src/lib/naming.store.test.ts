import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Naming a row, through the store that owns the tree.
 *
 *  What a name may be is naming.test.ts, which is pure. This is the other half:
 *  that making a note, a canvas or a folder puts a row in the list and writes
 *  nothing until that row has a name, that leaving the row empty makes nothing at
 *  all, that a rename in flight survives the listing sync brings and goes when
 *  the file does. The disk is a map, so what was written is a list of paths.
 *
 *  The store reads storage and the platform shim the moment it is made, so both
 *  are stood in for before it is imported. */

/** The disk: what is on it, and what the store asked of it. */
const files = new Map<string, string>()
const folders = new Set<string>()
const sent: string[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

function entry(path: string, isFolder: boolean): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: isFolder,
    modified: 0,
    created: 0,
    children: [],
  }
}

/** The listing, built from the paths on the disk the way the crate builds it from
 *  a folder: folders first, then names in order. */
function listing(root: string): Entry {
  const tree = entry(root, true)
  const at = new Map<string, Entry>([[root, tree]])

  const folderFor = (path: string): Entry => {
    const found = at.get(path)
    if (found) return found

    const made = entry(path, true)
    at.set(path, made)
    folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(made)
    return made
  }

  for (const path of [...folders].sort()) if (path.startsWith(`${root}/`)) folderFor(path)

  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith(`${root}/`)) continue
    folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(entry(path, false))
  }

  const order = (one: Entry): Entry => ({
    ...one,
    children: [...one.children]
      .sort((a, b) => (a.is_dir === b.is_dir ? 0 : a.is_dir ? -1 : 1))
      .map(order),
  })

  return order(tree)
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    sent.push(`${command} ${path || text(args?.from)}`)

    switch (command) {
      case 'read_note': {
        const held = files.get(path)
        // The crate fails on a file that is not there, and what the store does
        // about a note that has not been written yet depends on that: see `open`
        // and `openRow`, which open the empty page a folder's note would be.
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'create_folder':
        folders.add(path)
        return undefined
      case 'rename_note': {
        const from = text(args?.from)
        const to = text(args?.to)
        // The crate refuses rather than replacing what is there, and case-insensitively
        // on two of the three platforms; see `rename_note` in src-tauri/src/notes.rs.
        const held = [...files.keys(), ...folders].some(
          (one) =>
            one.toLowerCase() === to.toLowerCase() && one.toLowerCase() !== from.toLowerCase(),
        )
        if (held) throw new Error('something already lives there')
        const was = files.get(from)
        if (was !== undefined) {
          files.delete(from)
          files.set(to, was)
        }
        if (folders.delete(from)) folders.add(to)
        return undefined
      }
      case 'read_tree':
        return listing(text(args?.root))
      default:
        return undefined
    }
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { nameFault } = await import('./naming')
const { workspace } = await import('./workspace.svelte')
const { sync } = await import('./sync.svelte')

/** Every path the list shows, in the order it shows them. */
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

beforeEach(async () => {
  files.clear()
  folders.clear()
  sent.length = 0
  files.set('/space/Beta.md', '# Beta')
  folders.add('/space/Work')
  files.set('/space/Work/Plan.md', '# Plan')

  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.naming = null
  workspace.panel = 'tree'
  await workspace.loadTree()
  sent.length = 0
})

describe('making a note', () => {
  test('puts a row in the list, in its sorted place, and writes nothing yet', async () => {
    await workspace.createNote()

    expect(workspace.naming).toEqual({
      path: '/space/Untitled.md',
      appending: false,
      making: 'note',
    })
    // Folders first, then the names in order: the row is where the listing would
    // put it rather than at the end of the list.
    expect(rows()).toEqual([
      '/space/Work',
      '/space/Work/Plan.md',
      '/space/Beta.md',
      '/space/Untitled.md',
    ])
    expect(sent).toEqual([])
    expect([...files.keys()]).not.toContain('/space/Untitled.md')
  })

  test('and the name that is typed is what makes it, and opens it', async () => {
    await workspace.createNote()
    await workspace.makeNamed('Second quarter.md')

    expect(files.get('/space/Second quarter.md')).toBe('# Second quarter\n\n')
    expect(workspace.naming).toBeNull()
    expect(workspace.active?.path).toBe('/space/Second quarter.md')

    // The row it was named on has gone with it; the note is the only one left.
    expect(rows()).not.toContain('/space/Untitled.md')
    expect(rows()).toContain('/space/Second quarter.md')
  })

  test('while cancelling takes the row away again and makes nothing', async () => {
    await workspace.createNote()
    workspace.cancelNaming()

    expect(workspace.naming).toBeNull()
    expect(rows()).not.toContain('/space/Untitled.md')
    expect(sent).toEqual([])
    expect(workspace.tabs).toHaveLength(0)
  })

  /** The plus at the end of the tab strip, and the one a phone puts over the note:
   *  a gesture that made nothing at all would read as a gesture that failed. */
  test('and with no list on screen it is made straight away, under a stepped name', async () => {
    workspace.panel = null
    await workspace.createNote()

    expect(workspace.naming).toBeNull()
    expect(files.get('/space/Untitled.md')).toBe('# Untitled\n\n')
  })

  test('and the name is stepped until it is free', async () => {
    files.set('/space/Untitled.md', '# Untitled')
    await workspace.loadTree()

    await workspace.createNote()
    expect(workspace.naming?.path).toBe('/space/Untitled 2.md')
  })
})

/** The only way a folder is made at all, and nothing in the app calls it that:
 *  a note goes inside a note. See folder-notes.ts and docs/tree.md. */
describe('making a note inside a note', () => {
  test('nests the note it goes inside first, and names the new one on its row', async () => {
    await workspace.createInside('/space/Beta.md')

    // `Beta.md` is `Beta/Beta.md` now, which is the folder-note layout Obsidian
    // reads, and the row waiting for a name is beside it.
    expect(files.has('/space/Beta/Beta.md')).toBe(true)
    expect(files.has('/space/Beta.md')).toBe(false)
    expect(workspace.naming?.path).toBe('/space/Beta/Untitled.md')
    expect(workspace.isExpanded('/space/Beta')).toBe(true)
  })

  test('and the name that was typed makes the nested note', async () => {
    await workspace.createInside('/space/Beta.md')
    await workspace.makeNamed('Monday.md')

    expect(files.has('/space/Beta/Monday.md')).toBe(true)
    expect(workspace.naming).toBeNull()
  })

  /** A row that is already a folder - one nib nested, or one out of somebody's
   *  vault - only gets the new note. Nothing is written to make it a folder note,
   *  because nobody asked for that. */
  test('while a folder only gets the note, and no note of its own', async () => {
    await workspace.createInside('/space/Work')

    expect(workspace.naming?.path).toBe('/space/Work/Untitled.md')
    expect(files.has('/space/Work/Work.md')).toBe(false)
    expect(sent.filter((one) => one.startsWith('write_note'))).toEqual([])
  })

  test('and a file that can hold nothing gets nothing at all', async () => {
    files.set('/space/paper.pdf', '%PDF')
    await workspace.loadTree()

    await workspace.createInside('/space/paper.pdf')
    expect(workspace.naming).toBeNull()
  })
})

/** A folder that came from outside nib has no note of its own until somebody
 *  writes one. Opening its row opens the note it would be, and looking is not
 *  writing: the file appears when there are words in it, which is the ordinary
 *  save. */
describe('opening a row that is a folder', () => {
  test('opens the note it holds of its own name', async () => {
    files.set('/space/Work/Work.md', '# Work')
    await workspace.loadTree()

    await workspace.openRow('/space/Work')
    expect(workspace.active?.path).toBe('/space/Work/Work.md')
  })

  test('and opens the empty page it would be where it holds none, writing nothing', async () => {
    await workspace.openRow('/space/Work')

    expect(workspace.active?.path).toBe('/space/Work/Work.md')
    expect(workspace.active?.doc).toBe('')
    expect(files.has('/space/Work/Work.md')).toBe(false)
    expect(sent.filter((one) => one.startsWith('write_note'))).toEqual([])
  })

  test('and a row that is a note opens that note', async () => {
    await workspace.openRow('/space/Beta.md')
    expect(workspace.active?.path).toBe('/space/Beta.md')
  })
})

describe('making a canvas', () => {
  test('is the same gesture, and the file is written once it has a name', async () => {
    await workspace.createCanvas()
    expect(workspace.naming).toMatchObject({ path: '/space/Untitled.canvas', making: 'canvas' })

    await workspace.makeNamed('Board.canvas')
    expect(files.has('/space/Board.canvas')).toBe(true)
    expect(workspace.active?.kind).toBe('canvas')
  })
})

describe('renaming a row that exists', () => {
  test('moves the file and closes the field', async () => {
    workspace.startRenaming('/space/Beta.md')
    expect(workspace.naming).toEqual({
      path: '/space/Beta.md',
      appending: false,
      making: null,
    })

    await workspace.rename('/space/Beta.md', 'Gamma.md')

    expect(files.has('/space/Gamma.md')).toBe(true)
    expect(files.has('/space/Beta.md')).toBe(false)
    expect(workspace.naming).toBeNull()
  })

  /** The field is opened by a menu, by F2 and by making a note, and two of those
   *  can happen while the list is not what the sidebar is showing. */
  test('but only where there is a row to type in', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space/Beta.md')
    expect(workspace.naming).toBeNull()
  })

  /** The header is over every panel, so the space's name has a field wherever the
   *  sidebar is open; see Sidebar.svelte. */
  test('while a space is named in the header, which any open panel has', () => {
    workspace.panel = 'search'
    workspace.startRenaming('/space')
    expect(workspace.naming?.path).toBe('/space')

    workspace.panel = null
    workspace.naming = null
    workspace.startRenaming('/space')
    expect(workspace.naming).toBeNull()
  })
})

describe('a listing arriving while a name is being typed', () => {
  test('leaves the row being made where it is', async () => {
    await workspace.createNote('/space/Work')
    await workspace.loadTree()

    expect(workspace.naming?.path).toBe('/space/Work/Untitled.md')
    expect(rows()).toContain('/space/Work/Untitled.md')
  })

  test('and leaves a rename in flight alone', async () => {
    workspace.startRenaming('/space/Beta.md')
    await workspace.loadTree()

    expect(workspace.naming?.path).toBe('/space/Beta.md')
  })

  /** A note deleted on another machine, or by another window: the row is gone, so
   *  there is nothing left to rename and nothing to commit a name onto. */
  test('but cancels a rename whose file has gone', async () => {
    workspace.startRenaming('/space/Beta.md')
    files.delete('/space/Beta.md')
    await workspace.loadTree()

    expect(workspace.naming).toBeNull()
  })
})

describe('the names beside a row', () => {
  test('are what is in its folder, its own left out', () => {
    expect(workspace.namesBeside('/space/Beta.md')).toEqual(['Work'])
    expect(workspace.namesBeside('/space/Work/Plan.md')).toEqual([])
    expect(workspace.namesBeside('/space/Work')).toEqual(['Beta.md'])
  })
})

/** A website made from the file list: the one row that wrote its ending twice.
 *
 *  The field puts the row's own ending back before it commits, as it does for every
 *  kind, so what arrives here is `Blog.url` - and the name was then read as a title
 *  and given a second `.url`. The row said `Blog.url`, which is the ending Emil kept
 *  seeing in the list. */
describe('making a website', () => {
  test('writes the name once, ending and all', async () => {
    await workspace.createWebsite()
    expect(workspace.naming?.path).toBe('/space/Untitled.url')

    await workspace.makeNamed('Blog.url')

    expect([...files.keys()]).toContain('/space/Blog.url')
    expect([...files.keys()]).not.toContain('/space/Blog.url.url')
  })

  /** The shortcut keeps the title in a key of its own, and that is what the bar and
   *  the tab read before a page has loaded. */
  test('and the title inside it is the name, not the file name', async () => {
    await workspace.createWebsite()
    await workspace.makeNamed('Blog.url')

    expect(files.get('/space/Blog.url')).toContain('Blog')
    expect(files.get('/space/Blog.url')).not.toContain('Blog.url')
  })
})

/** Duplicating: the word goes beside the name rather than after the ending, and the
 *  name steps like every other name the app writes. A second copy used to be written
 *  straight over the first. */
describe('duplicating a file', () => {
  test('puts the word beside the name and keeps the ending', async () => {
    await workspace.duplicate('/space/Beta.md')

    expect(files.get('/space/Beta copy.md')).toBe('# Beta')
    expect([...files.keys()]).toContain('/space/Beta.md')
  })

  test('and a second copy is a second file rather than the first one over again', async () => {
    await workspace.duplicate('/space/Beta.md')
    await workspace.duplicate('/space/Beta.md')

    expect([...files.keys()].filter((one) => one.startsWith('/space/Beta copy'))).toEqual([
      '/space/Beta copy.md',
      '/space/Beta copy 2.md',
    ])
  })

  /** A name that is nothing but an ending has no stem to put the word beside, and the
   *  old rule made ` copy.md` - a name starting with a space, which the trash then
   *  refuses to restore. */
  test('and a name that is only an ending copies to a name', async () => {
    files.set('/space/.md', '# only an ending')
    await workspace.loadTree()

    await workspace.duplicate('/space/.md')
    expect([...files.keys()]).toContain('/space/copy.md')
    expect([...files.keys()]).not.toContain('/space/ copy.md')
  })

  test('and a canvas copies as a canvas', async () => {
    files.set('/space/Board.canvas', '{}')
    await workspace.loadTree()

    await workspace.duplicate('/space/Board.canvas')
    expect([...files.keys()]).toContain('/space/Board copy.canvas')
  })
})

/** Two kinds under one name: `Note.md` beside `Note.canvas` is two rows saying
 *  `Note`, told apart by the mark in front of them. Neither may be written over. */
describe('a name two kinds share', () => {
  beforeEach(async () => {
    files.set('/space/Note.md', '# Note')
    files.set('/space/Note.canvas', '{}')
    await workspace.loadTree()
  })

  test('is two files, and renaming one leaves the other alone', async () => {
    await workspace.rename('/space/Note.canvas', 'Board.canvas')

    expect([...files.keys()]).toContain('/space/Board.canvas')
    expect(files.get('/space/Note.md')).toBe('# Note')
  })

  /** Which is what the field asks about: the name that would be written, against the
   *  names in the folder. `Note` beside `Note.canvas` is free; `Note.canvas` is not. */
  test('and the field knows which of the two a name would take', () => {
    const beside = workspace.namesBeside('/space/Note.canvas')
    expect(nameFault({ typed: 'Note', extension: '.canvas', taken: beside })).toBeNull()
    expect(nameFault({ typed: 'Note', extension: '.md', taken: beside })).toBe('taken')
  })
})

/** What the row's own menu offers to take back, which sits under the row and has to
 *  call the file what the row calls it. */
describe('the undo a row offers', () => {
  test('names the file the way the row names it', async () => {
    files.set('/space/Sketch.pages', '{}')
    await workspace.loadTree()

    await workspace.rename('/space/Sketch.pages', 'Sketch drawing.pages')
    expect(workspace.undoLabel).toBe('Undo renaming Sketch drawing')

    await workspace.move('/space/Beta.md', '/space/Work')
    expect(workspace.undoLabel).toBe('Undo moving Beta')
  })
})

/** A file that moved reaches the account as itself.
 *
 *  The account keeps a note under an id rather than under its name, and everything
 *  that outlives one sitting hangs off that id: the version history, the room every
 *  device in the note joins, what a published link points at. Nothing used to tell
 *  the account anything, so the next pass read the move off the folder as one note
 *  being created and another deleted - a new id, and the note's history ending where
 *  its name changed.
 *
 *  Said by the two operations that move a file rather than by whoever asked for one,
 *  because the askers are what keep being added: the field in this list, a drag, the
 *  palette, an automation, an undo, a folder that stopped holding anything. See
 *  `movedOnAccount` in workspace.svelte.ts and `movedHere` in sync/mirror.ts. */
describe('what the account is told about a file that moved', () => {
  afterEach(() => vi.restoreAllMocks())

  test('a rename is that note, under another name', async () => {
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await workspace.rename('/space/Beta.md', 'Gamma.md')

    expect(moved).toHaveBeenCalledWith('/space/Beta.md', '/space/Gamma.md')
  })

  test('and a drag into a folder is the same note, in the folder', async () => {
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await workspace.move('/space/Beta.md', '/space/Work')

    expect(moved).toHaveBeenCalledWith('/space/Beta.md', '/space/Work/Beta.md')
  })

  test('while a rename the disk refused says nothing at all', async () => {
    files.set('/space/Taken.md', '# Taken')
    await workspace.loadTree()
    const moved = vi.spyOn(sync, 'moved').mockResolvedValue(undefined)

    await expect(workspace.rename('/space/Beta.md', 'Taken.md')).rejects.toThrow()

    expect(moved).not.toHaveBeenCalled()
  })
})

/** A rename the disk refuses - something already there, a name that differs only in
 *  case - used to leave the row wearing a name nothing answered to, because the row
 *  moves before the rename is asked for and nothing put it back. */
describe('a rename the disk refuses', () => {
  test('leaves the row under the name it has', async () => {
    files.set('/space/Taken.md', '# Taken')
    await workspace.loadTree()

    await expect(workspace.rename('/space/Beta.md', 'Taken.md')).rejects.toThrow()

    expect(rows()).toContain('/space/Beta.md')
    expect(rows()).not.toContain('/space/Taken 2.md')
    expect(files.get('/space/Beta.md')).toBe('# Beta')
  })

  test('and so does a move', async () => {
    files.set('/space/Work/Beta.md', '# another Beta')
    await workspace.loadTree()

    await expect(workspace.move('/space/Beta.md', '/space/Work')).rejects.toThrow()

    expect(rows()).toContain('/space/Beta.md')
    expect(files.get('/space/Work/Beta.md')).toBe('# another Beta')
  })
})
