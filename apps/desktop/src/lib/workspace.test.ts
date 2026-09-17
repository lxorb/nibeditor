import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The store reads the browser's storage the moment it is made, and reads
 *  notes through the platform shim. Under node there is neither, so both are
 *  stood in for first - which is why the store is imported further down
 *  rather than at the top. */

/** A canvas with one stroke on it, as the format writes one. What a plane that
 *  has been drawn on and saved looks like on disk. */
const DRAWN =
  '{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [' +
  '{ "id": "s1", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 10, 10, 0.5, 0, 0, 8] }' +
  ']\n\t}\n}\n'

const notes: Record<string, string> = {
  '/space/a.md': '# a',
  '/space/b.md': '# b',
  '/space/c.md': '# Quarter plan\n\ntext\n\n## Why it works\n\nmore\n',
  '/space/plan.canvas': DRAWN,
  // Two files opened from the computer, outside every space this machine knows of.
  '/elsewhere/outside.md': '# outside',
  '/elsewhere/beside it.md': '# beside it',
}

/** Those files, which are what "external" means: nothing but this disk is holding
 *  them, so saving them is the reader's to ask for and the only place the app
 *  still asks anybody about anything. */
const OUTSIDE = '/elsewhere/outside.md'
const ALSO_OUTSIDE = '/elsewhere/beside it.md'

/** The path an invoke was given, or an empty one: `args` is a bag of unknowns
 *  and a path that is not a string is not a path. */
const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

/** Every command the store sent, in order, so a test can say what was written
 *  and what was kept before it. */
const sent: { command: string; path: string; content: string }[] = []

/** A write held open, for a test about what happens while one is in the air:
 *  writing a file is a round trip, and somebody may type during it. */
/** A read held open too, for a test about what happens while one is in the air.
 *  One path only: a gesture that reads every open note has to be caught in the
 *  middle of reading one of them, and the test's own reads must not hang with it. */
const holding: { write: Promise<void> | null; read: Promise<void> | null; readPath: string } = {
  write: null,
  read: null,
  readPath: '',
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: pathOf(args),
      content: typeof args?.content === 'string' ? args.content : '',
    })

    if (command === 'write_note' && holding.write) await holding.write
    if (command === 'read_note' && holding.read && holding.readPath === pathOf(args)) {
      await holding.read
    }
    if (command !== 'read_note') return undefined

    const path = pathOf(args)
    const doc = notes[path]
    if (doc === undefined) throw new Error(`no such note: ${path}`)
    return doc
  },
}))

/** The sheet, scripted. `choose` is the closing question and `askName` is what
 *  saving a note with no home yet goes through, so both are answered from here
 *  and both record that they were asked. */
const sheet = {
  asked: [] as string[],
  named: [] as string[],
  /** What `choose` answers: `save`, `discard`, `cancel`, or null for dismissed. */
  answer: null as string | null,
  /** The name a save is given, or null for a question nobody answers. */
  name: null as string | null,
  /** The folder the save sheet is answered with, or null for "wherever it offered". */
  folder: null as string | null,
}

vi.mock('./prompt.svelte', () => ({
  prompt: {
    choose: (options: { title: string }) => {
      sheet.asked.push(options.title)
      return Promise.resolve(sheet.answer)
    },
    askName: (options: { title: string }) => {
      sheet.named.push(options.title)
      return Promise.resolve(
        sheet.name === null ? null : { name: sheet.name, space: 's', folder: sheet.folder },
      )
    },
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

const { workspace } = await import('./workspace.svelte')
const { panesOf } = await import('./workspace/session')
const { noteId } = await import('./note-id')
const { viewport } = await import('./viewport.svelte')
type Entry = import('./workspace.svelte').Entry

/** A single click in the file list, and the tab it lands in. */
async function preview(path: string) {
  await workspace.open(path, { preview: true })
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} did not open`)
  return tab
}

// Every test drives the clock, so the writes the workspace waits out - the session
// four hundred milliseconds after a tab moves, a note's autosave a second after a
// keystroke, both of which end in a write to storage - land on a clock the afterEach
// drops rather than on real timers that wake in a later test and write over what it
// set up. The describes that time one of those writes themselves say so with their
// own useFakeTimers, which this leaves to them. See afterEach.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // Drop whatever a test left waiting before the next one runs; dropping is not
  // firing, so a stale write never lands. Real again on the way out, and a test's
  // own useRealTimers has run before this, so this only tidies what it left.
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
})

describe('keeping a preview tab', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('a single click from the list opens a preview', async () => {
    const tab = await preview('/space/a.md')
    expect(workspace.previewTabId).toBe(tab.id)
  })

  test('an unkept preview is taken over by the next one', async () => {
    const first = await preview('/space/a.md')
    const second = await preview('/space/b.md')

    expect(second.id).toBe(first.id)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('makes the tab stay, so the next preview gets a tab of its own', async () => {
    const first = await preview('/space/a.md')
    workspace.keep(first.id)
    expect(workspace.previewTabId).toBeNull()

    const second = await preview('/space/b.md')
    expect(second.id).not.toBe(first.id)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.previewTabId).toBe(second.id)
  })

  /** A preview takes its next note on rather than being handed another, which is
   *  only honest while the preview is the one view of that document. Split into a
   *  second pane it is not: there are two tabs on one document, and a note taken on
   *  here moves the pane beside it to a note nobody asked it for. The same hole
   *  `walk` had, reached by the other door. */
  test('is not taken over while a second pane is showing its note', async () => {
    const looking = await preview('/space/a.md')
    workspace.split('row')

    const beside = workspace.tabs.find((one) => one.id !== looking.id)
    if (!beside) throw new Error('the split did not happen')
    expect(beside.note).toBe(looking.note)

    // Back in the pane the preview is in, and another row clicked.
    workspace.focusPane(looking.paneId)
    const next = await preview('/space/b.md')

    expect(next.id).not.toBe(looking.id)
    expect(beside.path).toBe('/space/a.md')
    expect(looking.path).toBe('/space/a.md')
    workspace.collapsePanes()
  })

  test('leaves the preview alone when asked about some other tab', async () => {
    await workspace.open('/space/a.md')
    const [permanent] = workspace.tabs
    if (!permanent) throw new Error('opening a note left no tab')

    const previewed = await preview('/space/b.md')

    workspace.keep(permanent.id)
    expect(workspace.previewTabId).toBe(previewed.id)
  })

  test('is what saving does, even with nothing to write', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.dirty).toBe(false)

    await workspace.save()
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.tabs.map((one) => one.id)).toEqual([tab.id])
  })

  test('is what typing in the note does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

    // What a keystroke amounts to: the document changes, and it says so.
    tab.note.live.replace('# a, changed')

    expect(keep).toHaveBeenCalledWith(tab.id)
    expect(workspace.previewTabId).toBeNull()
  })

  test('is what opening the note for real does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

    await workspace.open('/space/a.md')

    expect(keep).toHaveBeenCalledWith(tab.id)
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.tabs).toHaveLength(1)
  })
})

describe('picking a space from the switcher', () => {
  test('opens a closed sidebar on the tree', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = null
    await workspace.showSpace('one')
    expect(workspace.activeSpaceId).toBe('one')
    expect(workspace.panel).toBe('tree')
  })

  test('leaves an open panel as it is', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = 'outline'
    await workspace.showSpace('one')
    expect(workspace.panel).toBe('outline')
  })
})

/** Which side of the window each panel sits on. The whole of what this has to be
 *  right about is that a window nobody has arranged is the window it always was:
 *  everything on the left, and no right side at all. */
describe('the two sides of the window', () => {
  // The store is one store for the whole file, and this is the state these tests
  // are about: every one of them starts from the window nobody has arranged.
  beforeEach(() => {
    workspace.right = []
    workspace.rightPanel = null
    workspace.panel = null
  })

  test('start with everything on the left and no right side', () => {
    expect(workspace.right).toEqual([])
    expect(workspace.rightPanel).toBeNull()
    expect(workspace.sideOf('outline')).toBe('left')
    expect(workspace.panelsOn('left', ['tree', 'outline'])).toEqual(['tree', 'outline'])
    expect(workspace.panelsOn('right', ['tree', 'outline'])).toEqual([])
  })

  test('a panel moved over takes its open state with it', () => {
    workspace.showPanel('outline')
    expect(workspace.panel).toBe('outline')

    workspace.movePanel('outline', 'right')
    expect(workspace.sideOf('outline')).toBe('right')
    // The side it left is not left showing a panel that is no longer on it.
    expect(workspace.panel).toBeNull()
    expect(workspace.rightPanel).toBe('outline')
  })

  test('and a panel that was not showing arrives shut', () => {
    workspace.showPanel('tree')
    workspace.movePanel('outline', 'right')

    expect(workspace.panel).toBe('tree')
    expect(workspace.rightPanel).toBeNull()
  })

  test('each side shows and shuts its own', () => {
    workspace.movePanel('outline', 'right')

    workspace.showPanel('tree')
    workspace.showPanel('outline')
    expect(workspace.openOn('left')).toBe('tree')
    expect(workspace.openOn('right')).toBe('outline')

    // Pressing the one already showing shuts that side and leaves the other.
    workspace.togglePanel('outline')
    expect(workspace.openOn('right')).toBeNull()
    expect(workspace.openOn('left')).toBe('tree')

    workspace.closePanel()
    expect(workspace.openOn('left')).toBeNull()
  })

  /** The switch and the showing are two gestures, and the names say which is
   *  which. They were one method called `showPanel`, which shut the panel it was
   *  asked for whenever that panel was the one already open: the File list row of
   *  the menu, a website's bookmarks row and the drag that pulls the drawer out all
   *  took the file list away instead of opening it, and every drive that asks for
   *  the file list on the way in lost the list it had just asked for. */
  test('asking for the panel that is already showing leaves it showing', () => {
    workspace.showPanel('tree')
    workspace.showPanel('tree')

    expect(workspace.openOn('left')).toBe('tree')
  })

  test('and the press on a panel tab is the switch', () => {
    workspace.togglePanel('tree')
    expect(workspace.openOn('left')).toBe('tree')

    workspace.togglePanel('tree')
    expect(workspace.openOn('left')).toBeNull()
  })

  test('showing one panel over another still swaps them', () => {
    workspace.showPanel('tree')
    workspace.showPanel('outline')

    expect(workspace.openOn('left')).toBe('outline')
  })

  test('and moving the last one back leaves no right side behind', () => {
    workspace.movePanel('links', 'right')
    workspace.showPanel('links')
    expect(workspace.right).toEqual(['links'])

    workspace.movePanel('links', 'left')
    expect(workspace.right).toEqual([])
    expect(workspace.rightPanel).toBeNull()
    expect(workspace.panel).toBe('links')
  })

  test('a move to the side it is already on does nothing', () => {
    workspace.showPanel('tree')
    workspace.movePanel('tree', 'left')

    expect(workspace.right).toEqual([])
    expect(workspace.panel).toBe('tree')
  })
})

describe('selecting several rows', () => {
  const note = (path: string): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  const folder = (path: string, children: Entry[]): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  })

  beforeEach(() => {
    workspace.tree = folder('/space', [
      note('/space/a.md'),
      folder('/space/f', [note('/space/f/b.md'), note('/space/f/c.md')]),
      note('/space/d.md'),
    ])
    workspace.device.expanded = { '/space/f': true }
    workspace.clearSelection()
  })

  /** The listing here is handed over in the order it was written down, and the rows
   *  come back in the order the space is read in - folders first, then the names -
   *  because that is decided over the listing rather than by whoever read it; see
   *  tree-order.ts. */
  test('the rows shown, top to bottom, follow open folders', () => {
    expect(workspace.visibleRows()).toEqual([
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
      '/space/a.md',
      '/space/d.md',
    ])
    workspace.device.expanded = {}
    expect(workspace.visibleRows()).toEqual(['/space/f', '/space/a.md', '/space/d.md'])
  })

  test('a plain pick replaces, ctrl toggles', () => {
    workspace.select('/space/a.md')
    workspace.toggleSelect('/space/d.md')
    expect(workspace.selection).toEqual(['/space/a.md', '/space/d.md'])
    workspace.toggleSelect('/space/a.md')
    expect(workspace.selection).toEqual(['/space/d.md'])
    workspace.select('/space/f')
    expect(workspace.selection).toEqual(['/space/f'])
  })

  test('shift takes everything shown between the anchor and the row', () => {
    workspace.select('/space/f')
    workspace.selectRange('/space/a.md')
    expect(workspace.selection).toEqual([
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
      '/space/a.md',
    ])
    workspace.selectRange('/space/f/b.md')
    expect(workspace.selection).toEqual(['/space/f', '/space/f/b.md'])
  })

  test('shift without an anchor picks the row alone', () => {
    workspace.selectRange('/space/d.md')
    expect(workspace.selection).toEqual(['/space/d.md'])
  })

  test('select all and clear', () => {
    workspace.selectAll()
    expect(workspace.selection).toHaveLength(5)
    workspace.clearSelection()
    expect(workspace.selection).toEqual([])
  })

  test('a drag carries the selection only when it starts on a selected row', () => {
    workspace.select('/space/a.md')
    workspace.toggleSelect('/space/d.md')
    expect(workspace.dragPayload('/space/a.md')).toEqual(['/space/a.md', '/space/d.md'])
    expect(workspace.dragPayload('/space/f')).toEqual(['/space/f'])
  })

  test('moving several skips what a moving folder already takes along', async () => {
    const moved: string[] = []
    const spy = vi
      .spyOn(workspace, 'move')
      .mockImplementation(async (from: string) => void moved.push(from))
    await workspace.moveMany(['/space/f', '/space/f/b.md', '/space/a.md'], '/space/elsewhere')
    expect(moved).toEqual(['/space/f', '/space/a.md'])
    expect(workspace.selection).toEqual([])
    spy.mockRestore()
  })

  test('deleting several knows which are folders', async () => {
    const removed: [string, boolean][] = []
    const spy = vi
      .spyOn(workspace, 'remove')
      .mockImplementation(
        async (path: string, isFolder: boolean) => void removed.push([path, isFolder]),
      )
    await workspace.removeMany(['/space/f', '/space/f/c.md', '/space/d.md'])
    expect(removed).toEqual([
      ['/space/f', true],
      ['/space/d.md', false],
    ])
    spy.mockRestore()
  })

  test('the selection empties with the space', async () => {
    workspace.select('/space/a.md')
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    await workspace.selectSpace('one')
    expect(workspace.selection).toEqual([])
  })
})

/** A note that holds notes. What the rule is lives in folder-notes.ts; this is
 *  the store doing it: the folder is made by moving the note into it, the rows
 *  dropped on it follow, and the last row dragged back out takes the folder away
 *  again.
 *
 *  No space is open, so the listing that follows every move is a no-op and what
 *  is left is the tree the store keeps in front of the disk; see tree-edits.ts. */
describe('nesting a note in a note', () => {
  const note = (path: string): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  const folder = (path: string, children: Entry[]): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  })

  /** Every path the tree shows, folders and notes alike, so a test can say what
   *  the sidebar would draw. */
  const shown = (entry: Entry | null): string[] =>
    !entry
      ? []
      : entry.children.flatMap((child) => [child.path, ...shown(child.is_dir ? child : null)])

  beforeEach(() => {
    workspace.activeSpaceId = null
    workspace.tree = folder('/space', [note('/space/a.md'), note('/space/d.md')])
    workspace.device.expanded = {}
    workspace.clearSelection()
  })

  test('the note the drop landed on goes into the folder first', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')

    expect(shown(workspace.tree)).toEqual(['/space/a', '/space/a/a.md', '/space/a/d.md'])
  })

  test('and the folder is open, so the row does not swallow what was dropped', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    expect(workspace.isExpanded('/space/a')).toBe(true)
  })

  test('the note is not a row of its own: it is the row', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    workspace.device.expanded = { '/space/a': true }

    expect(workspace.visibleRows()).toEqual(['/space/a', '/space/a/d.md'])
  })

  /** The row holds rows, which is what the two arrows act on; what it opens is
   *  `openRow`'s to work out, so the walk does not carry it. */
  test('and the row says it holds rows, for the arrows that fold it', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    const row = workspace.visibleTree().find((one) => one.path === '/space/a')

    // Open, because a drop that nested a note opens the row it landed on.
    expect(row).toEqual({ path: '/space/a', folder: true, open: true })
  })

  test('dragging the last row back out leaves a note and no folder', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    await workspace.moveMany(['/space/a/d.md'], '/space')

    // Read the way the panel reads it: a row put back on the tree is appended to its
    // folder, and where it then sits is the chosen order's to say.
    expect(shown(workspace.shownTree)).toEqual(['/space/a.md', '/space/d.md'])
  })

  test('and asks for the folder to go only once nothing is left in it', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    sent.length = 0
    await workspace.moveMany(['/space/a/d.md'], '/space')

    expect(
      sent.filter((one) => one.command === 'remove_empty_folder').map((one) => one.path),
    ).toEqual(['/space/a'])
  })

  test('a note dropped on a folder that is a folder is the plain move it always was', async () => {
    workspace.tree = folder('/space', [
      folder('/space/f', [note('/space/f/b.md')]),
      note('/space/d.md'),
    ])
    await workspace.moveMany(['/space/d.md'], '/space/f')

    expect(shown(workspace.tree)).toEqual(['/space/f', '/space/f/b.md', '/space/f/d.md'])
  })
})

describe('where a note was last looked at', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
  })

  test('a closed note reopens where it was', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 3, 420, 12)
    workspace.close(tab.id)
    expect(workspace.tabs.some((one) => one.path === '/space/a.md')).toBe(false)

    await workspace.open('/space/a.md')
    const again = workspace.tabs.find((one) => one.path === '/space/a.md')!
    expect(again.cursor).toBe(3)
    expect(again.scroll).toBe(420)
    expect(again.anchor).toBe(12)
  })

  test('a preview tab moving on to another note takes that note’s place', async () => {
    await workspace.open('/space/a.md', { preview: true })
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 2, 100)

    await workspace.open('/space/b.md', { preview: true })
    expect(tab.path).toBe('/space/b.md')
    expect(tab.scroll).toBeUndefined()

    await workspace.open('/space/a.md', { preview: true })
    expect(tab.path).toBe('/space/a.md')
    expect(tab.scroll).toBe(100)
    expect(tab.cursor).toBe(2)
  })

  test('a fold is written down even when nothing else moved', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 3, 0, 1, 1)
    // The same caret and the same scroll: only what is folded has changed, and
    // that is the whole of what there is to record.
    workspace.noteView(tab.id, 3, 0, 1, 1, [[1, 6]])

    expect(tab.folds).toEqual([[1, 6]])
    workspace.close(tab.id)

    await workspace.open('/space/a.md')
    expect(workspace.tabs.find((one) => one.path === '/space/a.md')?.folds).toEqual([[1, 6]])
  })

  test('the places survive a restart', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 1, 77)
    workspace.close(tab.id)

    const saved = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      positions?: Record<string, { cursor: number; scroll: number }>
    }
    expect(saved.positions?.['/space/a.md']).toMatchObject({ cursor: 1, scroll: 77 })
  })

  test('only the notes most recently looked at are kept', () => {
    workspace.tabs = []
    // A place is stamped with the moment it was recorded, and which are the
    // newest is the whole question here.
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => ++clock)

    let last = ''
    for (let index = 0; index < 320; index++) {
      workspace.tabs = []
      workspace.openBlank(`${index}.md`)
      const tab = workspace.tabs[0]
      if (!tab) throw new Error('the note did not open')

      tab.path = `/space/${index}.md`
      last = tab.id
      workspace.noteView(tab.id, index, index)
    }

    // The session is written on a timer; activating a tab writes it now.
    workspace.activate(last)
    now.mockRestore()

    const saved = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      positions?: Record<string, unknown>
    }
    const kept = Object.keys(saved.positions ?? {})

    // The record outlives every tab in it, so it has to stop growing somewhere.
    expect(kept).toHaveLength(300)
    expect(kept).toContain('/space/319.md')
    expect(kept).not.toContain('/space/0.md')
  })
})

describe('opening a bookmarked heading', () => {
  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tabs = []
    workspace.goto = null
  })

  test('opens the note and asks for the line the words are on', async () => {
    await workspace.openAtHeading('c.md', 'Why it works')

    expect(workspace.active?.path).toBe('/space/c.md')
    expect(workspace.goto).toEqual({ path: '/space/c.md', line: 4 })
  })

  test('takes the anchor a link would write, not only the words', async () => {
    await workspace.openAtHeading('c.md', 'why-it-works')
    expect(workspace.goto).toEqual({ path: '/space/c.md', line: 4 })
  })

  test('leaves the note where it was when the heading has gone', async () => {
    await workspace.openAtHeading('c.md', 'Renamed since')

    expect(workspace.active?.path).toBe('/space/c.md')
    expect(workspace.goto).toBeNull()
  })
})

describe('the ids tabs are known by', () => {
  test('are never handed out twice', () => {
    workspace.tabs = []
    for (let index = 0; index < 5000; index++) workspace.openBlank()

    const ids = new Set(workspace.tabs.map((tab) => tab.id))
    expect(ids.size).toBe(workspace.tabs.length)

    workspace.tabs = []
  })
})

/** A pane beside the first one, holding `note` and nothing else. The split opens
 *  the same note in both, the way it does in the app; closing that copy leaves
 *  one note in each pane, which is what most of these tests are about. */
async function beside(note: string) {
  workspace.split('row')
  const copy = workspace.active
  await workspace.open(note)
  if (copy) workspace.close(copy.id)
}

/** One empty pane, whatever the last test left behind. */
function onePane() {
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.previewTabId = null
}

/** Back and forward along one tab's trail.
 *
 *  A trail is where this tab has been this afternoon, and stepping along it is a
 *  note being opened like any other - which is exactly what it was not. It read the
 *  file and had the tab's own document take the note on, going around the one place
 *  that answers what a file is open as. So two things could happen, and both are one
 *  note's words under another note's name: stepping back to a note another pane is
 *  showing made a second set of words over that file, and stepping back in a tab
 *  whose document a second pane shares moved that pane to the note as well.
 *
 *  One file is one document, whichever door the file is reached by. See
 *  workspace/open.ts, and `walk`. */
describe('walking back along a trail', () => {
  beforeEach(() => {
    onePane()
  })

  test('joins the document the note is already open as', async () => {
    // A click in the list, a click on the next row, and the first note opened for
    // real: one tab that has looked at two notes, and one holding the first.
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    await workspace.open('/space/a.md')

    const kept = workspace.tabs.find((one) => one.id !== looking.id)
    if (!kept) throw new Error('the note did not open in a tab of its own')

    await workspace.walk(0, looking.id)

    expect(looking.path).toBe('/space/a.md')
    expect(looking.note).toBe(kept.note)
    expect(workspace.documentAt('/space/a.md')).toBe(kept.note)
    expect(workspace.documents.filter((one) => one.path === '/space/a.md')).toHaveLength(1)
  })

  test('and leaves the pane that shares this tab’s document where it was', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    // The same note in a second pane: one document, two tabs.
    workspace.split('row')

    const other = workspace.tabs.find((one) => one.id !== looking.id)
    if (!other) throw new Error('the split did not happen')
    expect(other.note).toBe(looking.note)

    await workspace.walk(0, looking.id)

    expect(looking.path).toBe('/space/a.md')
    // The other pane is still reading what it was reading.
    expect(other.path).toBe('/space/b.md')
    expect(other.note).not.toBe(looking.note)
  })

  test('and drops a note that has gone from the disk out of the trail', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    looking.trail = ['/space/gone.md', '/space/b.md']

    await workspace.walk(0, looking.id)

    expect(looking.trail).toEqual(['/space/b.md'])
    expect(looking.path).toBe('/space/b.md')
  })
})

describe('a note in two panes', () => {
  beforeEach(() => {
    onePane()
  })

  test('is one document, in a pane of its own', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.active
    workspace.split('row')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(2)

    const [left, right] = workspace.tabs
    // Two tabs, one document: that is the whole of it.
    expect(left?.note).toBe(right?.note)
    expect(right?.paneId).not.toBe(left?.paneId)
    expect(workspace.active?.id).not.toBe(first?.id)
  })

  test('opens the second pane where the note is being read', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.noteView(tab.id, 2, 40, 1)
    workspace.split('column')

    expect(workspace.active.cursor).toBe(2)
    expect(workspace.active.anchor).toBe(1)
  })

  test('wears one dirty mark and one place to save to', async () => {
    // A file from outside every space, because that is the note the app still
    // asks about on the way out - see the rule further down.
    await workspace.open(OUTSIDE)
    workspace.split('row')

    const [left, right] = workspace.tabs
    if (!left || !right) throw new Error('the split did not happen')

    left.note.live.replace('# outside, typed in one pane')

    expect(right.dirty).toBe(true)
    expect(right.doc).toBe(left.doc)
    // One note to ask about on the way out, not two.
    expect(workspace.unsaved).toHaveLength(1)
  })

  test('shows the link toggle in both panes and sets it for both', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const [first, second] = workspace.panes.all
    if (!first || !second) throw new Error('the split did not happen')

    expect(workspace.twins(first.id)).toEqual([second.id])
    workspace.toggleLink(first.id)

    expect(workspace.panes.at(first.id)?.linked).toBe(true)
    expect(workspace.panes.at(second.id)?.linked).toBe(true)
  })

  test('offers no link where the panes hold different notes', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    expect(workspace.twins(workspace.panes.focusedId)).toEqual([])
  })

  /** Dragging the divider must disturb nothing but the divider.
   *
   *  It used to rebuild the arrangement around the new share, and every pane in
   *  it heard about that: each editor was registered and dressed again on every
   *  pointer move, which reconfigured the language and threw away the parse of
   *  whatever note was in it. That is what showed as a note going raw while the
   *  divider was moving. */
  test('a resize leaves the arrangement and its panes as they were', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const frame = workspace.panes.frame
    const panes = workspace.panes.all
    const split = frame.kind === 'split' ? frame : null
    if (!split) throw new Error('the split did not happen')

    workspace.panes.resize(split.id, 0.31, 1000)

    expect(workspace.panes.frame).toBe(frame)
    expect(workspace.panes.all).toEqual(panes)
    expect(split.fraction).toBeCloseTo(0.31)
  })

  test('splits no further than a 2x2', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    workspace.split('column')
    workspace.split('row')

    expect(workspace.panes.count).toBe(3)
    expect(workspace.canSplit('row')).toBe(false)
  })
})

describe('closing what is in a pane', () => {
  beforeEach(() => {
    onePane()
  })

  test('the last tab takes the pane with it', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    const beside = workspace.active
    if (!beside) throw new Error('the split did not happen')

    workspace.close(beside.id)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  /** Emil, 2026-09-14: *"it should be possible to have no note open (there should not
   *  always open a new one)."* So the last pane stays and stays empty; what fills it is
   *  the kinds a new tab could be, as buttons. See NewHere.svelte. */
  test('the last pane stays, and nothing is made to fill it', async () => {
    await workspace.open('/space/a.md')
    const only = workspace.active
    if (!only) throw new Error('nothing opened')

    workspace.close(only.id)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toEqual([])
    expect(workspace.active).toBeNull()
  })

  test('closing a pane closes everything in it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    const paneId = workspace.panes.focusedId

    await workspace.closePane(paneId)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md'])
  })

  test('a tab dragged out of a pane closes the pane behind it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    const moving = workspace.active
    const [first] = workspace.panes.all
    if (!moving || !first) throw new Error('the split did not happen')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: first.id, zone: 'middle' })

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
    ])
  })
})

/** A tab somebody meant to keep.
 *
 *  Emil, 2026-09-17: *"I'd like to be able to pin open tabs (which is per device).
 *  Then they'll be reduced to an icon and all pinned tabs will always be at the left
 *  of the tabs. And to close them, there is no X anymore so you either have to right
 *  click close or Ctrl W."*
 *
 *  What a pinned tab looks like is Tabs.svelte; the order is here, because the order
 *  is the array of tabs itself and everything that counts along a strip counts along
 *  that - see workspace/pinning.ts, which holds the rule, and its own test, which
 *  holds the places a tab may land. What this file is about is that every door into
 *  the strip goes through it. */
describe('a tab held at the head of its strip', () => {
  beforeEach(() => {
    onePane()
  })

  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)

  /** Three notes open, and the tab holding one of them, by name. */
  async function opened(): Promise<(path: string) => string> {
    for (const path of ['/space/a.md', '/space/b.md', '/space/c.md']) await workspace.open(path)

    return (path: string) => {
      const tab = workspace.tabs.find((one) => one.path === path)
      if (!tab) throw new Error(`${path} is not open`)
      return tab.id
    }
  }

  test('comes to the head of the strip, and the next one behind it', async () => {
    const id = await opened()

    workspace.togglePin(id('/space/c.md'))
    expect(strip()).toEqual(['/space/c.md', '/space/a.md', '/space/b.md'])

    workspace.togglePin(id('/space/b.md'))
    expect(strip()).toEqual(['/space/c.md', '/space/b.md', '/space/a.md'])
  })

  test('and goes back to the front of what is not pinned when it is let go of', async () => {
    const id = await opened()
    workspace.togglePin(id('/space/c.md'))
    workspace.togglePin(id('/space/b.md'))

    workspace.togglePin(id('/space/c.md'))

    expect(strip()).toEqual(['/space/b.md', '/space/c.md', '/space/a.md'])
  })

  /** The drag is the door this used to be open at: pinning put the tab at the head
   *  and the next drop put another one in front of it. */
  test('stays in front of a tab dropped at the head of the strip', async () => {
    const id = await opened()
    workspace.togglePin(id('/space/c.md'))

    workspace.dropTab(id('/space/b.md'), {
      kind: 'strip',
      paneId: workspace.panes.focusedId,
      at: 0,
    })

    expect(strip()).toEqual(['/space/c.md', '/space/b.md', '/space/a.md'])
  })

  test('and stays in the run when it is itself dragged past the end of it', async () => {
    const id = await opened()
    workspace.togglePin(id('/space/c.md'))
    workspace.togglePin(id('/space/b.md'))

    workspace.dropTab(id('/space/c.md'), {
      kind: 'strip',
      paneId: workspace.panes.focusedId,
      at: 3,
    })

    expect(strip()).toEqual(['/space/b.md', '/space/c.md', '/space/a.md'])
  })

  /** A pinned tab dragged into another pane is still one somebody meant to keep, so
   *  it lands at the head of the strip it arrives in. */
  test('and lands at the head of another pane s strip when it is dragged there', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    const [first, second] = workspace.panes.all
    if (!first || !second) throw new Error('the split did not happen')

    await workspace.open('/space/c.md')
    const moving = workspace.tabs.find((one) => one.path === '/space/c.md')
    if (!moving) throw new Error('nothing to move')
    workspace.togglePin(moving.id)

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 1 })

    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/c.md',
      '/space/a.md',
    ])
  })

  /** What Emil asked for: the cross is gone and the two deliberate ways are not.
   *  This used to refuse, so a tab pinned in the morning could not be closed at all
   *  until it was let go of. */
  test('closes when Ctrl+W or the row in its own menu asks', async () => {
    const id = await opened()
    const pinned = id('/space/c.md')
    workspace.togglePin(pinned)

    await workspace.closeAsking(pinned)

    expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
  })

  /** And is still not one of "the others": closing everything else around a tab is
   *  about the tabs somebody left lying open, which is what a pinned one is not. */
  test('but is not one of the others that close around a tab', async () => {
    const id = await opened()
    workspace.togglePin(id('/space/c.md'))

    await workspace.closeOthers(id('/space/a.md'))

    expect(strip()).toEqual(['/space/c.md', '/space/a.md'])
  })

  /** Per device, which is what the session already is: it goes into this machine's
   *  own storage with everything else that is open, and the account never hears of
   *  it. */
  test('is written into this machine s own session, and comes back from it', async () => {
    const id = await opened()
    workspace.togglePin(id('/space/c.md'))

    const written = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      layout?: { frame: { pane?: { tabs?: { path: string | null; pinned?: boolean }[] } } }
    }
    const tabs = written.layout?.frame.pane?.tabs ?? []
    expect(tabs.map((one) => [one.path, one.pinned === true])).toEqual([
      ['/space/c.md', true],
      ['/space/a.md', false],
      ['/space/b.md', false],
    ])
  })

  /** A session written by a build that let a pinned tab sit further along - or one
   *  edited by hand - opens as a strip with the run at its head, and the tab that was
   *  showing is still the one showing: that index counts along the strip as it was
   *  written down. */
  test('comes to the head of a strip an arrangement wrote it into the middle of', async () => {
    const draft = (path: string, pinned = false) => ({
      kind: 'note' as const,
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      doc: '',
      dirty: false,
      cursor: 0,
      scroll: 0,
      ...(pinned ? { pinned: true } : {}),
    })

    await workspace.applyLayout({
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          active: 2,
          linked: false,
          tabs: [draft('/space/a.md'), draft('/space/b.md', true), draft('/space/c.md')],
        },
      },
      focused: 'p1',
      panel: null,
    })

    expect(workspace.tabs.map((tab) => tab.path)).toEqual([
      '/space/b.md',
      '/space/a.md',
      '/space/c.md',
    ])
    expect(workspace.active?.path).toBe('/space/c.md')
  })
})

/** Nothing open is a state the window is allowed to be in.
 *
 *  Emil, 2026-09-14: *"it should be possible to have no note open (there should not
 *  always open a new one). Cause then there should just be options between the
 *  different note types which would then create the corresponding note if clicked."*
 *  Four places used to make a blank note rather than leave the window empty; the
 *  buttons a pane shows instead are NewHere.svelte, and what they make is the one list
 *  the plus and Ctrl+T read. */
describe('a window with nothing open', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  /** An arrangement remembers paths, and a note can be gone by the time it is read
   *  back. What used to happen then was a blank note nobody asked for. */
  test('is what an arrangement whose notes have all gone leaves behind', async () => {
    await workspace.applyLayout({
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note',
              path: '/space/gone.md',
              name: 'gone.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    })

    expect(workspace.tabs).toEqual([])
    expect(workspace.active).toBeNull()
  })

  test('and closing the notes one by one never makes a new one', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    for (const tab of [...workspace.tabs]) workspace.close(tab.id)

    expect(workspace.tabs).toEqual([])
    expect(workspace.panes.count).toBe(1)
  })
})

describe('a tab dropped on another pane', () => {
  beforeEach(() => {
    onePane()
  })

  /** Two panes: the first holds a and c, the second holds b and is the one
   *  being worked in. What every drop below starts from. */
  async function twoPanes() {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    await beside('/space/b.md')

    const [first, second] = workspace.panes.all
    const moving = workspace.active
    if (!first || !second || !moving) throw new Error('the split did not happen')

    return { first, second, moving }
  }

  test('lands in the strip at the place it was let go of', async () => {
    const { first, moving } = await twoPanes()
    // A second tab in the pane it leaves, so that pane stays and the strip it
    // lands in is the only thing that changed.
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 1 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('lands last when it was dropped past the end of the strip', async () => {
    const { first, moving } = await twoPanes()
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 2 })

    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/c.md',
      '/space/b.md',
    ])
  })

  test('is the tab showing where it lands, and gives the pane the focus', async () => {
    const { first, moving } = await twoPanes()
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 0 })

    expect(workspace.panes.at(first.id)?.activeTabId).toBe(moving.id)
    expect(workspace.panes.focusedId).toBe(first.id)
    expect(workspace.active?.id).toBe(moving.id)
  })

  /** The last tab of a pane onto the other pane's strip: the two panes merge,
   *  which is what closing that tab would have done to the arrangement. */
  test('takes the pane it emptied with it, and the layout closes up', async () => {
    const { first, second, moving } = await twoPanes()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 1 })

    expect(workspace.panes.count).toBe(1)
    expect(workspace.panes.at(second.id)).toBeNull()
    expect(workspace.panes.focusedId).toBe(first.id)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('moves along its own strip when it is dropped back into it', async () => {
    const { second, moving } = await twoPanes()
    workspace.openBlank('scratch')

    workspace.dropTab(moving.id, { kind: 'strip', paneId: second.id, at: 2 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(second.id).map((tab) => tab.name)).toEqual(['scratch', 'b.md'])
    expect(workspace.panes.at(second.id)?.activeTabId).toBe(moving.id)
  })

  test('makes the pane on the side it was held against', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'left' })

    const [left, right] = workspace.panes.all
    expect(workspace.panes.count).toBe(2)
    // Laid out left to right, so the pane the drop made comes first.
    expect(left?.id).not.toBe(only.id)
    expect(right?.id).toBe(only.id)
    expect(workspace.tabsIn(left?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
    expect(workspace.panes.frame.kind === 'split' && workspace.panes.frame.along).toBe('row')
  })

  test('makes the pane above when it was held against the top', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'top' })

    const [above] = workspace.panes.all
    expect(above?.id).not.toBe(only.id)
    expect(workspace.tabsIn(above?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
    expect(workspace.panes.frame.kind === 'split' && workspace.panes.frame.along).toBe('column')
  })

  test('leaves the far sides where they always were', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'bottom' })

    const [above, below] = workspace.panes.all
    expect(above?.id).toBe(only.id)
    expect(workspace.tabsIn(below?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
  })
})

describe('the sides a pane offers a drop', () => {
  beforeEach(() => {
    onePane()
  })

  test('offers none to the only tab of the pane, which would undo itself', async () => {
    await workspace.open('/space/a.md')

    const [only] = workspace.panes.all
    const alone = workspace.active
    if (!only || !alone) throw new Error('nothing opened')

    expect(workspace.canLand('left', only.id, alone.id)).toBe(false)
    expect(workspace.canLand('bottom', only.id, alone.id)).toBe(false)
    // A note out of the file list leaves no pane behind, so it may.
    expect(workspace.canLand('left', only.id, null)).toBe(true)
  })

  test('offers all four once the pane holds a second tab', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(workspace.canLand(side, only.id, moving.id)).toBe(true)
    }
  })

  test('offers none at all once the arrangement is a 2x2', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    workspace.split('column')
    workspace.split('column', workspace.tabsIn(workspace.panes.all[0]?.id ?? '')[0]?.id)

    expect(workspace.panes.count).toBe(4)
    for (const one of workspace.panes.all) {
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(workspace.canLand(side, one.id, null)).toBe(false)
      }
    }
  })
})

describe('a note dragged out of the file list onto a pane', () => {
  beforeEach(() => {
    onePane()
  })

  test('opens in the strip it was dropped into, at that place', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    const [first] = workspace.panes.all
    if (!first) throw new Error('the split did not happen')

    await workspace.dropNotes(['/space/c.md'], { kind: 'strip', paneId: first.id, at: 0 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/c.md',
      '/space/a.md',
    ])
  })

  test('opens in a pane of its own against a side', async () => {
    await workspace.open('/space/a.md')

    const [only] = workspace.panes.all
    if (!only) throw new Error('nothing opened')

    await workspace.dropNotes(['/space/b.md'], { kind: 'pane', paneId: only.id, zone: 'top' })

    const [above, below] = workspace.panes.all
    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(above?.id ?? '').map((tab) => tab.path)).toEqual(['/space/b.md'])
    expect(workspace.tabsIn(below?.id ?? '').map((tab) => tab.path)).toEqual(['/space/a.md'])
  })
})

describe('an arrangement kept under a name', () => {
  beforeEach(() => {
    onePane()
    for (const one of [...workspace.layouts.all]) workspace.layouts.remove(one.name)
  })

  test('comes back with the panes and the notes it held', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    workspace.saveLayout('two up')

    onePane()
    await workspace.open('/space/c.md')
    expect(workspace.panes.count).toBe(1)

    await workspace.useLayout('two up')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
  })

  test('keeps a note nobody has saved rather than dropping it', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('one up')

    workspace.openBlank('Untitled', '# unsaved words')
    await workspace.useLayout('one up')

    expect(workspace.tabs.some((tab) => tab.doc === '# unsaved words')).toBe(true)
  })

  test('is gone once it is deleted', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('for a moment')
    expect(workspace.layouts.all.map((one) => one.name)).toEqual(['for a moment'])

    workspace.layouts.remove('for a moment')

    expect(workspace.layouts.all).toEqual([])
    expect(workspace.layouts.of('for a moment')).toBeNull()
  })

  test('holds no words, so it shows what the notes say now', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('bare')

    const layout = workspace.layouts.of('bare')
    const drafts = layout ? panesOf(layout.frame).flatMap((one) => one.tabs) : []

    expect(drafts.map((draft) => draft.doc)).toEqual([''])
  })

  test('comes down to one pane on a phone', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    workspace.collapsePanes()

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(2)
    expect(new Set(workspace.tabs.map((tab) => tab.paneId)).size).toBe(1)
  })
})

describe('a note being read', () => {
  beforeEach(() => {
    onePane()
  })

  test('starts being written in', async () => {
    await workspace.open('/space/a.md')
    expect(workspace.active?.reading).toBe(false)
  })

  test('turns over and back', async () => {
    await workspace.open('/space/a.md')

    workspace.toggleReading()
    expect(workspace.active?.reading).toBe(true)

    workspace.toggleReading()
    expect(workspace.active?.reading).toBe(false)
  })

  test('is one tab of two on the same note, not both', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.active
    workspace.split('row')
    const second = workspace.active

    expect(second?.note).toBe(first?.note)
    expect(second?.id).not.toBe(first?.id)

    if (second) workspace.toggleReading(second.id)

    expect(second?.reading).toBe(true)
    expect(first?.reading).toBe(false)
  })

  test('is not something the graph does', () => {
    workspace.openGraph()
    const graph = workspace.active

    workspace.toggleReading()

    expect(graph?.kind).toBe('graph')
    expect(graph?.reading).toBe(false)
  })

  test('goes into the arrangement, and comes back out of it', async () => {
    await workspace.open('/space/a.md')
    workspace.toggleReading()

    const layout = workspace.layout()
    const drafts = panesOf(layout.frame).flatMap((one) => one.tabs)
    expect(drafts.map((draft) => draft.reading)).toEqual([true])

    onePane()
    await workspace.applyLayout(layout)

    expect(workspace.tabs.map((tab) => tab.reading)).toEqual([true])
  })

  test('is written in again when the preview tab moves on', async () => {
    const tab = await preview('/space/a.md')
    workspace.toggleReading(tab.id)
    expect(tab.reading).toBe(true)

    await preview('/space/b.md')

    expect(tab.path).toBe('/space/b.md')
    expect(tab.reading).toBe(false)
  })

  test('keeps the place the editor left, for the editor to find again', async () => {
    await workspace.open('/space/c.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing open')

    tab.cursor = 12
    workspace.notePlace(tab.id, 240, 22)

    expect(tab.anchor).toBe(22)
    expect(tab.scroll).toBe(240)
    // The reading view has no caret to move, so the tab keeps the one it had.
    expect(tab.cursor).toBe(12)
  })

  test('hears about words typed in another pane', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing open')

    const before = tab.note.revision
    tab.note.live.replace('# a, changed')

    expect(tab.note.revision).toBeGreaterThan(before)
  })
})

describe('a replacement across the space', () => {
  /** What the panel works out before anything is written; see search/apply. */
  const change = (path: string, before: string, after: string) => ({
    path,
    before,
    after,
    edits: [{ from: 0, to: before.length, insert: after }],
    back: [{ from: 0, to: after.length, insert: before }],
  })

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.undone.stack = []
    sent.length = 0
  })

  test('keeps what each note said before it writes what it says now', async () => {
    await workspace.replaceInNotes([change('/space/a.md', '# a', '# alpha')])

    const written = sent.filter((one) => one.path === '/space/a.md')
    expect(written.map((one) => one.command)).toEqual(['snapshot_note', 'write_note'])
    expect(written[0]?.content).toBe('# a')
    expect(written[1]?.content).toBe('# alpha')
  })

  test('takes a snapshot of every note it touches', async () => {
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    expect(sent.filter((one) => one.command === 'snapshot_note').map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
    ])
  })

  test('puts the words into a note that is open, and leaves it saved', async () => {
    await workspace.open('/space/a.md')
    await workspace.replaceInNotes([change('/space/a.md', '# a', '# alpha')])

    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')
    expect(tab?.doc).toBe('# alpha')
    expect(tab?.dirty).toBe(false)
  })

  test('is one thing to undo, however many notes it touched', async () => {
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    expect(workspace.undone.stack).toHaveLength(1)
    expect(workspace.undoLabel).toBe('Undo the replacement')
  })

  test('writes nothing and remembers nothing when there is nothing to change', async () => {
    await workspace.replaceInNotes([])

    expect(sent).toEqual([])
    expect(workspace.undoLabel).toBeNull()
  })

  test('undoing gives every note its old words back', async () => {
    await workspace.open('/space/a.md')
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    sent.length = 0
    await workspace.undoFileAction()

    const written = sent.filter((one) => one.command === 'write_note')
    expect(written.map((one) => [one.path, one.content])).toEqual([
      ['/space/a.md', '# a'],
      ['/space/b.md', '# b'],
    ])

    expect(workspace.tabs.find((one) => one.path === '/space/a.md')?.doc).toBe('# a')
    expect(workspace.undone.stack).toHaveLength(0)
  })
})

describe('closing something that holds unsaved work', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    sheet.asked = []
    sheet.named = []
    sheet.answer = 'cancel'
    sheet.name = null
    sent.length = 0
  })

  afterEach(() => {
    // A note that keeps itself has a write on a timer; the fake clock takes it
    // with it, so nothing lands in the middle of the next test.
    vi.useRealTimers()
  })

  /** A note open with something typed into it that has not been written. */
  async function dirty(path: string) {
    await workspace.open(path)
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)

    tab.note.live.replace(`${notes[path] ?? ''}, typed`)
    return tab
  }

  test('asks nothing about a note that is on disk as it stands', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('asks about a file with something typed in it, and Save writes it down', async () => {
    const tab = await dirty(OUTSIDE)
    sheet.answer = 'save'

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual(['Save outside?'])
    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.content)).toEqual([
      '# outside, typed',
    ])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('lets it go on the second answer, without writing anything', async () => {
    const tab = await dirty(OUTSIDE)
    sheet.answer = 'discard'

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toHaveLength(1)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('leaves the tab where it is on Cancel, and on a question dismissed', async () => {
    const tab = await dirty(OUTSIDE)

    await workspace.closeAsking(tab.id)
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(true)

    sheet.answer = null
    await workspace.closeAsking(tab.id)
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(true)
    expect(sheet.asked).toHaveLength(2)
  })

  test('closes an empty untitled note without a word', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  /** The question names the draft the way its tab does: by its own first
   *  heading, since three drafts all asked about as Untitled would be three
   *  questions nobody could tell apart. */
  test('asks about an untitled note with words in it, and Save asks for a name', async () => {
    workspace.openBlank('Untitled', '# a draft')
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    sheet.answer = 'save'
    sheet.name = 'Draft'

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual(['Save a draft?'])
    // One sheet for every kind now - a name and a folder, which is what Chrome asks
    // when a page is bookmarked - so the title is the word on the button.
    expect(sheet.named).toEqual(['Save'])
    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.path)).toEqual([
      '/space/Draft.md',
    ])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('keeps an untitled note whose name is never given', async () => {
    workspace.openBlank('Untitled', '# a draft')
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    sheet.answer = 'save'

    await workspace.closeAsking(tab.id)

    expect(sheet.named).toHaveLength(1)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(true)
  })

  test('asks nothing when the note stays open in another pane', async () => {
    await dirty(OUTSIDE)
    workspace.split('row')

    const beside = workspace.active
    if (!beside) throw new Error('the split did not happen')

    await workspace.closeAsking(beside.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toHaveLength(1)
  })

  test('asks once for each note in a pane that is closing', async () => {
    await workspace.open('/space/a.md')
    await beside(OUTSIDE)
    const paneId = workspace.panes.focusedId
    await dirty(OUTSIDE)
    sheet.answer = 'discard'

    await workspace.closePane(paneId)

    expect(sheet.asked).toEqual(['Save outside?'])
    expect(workspace.tabs.map((one) => one.path)).toEqual(['/space/a.md'])
  })

  test('a pane stays whole when one of its notes is cancelled', async () => {
    await workspace.open('/space/a.md')
    await beside(OUTSIDE)
    const paneId = workspace.panes.focusedId
    await dirty(OUTSIDE)

    await workspace.closePane(paneId)

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(paneId)).toHaveLength(1)
  })

  test('the window asks once per note, and Cancel keeps it open', async () => {
    await dirty(OUTSIDE)
    await dirty(ALSO_OUTSIDE)

    expect(await workspace.mayCloseWindow()).toBe(false)
    expect(sheet.asked).toEqual(['Save outside?'])

    sheet.asked = []
    sheet.answer = 'discard'
    expect(await workspace.mayCloseWindow()).toBe(true)
    expect(sheet.asked).toEqual(['Save outside?', 'Save beside it?'])
  })

  test('asks nothing about a note in a space, whatever was typed in it', async () => {
    vi.useFakeTimers()

    const tab = await dirty('/space/a.md')
    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
    // The write that was waiting, so the queue is empty for the next test.
    await vi.advanceTimersByTimeAsync(1200)
  })

  test('and nothing on the way out of the window either', async () => {
    vi.useFakeTimers()

    await dirty('/space/a.md')
    await dirty('/space/b.md')

    expect(await workspace.mayCloseWindow()).toBe(true)
    expect(sheet.asked).toEqual([])
    await vi.advanceTimersByTimeAsync(1200)
  })

  test('but asks about a file opened from outside every space', async () => {
    vi.useFakeTimers()

    const tab = await dirty(OUTSIDE)
    sheet.answer = 'discard'
    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual(['Save outside?'])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })
})

/** Whether saving a note is anybody's job. One question, behind the mark on the
 *  tab, the question on the way out, and the writing itself.
 *
 *  A note in a space keeps itself: Nib writes it as soon as the typing pauses, an
 *  account carries it away when there is one, and a room carries every keystroke
 *  while another device is in it. So nothing ever asks anybody about it. A file
 *  opened from the computer lives outside every space, and nothing here is looking
 *  after it, so saving that stays the reader's to ask for, mark and all.
 *
 *  Whether an account is signed in does not come into it, which is the whole point
 *  of asking about the space rather than about the mirror: the welcome note a
 *  browser opens on a first visit is somebody's writing before they have an
 *  account, and it must not be waiting on a key nobody has been told about. */
/** A tab with no file, of every kind there is.
 *
 *  Emil, 2026-09-14: *"if you create a new webnote by clicking the plus for a new tab,
 *  then it should open it as a tab and not create it in the sidebar. Same for canvas and
 *  page notes. And like normal notes, then can then of course be saved as well, but they
 *  should be able to exist in an "unsaved" state. Just as a tab, like a browser tab
 *  normally would."*
 *
 *  A blank note has always been this; three of the four kinds wrote a file and a row in
 *  the list before the first frame. What is pinned here is the one model: a tab, no
 *  file, no row, the words in memory, and a save that writes the kind's own file where
 *  the sheet was told to put it. */
describe('a tab nobody has saved', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    sheet.asked = []
    sheet.named = []
    sheet.answer = 'cancel'
    sheet.name = null
    sheet.folder = null
    sent.length = 0
  })

  const written = () => sent.filter((one) => one.command === 'write_note')

  test('a new plane is a tab, with nothing on disk and no row in the list', async () => {
    await workspace.newCanvas()

    expect(workspace.active?.kind).toBe('canvas')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
    // The words are there for the surface to read, in memory and nowhere else.
    expect(workspace.active?.doc).toContain('"nodes"')
    expect(workspace.active?.shown).toBe('Untitled')
  })

  test('and a new deck of pages is the same', async () => {
    await workspace.newPages()

    expect(workspace.active?.kind).toBe('pages')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
    expect(workspace.active?.shown).toBe('Untitled')
  })

  /** A browser tab, which is what a web tab is: the page is live, the bar is the
   *  window's own, and no shortcut is written until somebody says to keep it. */
  test('and a new website is a tab with no shortcut behind it', () => {
    workspace.openWebsite()

    expect(workspace.active?.kind).toBe('web')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
  })

  test('closes without a word while nothing has been drawn on it', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  test('and asks once there is something on it', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    tab.note.replace('{ "nodes": [1] }')
    expect(tab.unsaved).toBe(true)

    await workspace.closeAsking(tab.id)

    // Cancelled, which is the answer this sheet is scripted with, so it stays.
    expect(sheet.asked).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  /** A web tab closes like a browser tab: no question, whatever the page is. */
  test('while a website closes without a question either way', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  test('saves as the file its own kind is written as', async () => {
    await workspace.newCanvas()
    sheet.name = 'Plan'

    await workspace.save()

    expect(written().map((one) => one.path)).toEqual(['/space/Plan.canvas'])
    expect(workspace.active?.path).toBe('/space/Plan.canvas')
    // The same tab, in place: what changed is which file the document is of.
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.active?.unsaved).toBe(false)
  })

  test('and a deck of pages as a deck of pages', async () => {
    await workspace.newPages()
    sheet.name = 'Papers'

    await workspace.save()

    expect(written().map((one) => one.path)).toEqual(['/space/Papers.pages'])
  })

  /** The shortcut holds the address the tab is on, which is the whole of what a website
   *  note is; see web-tab/shortcut.ts. */
  test('and a website as a shortcut holding the address it is on', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    tab.address = 'https://example.com/a'
    sheet.name = 'Example'

    await workspace.save(tab)

    const wrote = written()
    expect(wrote.map((one) => one.path)).toEqual(['/space/Example.url'])
    expect(wrote[0]!.content).toContain('URL=https://example.com/a')
    // The same tab, in place: what changed is which file the document is of.
    expect(tab.path).toBe('/space/Example.url')
  })

  /** A save must never write over a file, and the sheet is the only place that could:
   *  the reader types a name, and a name is easy to type twice. So the name steps aside
   *  by number, out of the same helper the file list uses for a duplicate - and it does
   *  so at the moment of writing, whatever was typed over the free name the field
   *  offered. This was real data loss: the draft prompt wrote over a note of the same
   *  name without a word. */
  test('never writes over a file the folder already has', async () => {
    workspace.tree = {
      name: 'space',
      path: '/space',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        {
          name: 'Plan.canvas',
          path: '/space/Plan.canvas',
          is_dir: false,
          modified: 0,
          created: 0,
          children: [],
        },
      ],
    }

    await workspace.newCanvas()
    sheet.name = 'Plan'

    await workspace.save()

    expect(written().map((one) => one.path)).toEqual(['/space/Plan 2.canvas'])
    expect(workspace.active?.path).toBe('/space/Plan 2.canvas')
    workspace.tree = null
  })

  test('is left where it was when the sheet is dismissed', async () => {
    await workspace.newCanvas()
    sheet.name = null

    await workspace.save()

    expect(written()).toEqual([])
    expect(workspace.active?.path).toBeNull()
  })

  /** One file is one document, and keeping a website is a document being given a
   *  file - the one place in the app where that happens to a document that already
   *  exists. The name comes from the sheet, which stepped it aside by number off
   *  the file list; the file list is a listing, and a listing is a round trip
   *  behind what is open. Two tabs kept in the same instant read the same listing
   *  and were handed the same name, and what that leaves is two documents over one
   *  file: each honest about its own address, both reporting theirs as that file's,
   *  and whichever settles last is the site the file opens at.
   *
   *  So the name is asked for again at the moment of writing, against what is open
   *  as well as what is listed, and the path is claimed before the write begins -
   *  which is the same rule, and the same owner, as opening a file. See
   *  workspace/open.ts. */
  test('never lands two websites on one file', async () => {
    workspace.openWebsite()
    const first = workspace.active
    workspace.openWebsite()
    const second = workspace.active
    if (!first || !second || first.id === second.id) throw new Error('two tabs did not open')

    first.address = 'https://example.com/a'
    second.address = 'https://example.com/b'

    await Promise.all([
      workspace.keepWeb(first, '/space/Example.url'),
      workspace.keepWeb(second, '/space/Example.url'),
    ])

    expect(first.path).toBe('/space/Example.url')
    expect(second.path).toBe('/space/Example 2.url')
    expect(workspace.documentAt('/space/Example.url')).toBe(first.note)
    expect(written().map((one) => one.path)).toEqual(['/space/Example.url', '/space/Example 2.url'])
  })

  /** A browser brings back the tabs it had, and so does this: the words of a document
   *  with no file exist in the session and nowhere else, so they are kept whether or not
   *  anybody has typed in it. See `draftOf`. */
  test('comes back after a restart, words and all', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.replace('{ "nodes": [2] }')

    const draft = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)[0]

    expect(draft?.kind).toBe('canvas')
    expect(draft?.path).toBeNull()
    expect(draft?.doc).toBe('{ "nodes": [2] }')
  })

  test('including one nobody has touched', async () => {
    await workspace.newPages()

    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)
    expect(drafts[0]?.doc.length).toBeGreaterThan(0)
  })
})

describe('a note that keeps itself, and one that does not', () => {
  const WELCOME = '/Notes/Read me.md'

  beforeEach(() => {
    vi.useFakeTimers()
    onePane()
    workspace.spaces = [
      { id: 's', name: 'Notes', root: '/space' },
      // The space a browser seeds on a first visit, which is there before any
      // account is.
      { id: 'w', name: 'Read me', root: '/Notes' },
    ]
    workspace.activeSpaceId = 's'
    sheet.asked = []
    sheet.answer = 'cancel'
    sent.length = 0
    notes[WELCOME] = '# Welcome to Nib'
  })

  afterEach(async () => {
    // Whatever was waiting to be written goes down now rather than in the middle
    // of the next test.
    await vi.advanceTimersByTimeAsync(1200)
    vi.useRealTimers()
  })

  /** A note open with something typed into it. */
  async function typedIn(path: string) {
    await workspace.open(path)
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)

    tab.note.live.replace(`${notes[path] ?? ''}, typed`)
    return tab
  }

  const written = () => sent.filter((one) => one.command === 'write_note').map((one) => one.path)

  test('a note in a space goes down as soon as the typing pauses', async () => {
    const tab = await typedIn('/space/a.md')

    await vi.advanceTimersByTimeAsync(1200)

    expect(written()).toEqual(['/space/a.md'])
    expect(tab.unsaved).toBe(false)
    expect(workspace.unsaved).toEqual([])
  })

  test('and wears no mark at any point, because there is nothing to report', async () => {
    const tab = await typedIn('/space/a.md')

    // Before the write as much as after it: the words have moved, and that is
    // the app's business rather than the reader's.
    expect(tab.dirty).toBe(true)
    expect(tab.unsaved).toBe(false)
    expect(workspace.savingOf(tab)).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1200)
    expect(workspace.savingOf(tab)).toBeUndefined()
  })

  test('signing out changes nothing about it: a space is a space', async () => {
    // Nothing here has ever been told about an account, which is the state a
    // browser on a first visit and a desktop nobody has signed in on are both in.
    const tab = await typedIn(WELCOME)

    await vi.advanceTimersByTimeAsync(1200)

    expect(written()).toEqual([WELCOME])
    expect(tab.unsaved).toBe(false)
    expect(workspace.keepsItself(WELCOME)).toBe(true)
  })

  test('a file opened from outside every space waits for the reader, and says so', async () => {
    const tab = await typedIn(OUTSIDE)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(written()).toEqual([])
    expect(tab.unsaved).toBe(true)
    expect(workspace.unsaved).toHaveLength(1)
    expect(workspace.keepsItself(OUTSIDE)).toBe(false)
  })

  test('a file typed in while it was being written is still out of step with it', async () => {
    const tab = await typedIn(OUTSIDE)

    // Writing a file is a round trip, and a keystroke can land inside it. What
    // went down is the words as they were when the write began; the ones typed
    // after that are on this machine and nowhere else, so the mark stays and the
    // way out still asks.
    let release: () => void = () => undefined
    holding.write = new Promise<void>((resolve) => {
      release = resolve
    })

    const saving = workspace.save(tab)
    tab.note.live.edit([{ from: 0, to: 0, insert: 'typed during the write\n' }])
    release()
    await saving
    holding.write = null

    expect(tab.unsaved).toBe(true)
    expect(workspace.unsaved).toHaveLength(1)
  })

  test('Ctrl+S stays harmless: it writes at once and keeps the preview tab', async () => {
    const tab = await preview('/space/a.md')
    tab.note.live.replace('# a, typed')

    await workspace.save()

    expect(written()).toEqual(['/space/a.md'])
    expect(workspace.previewTabId).toBeNull()
  })

  test('file recovery is offered a version of both kinds', async () => {
    await typedIn('/space/a.md')
    await typedIn(OUTSIDE)
    // Nowhere to keep a version of, so nothing to offer.
    workspace.openBlank('Untitled', '# a draft')

    expect(workspace.worthKeeping.map((one) => one.path)).toEqual(['/space/a.md', OUTSIDE])
    expect(workspace.worthKeeping.every((one) => one.revision > 0)).toBe(true)
  })

  test('and no version of a note nobody has written in', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.worthKeeping.map((one) => one.revision)).toEqual([0])
  })
})

describe('reopening the tab that was closed last', () => {
  beforeEach(() => {
    onePane()
    workspace.closed.stack = []
    sheet.asked = []
    sheet.answer = 'discard'
    sent.length = 0
  })

  test('brings the note back where the focus is once its pane has gone', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    await workspace.open('/space/b.md')

    const beside = workspace.active
    if (!beside) throw new Error('the split did not happen')

    workspace.close(beside.id)
    await workspace.reopenClosed()

    expect(workspace.tabs.map((one) => one.path)).toContain('/space/b.md')
  })

  test('puts it back at its own place in the strip', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    await workspace.open('/space/c.md')

    const middle = workspace.tabs[1]
    if (!middle) throw new Error('three notes did not open')

    workspace.close(middle.id)
    await workspace.reopenClosed()

    expect(workspace.tabs.map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('brings back what was never written down', async () => {
    workspace.openBlank('Untitled', '# a draft')
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    await workspace.closeAsking(tab.id)
    await workspace.reopenClosed()

    expect(workspace.active.doc).toBe('# a draft')
    expect(workspace.active.dirty).toBe(true)
  })

  test('remembers nothing about the blank page a window starts with', async () => {
    workspace.openBlank()
    await workspace.open('/space/a.md')

    expect(workspace.closed.any).toBe(false)
  })

  test('reaches past a note that has since gone', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    const [first, second] = workspace.tabs
    if (!first || !second) throw new Error('two notes did not open')

    workspace.close(first.id)
    workspace.close(second.id)
    // As if the file had been deleted while the tab was closed.
    const kept = notes['/space/b.md'] ?? ''
    delete notes['/space/b.md']

    try {
      await workspace.reopenClosed()
      expect(workspace.tabs.map((one) => one.path)).toContain('/space/a.md')
      expect(workspace.closed.any).toBe(false)
    } finally {
      notes['/space/b.md'] = kept
    }
  })

  test('becomes a second view when the note is still open elsewhere', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const beside = workspace.active
    const first = workspace.tabs[0]
    if (!beside || !first) throw new Error('the split did not happen')

    workspace.close(beside.id)
    await workspace.reopenClosed()

    const back = workspace.tabs.find((one) => one.id !== first.id)
    expect(back?.note).toBe(first.note)
  })
})

/** Stepping off the welcome note.
 *
 *  A browser opens it because a first visit has nothing else to read. Signing in
 *  changes that, and nothing was watching: the workspace restores seconds before
 *  the account does, so somebody who signed in was left looking at "Welcome to
 *  Nib" with their own notes in the sidebar beside it. */
describe('the welcome note, once there are real notes', () => {
  const WELCOME = '/Notes/Read me.md'

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    notes[WELCOME] = '# Welcome to Nib'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    notes[WELCOME] = ''
  })

  /** What the sidebar holds once a space has been pulled down. */
  function listing(paths: string[]) {
    vi.spyOn(workspace, 'notes', 'get').mockReturnValue(
      paths.map((path) => ({ path, name: path.split('/').pop() ?? path })) as never,
    )
  }

  test('is stepped off once the account has brought notes down', async () => {
    listing([WELCOME, '/space/a.md', '/space/b.md'])
    await workspace.open(WELCOME)
    expect(workspace.tabs).toHaveLength(1)

    await workspace.leaveTheWelcomeNote()

    expect(workspace.active?.path).not.toBe(WELCOME)
    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(false)
  })

  test('stays when it is the only note there is', async () => {
    // Nothing has arrived yet. Closing it would leave a blank page, which is
    // worse than a welcome.
    listing([WELCOME])

    await workspace.open(WELCOME)
    await workspace.leaveTheWelcomeNote()

    expect(workspace.active?.path).toBe(WELCOME)
  })

  test('stays when somebody has written in it', async () => {
    listing([WELCOME, '/space/a.md'])
    await workspace.open(WELCOME)
    const opened = workspace.tabs.find((one) => one.path === WELCOME)
    if (opened) opened.dirty = true

    await workspace.leaveTheWelcomeNote()

    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(true)
  })

  test('stays when something else is open beside it', async () => {
    // Two tabs is somebody having said what they want on screen.
    listing([WELCOME, '/space/a.md'])
    await workspace.open(WELCOME)
    await workspace.open('/space/a.md')

    await workspace.leaveTheWelcomeNote()

    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(true)
  })
})

describe('a canvas that comes back after a restart', () => {
  /** The session as it is written down: one pane holding one tab, with the words
   *  left out of it, which is what a file that is on disk is written as. */
  function drafted(kind: 'note' | 'canvas' | 'pdf', path: string) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind,
              path,
              name: path.slice(path.lastIndexOf('/') + 1),
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
  })

  test('is filled from its file, the way a note is', async () => {
    // The session writes no copy of words that are already on disk, so a kind
    // left out of the re-read comes back as an empty plane: every stroke still
    // in the file and none of them on screen.
    await workspace.applyLayout(drafted('canvas', '/space/plan.canvas'))

    const tab = workspace.tabs.find((one) => one.path === '/space/plan.canvas')
    expect(tab?.kind).toBe('canvas')
    expect(tab?.note.text).toBe(DRAWN)
    expect(tab?.note.dirty).toBe(false)
  })

  test('keeps a plane that was drawn on and never saved', async () => {
    // The other half of the same rule: what is on disk never lands on words
    // nobody has written down yet.
    const held = drafted('canvas', '/space/plan.canvas')
    const [only] = held.frame.pane.tabs
    if (!only) throw new Error('the draft holds no tab')

    only.doc = '{ "nodes": [], "edges": [] }\n'
    only.dirty = true
    await workspace.applyLayout(held)

    const tab = workspace.tabs.find((one) => one.path === '/space/plan.canvas')
    expect(tab?.note.text).toBe('{ "nodes": [], "edges": [] }\n')
    expect(tab?.note.dirty).toBe(true)
  })

  test('a paper is still not read as words', async () => {
    // A PDF's tab holds none, so nothing is asked of the file.
    await workspace.applyLayout(drafted('pdf', '/space/paper.pdf'))

    const tab = workspace.tabs.find((one) => one.path === '/space/paper.pdf')
    expect(tab?.kind).toBe('pdf')
    expect(tab?.note.text).toBe('')
  })

  test('and the session keeps no second copy of a plane that is on disk', async () => {
    await workspace.openCanvas('/space/plan.canvas')

    const written = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      layout?: { frame: { pane?: { tabs?: { path: string | null; doc: string }[] } } }
    }
    const held = written.layout?.frame.pane?.tabs?.find((one) => one.path === '/space/plan.canvas')

    expect(held).toBeDefined()
    expect(held?.doc).toBe('')
  })
})

/** A launch paints the frame and opens the session behind it, on purpose: the
 *  window is up and taking keys while the notes are still being read. So the
 *  arrangement lands a second into a sitting somebody has already started. */
describe('a panel asked for while the session is still arriving', () => {
  /** One pane, one note, and a sidebar the arrangement wants. */
  function drafted(panel: 'tree' | 'search' | null) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path: '/space/a.md',
              name: 'a.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.panel = null
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
  })

  test('is what stays, rather than what the arrangement said', async () => {
    workspace.panel = 'tree'

    // The note's own read, caught in the middle: this is the second the window is
    // already up in.
    let release: () => void = () => undefined
    holding.readPath = '/space/a.md'
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })

    // The session arriving, which is the caller nobody asked.
    const arriving = workspace.applyLayout(drafted('tree'), false)
    await Promise.resolve()
    await Promise.resolve()

    // The search key, pressed while the notes are still coming.
    workspace.showPanel('search')

    release()
    await arriving

    expect(workspace.panel).toBe('search')
  })

  test('and an arrangement nobody interrupted still opens its own', async () => {
    await workspace.applyLayout(drafted('tree'), false)

    expect(workspace.panel).toBe('tree')
  })

  /** The other caller: an arrangement somebody chose by name brings its own
   *  sidebar, whatever they had open before they chose it. */
  test('an arrangement chosen by name brings its own sidebar', async () => {
    workspace.showPanel('search')
    expect(workspace.panel).toBe('search')

    await workspace.applyLayout(drafted('tree'))

    expect(workspace.panel).toBe('tree')
  })
})

/** The other half of the same second: a note opened while the session is still
 *  being read. The arrangement used to replace what was open, so the note closed
 *  itself again a moment after it opened - which is what find-bar.py had to hold
 *  still for. */
describe('a note opened while the session is still arriving', () => {
  /** One pane holding one note, which is what a session is written as. */
  function drafted(path: string) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path,
              name: path.slice(path.lastIndexOf('/') + 1),
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  test('stays open, and stays the one in front', async () => {
    await workspace.open('/space/b.md')
    expect(workspace.active?.path).toBe('/space/b.md')

    // The session, arriving by itself with another note in it.
    await workspace.applyLayout(drafted('/space/a.md'), false)

    expect(workspace.tabs.map((tab) => tab.path)).toContain('/space/b.md')
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('is not opened twice when the session holds it too', async () => {
    await workspace.open('/space/a.md')
    await workspace.applyLayout(drafted('/space/a.md'), false)

    expect(workspace.tabs.filter((tab) => tab.path === '/space/a.md')).toHaveLength(1)
    expect(workspace.active?.path).toBe('/space/a.md')
  })

  /** And the caller that is a choice: a named arrangement is what somebody asked to
   *  see, so it still replaces whatever was open. */
  test('but an arrangement chosen by name still replaces what is open', async () => {
    await workspace.open('/space/b.md')

    await workspace.applyLayout(drafted('/space/a.md'))

    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md'])
  })
})

/** Which of a pane's notes is in front when the window comes back.
 *
 *  A pane writes down the one it was showing as an index into its own strip, since
 *  ids are handed out fresh on every run, and that index is the only record there
 *  is of it. The arrangement honoured it and then a line below reached for the
 *  first tab in the pane and put that one in front instead - so a window always
 *  came back on the first note in the strip, however long somebody had been
 *  reading the third, and a saved arrangement opened on its first note rather than
 *  the one it names.
 *
 *  Emil met it as pictures that had gone: pictures.py pasted three into a note,
 *  reloaded, and photographed the welcome note, which has none. Both callers of
 *  `applyLayout` are here because one line served both. */
describe('the note a window comes back on', () => {
  /** Two notes in one pane, with the second of them the one that was showing. */
  function drafted(active: number) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active,
          linked: false,
          tabs: ['/space/a.md', '/space/b.md'].map((path) => ({
            kind: 'note' as const,
            path,
            name: path.slice(path.lastIndexOf('/') + 1),
            doc: '',
            dirty: false,
            cursor: 0,
            scroll: 0,
          })),
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  test('is the one the session says was showing, not the first in the strip', async () => {
    await workspace.applyLayout(drafted(1), false)

    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('and the one a saved arrangement names, when that is what was chosen', async () => {
    await workspace.open('/space/c.md')

    await workspace.applyLayout(drafted(1))

    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('survives being written down and read back, which is what a restart is', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    const written = workspace.layout()

    // A window with nothing in it, which is what the arrangement arrives into.
    onePane()

    await workspace.applyLayout(written, false)

    expect(workspace.active?.path).toBe('/space/b.md')
  })

  /** And the pane that ends up showing nothing still takes the first note it has:
   *  an arrangement with no notes in it, and a note nobody saved carried into it. */
  test('is the first in the strip only where the pane was left showing nothing', async () => {
    workspace.openBlank('Untitled', '# unsaved words')

    const empty = drafted(0)
    empty.frame.pane.tabs = []
    await workspace.applyLayout(empty)

    expect(workspace.active?.doc).toBe('# unsaved words')
  })
})

describe('what a document is called on screen', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    sheet.name = null
  })

  test('is a note without its extension', async () => {
    await workspace.open('/space/a.md')
    expect(workspace.active?.shown).toBe('a')
  })

  test('is a canvas without its extension, the way a note is', async () => {
    await workspace.openCanvas('/space/plan.canvas')
    expect(workspace.active?.shown).toBe('plan')
  })

  /** A paper is a file from somewhere else with no title behind it, so its name is
   *  the file's own - the way Obsidian shows one, and the way a picture is shown.
   *  Which kind the tab holds is the mark on it. */
  test('is a paper with its extension, which is the whole of its name', () => {
    workspace.openPdf('/space/paper.pdf')
    expect(workspace.active?.shown).toBe('paper.pdf')
  })

  test('is a draft first heading, so two drafts are two names', () => {
    workspace.openBlank()
    const first = workspace.active
    workspace.openBlank()
    const second = workspace.active
    if (!first || !second) throw new Error('the drafts did not open')

    first.note.live.replace('# Groceries\n\nmilk\n')
    second.note.live.replace('notes from the call\n')

    expect(first.shown).toBe('Groceries')
    expect(second.shown).toBe('notes from the call')
  })

  test('follows the words as they are typed, without waiting for a flush', () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')

    tab.note.live.replace('# Half a th')
    expect(tab.shown).toBe('Half a th')

    tab.note.live.replace('# Half a thought')
    expect(tab.shown).toBe('Half a thought')
  })

  test('is Untitled only while the draft says nothing', () => {
    workspace.openBlank()
    expect(workspace.active?.shown).toBe('Untitled')
  })

  /** A draft is asked what it is called on every keystroke, so what it reads has
   *  to be a fixed amount of it. A page pasted out of a browser arrives as one
   *  line of a hundred thousand characters, and the first line is exactly the one
   *  a title is read from - so the bound is on characters as well as on lines.
   *
   *  Said as what it does rather than as how long it takes: a heading sitting
   *  past that many characters is not found, even though it is well within the
   *  forty lines a title may be on. See TITLE_CHARS. */
  test('reads a fixed amount of a draft, however long its first line is', () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')

    tab.note.live.replace(`${'word '.repeat(600)}\n# Buried\n`)

    expect(tab.shown).not.toBe('Buried')
    expect(tab.shown.startsWith('word word')).toBe(true)
  })

  /** A file opened from the computer in the browser build has a name of its own
   *  and no path to save back to. The name it came with wins. */
  test('is the name a draft came with, where it came with one', () => {
    workspace.openBlank('Report', '# Something else entirely\n')
    expect(workspace.active?.shown).toBe('Report')
  })

  test('is the file name again once the draft is saved', async () => {
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')
    tab.note.live.replace('# A draft\n')
    sheet.name = 'Kept'

    await workspace.save()

    expect(tab.path).toBe('/space/Kept.md')
    expect(tab.shown).toBe('Kept')
  })
})

describe('a click in the file list landing inside a gesture that re-reads the notes', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
  })

  /** Renaming a note rewrites every link to it and then brings every open note up
   *  to what is now on disk - one read per open document, which is a click's worth
   *  of time. A single click in that moment moves the preview tab on to another
   *  note, in the same document, and the read that was in the air is a read of the
   *  note it came from.
   *
   *  Those words have nowhere to go. Landing them would leave the document holding
   *  one note's text under another note's name, clean, and the next keystroke would
   *  write that pair to disk and carry it up to every other device. */
  test('does not land the note it came from in the note it moved to', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.note.text).toBe('# a')

    // The re-read of the previewed note, caught in the middle.
    let release: () => void = () => undefined
    holding.readPath = '/space/a.md'
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })

    const renaming = workspace.rename('/space/c.md', 'renamed.md')
    // Long enough for the rename to have reached the held read.
    await Promise.resolve()
    await Promise.resolve()

    // The click. One tab, one document, another note.
    const moved = await preview('/space/b.md')
    expect(moved.id).toBe(tab.id)
    expect(moved.note.path).toBe('/space/b.md')

    release()
    await renaming

    // The note that is up, and only its own words.
    expect(moved.note.path).toBe('/space/b.md')
    expect(moved.note.text).toBe('# b')
    expect(moved.note.dirty).toBe(false)
  })
})

/** The number goes before the extension, and the extension is the last dot of the
 *  file's own name. Not this store's rule any more but `freePath`'s, the one every
 *  other part of the app steps a taken name aside with; see @nib/markdown/paths. */
describe('a new file stepping aside from a name the folder already has', () => {
  const row = (path: string, children?: Entry[]): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: children !== undefined,
    modified: 0,
    created: 0,
    children: children ?? [],
  })

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
  })

  /** The path the new note was written to. */
  async function madeIn(folder: string, named: string) {
    sent.length = 0
    await workspace.createNote(folder, named)
    return sent.find((one) => one.command === 'write_note')?.path
  }

  test('takes the number in front of the extension', async () => {
    workspace.tree = row('/space', [row('/space/Plan.md')])
    expect(await madeIn('/space', 'Plan.md')).toBe('/space/Plan 2.md')
  })

  /** A name that is nothing but an extension is a name. This store's own copy read
   *  `.hidden` as an extension of nothing and wrote ` 2.hidden`, a file whose name
   *  begins with a space - the same bug the import's copy had. */
  test('and a dot-file keeps the whole of its name', async () => {
    workspace.tree = row('/space', [row('/space/.hidden')])
    expect(await madeIn('/space', '.hidden')).toBe('/space/.hidden 2')
  })

  /** The dot that counts is the file's own. A folder with a dot in its name is not
   *  an extension of the note inside it. */
  test('and a folder with a dot in its name keeps its own', async () => {
    workspace.tree = row('/space', [row('/space/v1.2', [row('/space/v1.2/Note')])])
    expect(await madeIn('/space/v1.2', 'Note')).toBe('/space/v1.2/Note 2')
  })

  /** A note named after the moment it was made steps aside the same way. Two of
   *  them in one minute is the only way the moment is taken, and this used to be the
   *  one name in the app spelled `202609130412-2.md` - a numbering nothing else
   *  writes and nothing else would predict. */
  test('and a note named after the moment reads the same rule', async () => {
    // The year rather than the minute, so the name the store will reach for is
    // known here without racing the clock for it.
    const taken = `${noteId('YYYY')}.md`
    workspace.tree = row('/space', [row(`/space/${taken}`)])

    sent.length = 0
    await workspace.createUniqueNote('YYYY', '/space')

    expect(sent.find((one) => one.command === 'write_note')?.path).toBe(
      `/space/${noteId('YYYY')} 2.md`,
    )
  })
})

describe('following a link to a note the space has not got', () => {
  /** The jump a wikilink makes when the index resolved nothing: no path of its
   *  own, only what the link said. */
  const asked = (target: string) => ({
    path: null,
    target,
    heading: null,
    block: null,
    page: null,
  })

  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tabs = []
    notes['/space/Plan.md'] = '# Plan\n\n'
    sent.length = 0
  })

  afterEach(() => {
    delete notes['/space/Plan.md']
  })

  test('makes it where the link would look for it', async () => {
    await workspace.followLink(asked('Plan'))
    expect(sent.find((one) => one.command === 'write_note')?.path).toBe('/space/Plan.md')
  })

  /** What a link says is somebody's prose: a note out of a shared space, a room, a
   *  sync pull or a paste can name a path that climbs out of the space, and the note
   *  made under that name would be a file somewhere else on the machine written
   *  over. Nothing is written and nothing is opened. */
  test('and writes nothing at all for a link that climbs out of the space', async () => {
    for (const target of [
      '../../../.bashrc',
      '..\\..\\Desktop\\evil',
      'notes/../../x',
      'C:/Windows/System32/x',
      'NUL',
    ]) {
      sent.length = 0
      workspace.tabs = []
      await workspace.followLink(asked(target))

      expect(sent, target).toEqual([])
      expect(workspace.tabs, target).toEqual([])
    }
  })
})

/** What signing in asks about, and what it must not.
 *
 *  Signing in on a machine that already holds notes asks whether they join the
 *  account or go, because nothing is erased without an answer; see settling.ts.
 *  The welcome note a browser seeds on a first visit is not such a note. It is the
 *  app's own words, syncing already refuses to carry it up (see sync/mirror.ts),
 *  and a first sign-in would otherwise be met by a question about the only thing
 *  on screen - "this cannot be undone" under it - whose two answers both come to
 *  nothing.
 *
 *  A character typed into the seed makes it writing like any other note, and then
 *  the question is right to be asked. */
describe('whether this machine holds anything worth asking about', () => {
  const SEED = '/Notes/Read me.md'
  const MINE = '/Notes/mine.md'

  const file = (path: string): Entry => ({
    name: path.split('/').pop() ?? '',
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })

  const holding = (children: Entry[]): Entry => ({
    name: 'Notes',
    path: '/Notes',
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  })

  afterEach(() => {
    delete notes['/Notes/Read me.md']
    delete notes['/Notes/mine.md']
    workspace.tree = null
  })

  test('a browser holding nothing but the seed holds nothing', async () => {
    const { WELCOME } = await import('./welcome')
    notes[SEED] = WELCOME
    workspace.tree = holding([file(SEED)])

    expect(await workspace.hasLocalContent()).toBe(false)
  })

  test('a seed somebody has typed into is writing', async () => {
    const { WELCOME } = await import('./welcome')
    notes[SEED] = `${WELCOME}and a line of my own\n`
    workspace.tree = holding([file(SEED)])

    expect(await workspace.hasLocalContent()).toBe(true)
  })

  test('and a note of their own is writing, seed beside it or not', async () => {
    const { WELCOME } = await import('./welcome')
    notes[SEED] = WELCOME
    notes[MINE] = '# Mine\n'
    workspace.tree = holding([file(SEED), file(MINE)])

    expect(await workspace.hasLocalContent()).toBe(true)
  })
})

/** Stacking is a pane's own answer: how the notes in *this* pane are laid out, which is
 *  why a long note read down the left and three short ones stacked on the right is the
 *  point of it rather than a thing the window does. */
describe('a pane that lays its notes out as columns', () => {
  test('starts as every pane starts, which is one document with a strip over it', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.stacked()).toBe(false)
    expect(workspace.panes.all[0]?.stacked).toBe(false)
  })

  test('has nothing to stack while it holds one note', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.canStack()).toBe(false)
  })

  test('and offers it once it holds two', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    expect(workspace.canStack()).toBe(true)
    workspace.toggleStacked()
    expect(workspace.stacked()).toBe(true)
    workspace.toggleStacked()
    expect(workspace.stacked()).toBe(false)
  })

  test('per pane, so the other one is left as it was', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    workspace.split('row')

    const [first, second] = workspace.panes.all
    if (!first || !second) throw new Error('the split did not happen')

    workspace.toggleStacked(first.id)

    expect(workspace.stacked(first.id)).toBe(true)
    expect(workspace.stacked(second.id)).toBe(false)
  })

  test('and never on a machine that holds one document', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    expect(workspace.canStack()).toBe(true)

    viewport.device = 'phone'
    expect(workspace.canStack()).toBe(false)
    viewport.device = 'desktop'
  })
})

/** One file, one document.
 *
 *  Opening a note reads it, and a read is a round trip: the tab that would say the
 *  file is already open is not there until it comes back. Two opens of one path that
 *  overlap therefore each built one of everything, and then one file had two
 *  documents over it - each honest about its own words, both reporting theirs as
 *  that file's, and whichever was written last was what the file ended up saying.
 *  That is one person's writing replacing another's, which is the worst thing this
 *  app can do, and it is what every test here is about. */
describe('two opens of one path', () => {
  /** The file's read, held open, so the second open begins inside the first. */
  function held(path: string): () => void {
    let release: () => void = () => undefined
    holding.readPath = path
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  }

  /** The documents open over one file. Two of them is the bug. */
  const over = (path: string) => workspace.documents.filter((one) => one.path === path)

  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
    workspace.tabs = []
  })

  test('are one open, and come to one document', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    expect(over('/space/a.md')).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('the same for a website, which is the tab Emil was switching away from', async () => {
    notes['/space/site.url'] = '[InternetShortcut]\r\nURL=https://example.com/\r\n'
    try {
      const release = held('/space/site.url')
      const both = Promise.all([
        workspace.openWeb('/space/site.url'),
        workspace.openWeb('/space/site.url'),
      ])
      release()
      await both

      expect(over('/space/site.url')).toHaveLength(1)
    } finally {
      delete notes['/space/site.url']
    }
  })

  test('and for a plane', async () => {
    const release = held('/space/plan.canvas')
    const both = Promise.all([
      workspace.openCanvas('/space/plan.canvas'),
      workspace.openCanvas('/space/plan.canvas'),
    ])
    release()
    await both

    expect(over('/space/plan.canvas')).toHaveLength(1)
  })

  /** The launch race. A session is read a note at a time and goes into the window
   *  when the last one lands, so a note clicked in that second is opened against a
   *  window that says nothing is open yet. */
  test('one of them from a session still being read', async () => {
    const drafted = {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path: '/space/a.md',
              name: 'a.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }

    const release = held('/space/a.md')
    const arriving = workspace.applyLayout(drafted, false)
    await Promise.resolve()
    // The click, while the session's own read of the same note is still in the air.
    const clicked = workspace.open('/space/a.md')
    release()
    await Promise.all([arriving, clicked])

    expect(over('/space/a.md')).toHaveLength(1)
  })

  /** The sharpest edge of it: a lookup by path answers the first document it finds,
   *  so words that arrive for a file reach one of the two and the other keeps its
   *  own - dirty, and on its way back over the file at the next save. */
  test('so words arriving for the file reach every pane showing it', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    // Another program wrote the file, or a sync brought it over.
    workspace.reload('/space/a.md', '# a, from elsewhere')
    workspace.flush()

    for (const note of over('/space/a.md')) {
      expect(note.text).toBe('# a, from elsewhere')
      expect(note.dirty).toBe(false)
    }
  })

  /** And the fourth of them: a room is named after the document, so two documents
   *  over one file were two of this device's own clients in one room, seeded from
   *  texts that had already parted company. */
  test('and one file is one room, because it is one document', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    const keys = workspace.openNotes.filter((one) => one.path === '/space/a.md')
    expect(keys).toHaveLength(1)
  })
})

/** A path that changes moves the document rather than leaving a second one at the
 *  name it had. Every one of these is the same gesture underneath - the document's
 *  own `path` is the only place a file's name is written down - which is why there
 *  is nothing here to keep in step. */
describe('a file that changes its name', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/renamed.md']
  })

  test('takes its document with it', async () => {
    await workspace.open('/space/a.md')
    const note = workspace.documentAt('/space/a.md')
    expect(note).not.toBeNull()

    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')

    expect(workspace.documentAt('/space/a.md')).toBeNull()
    expect(workspace.documentAt('/space/renamed.md')).toBe(note)
  })

  /** And opening it under the new name is opening what is open, not a second
   *  document over the same file. */
  test('so opening it again under that name opens what is open', async () => {
    await workspace.open('/space/a.md')
    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')

    await workspace.open('/space/renamed.md')

    expect(workspace.documents.filter((one) => one.path === '/space/renamed.md')).toHaveLength(1)
  })
})

/** A website written when a website was a note is a `.md` file with `url:` at the
 *  top of it, and which opener its row runs depends on whether the link index has
 *  read it yet: as a note until the pass catches up, as a website afterwards. So one
 *  file can be asked for as a note and then as a website within a sitting.
 *
 *  That used to make two documents over it - the note's words in one, the shortcut's
 *  three lines in the other - and the conversion rewrote the file under the note
 *  that was still open on it. Emil: *"switched from a web note tab to a normal note
 *  tab and then it had some strange web note tab content in it."* */
describe('a file asked for as a note and then as a website', () => {
  const WEB_NOTE = '/space/site.md'

  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    notes[WEB_NOTE] = '---\nurl: https://example.com/\n---\n\n# The site\n'
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/site.md']
  })

  test('is one document, and the open one is what comes forward', async () => {
    await workspace.open(WEB_NOTE)
    const note = workspace.documentAt(WEB_NOTE)
    sent.length = 0

    await workspace.openWeb(WEB_NOTE)

    expect(workspace.documents.filter((one) => one.path === WEB_NOTE)).toHaveLength(1)
    expect(workspace.documentAt(WEB_NOTE)).toBe(note)
    // And nothing was written under the document that was open on it.
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

/** The one tab that previews a note moves its document on to whatever is clicked
 *  next, which is a document arriving at a path rather than being opened at it. A
 *  note that is already open is never the one it moves on to: the pane showing it
 *  comes forward instead. */
describe('a preview landing on a note that is already open', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
  })

  test('brings that note forward rather than taking it on', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.documentAt('/space/a.md')

    const previewed = await preview('/space/b.md')
    await workspace.open('/space/a.md', { preview: true })

    expect(workspace.documents.filter((one) => one.path === '/space/a.md')).toHaveLength(1)
    expect(workspace.documentAt('/space/a.md')).toBe(first)
    // The preview tab is still on the note it was previewing.
    expect(previewed.path).toBe('/space/b.md')
  })
})
