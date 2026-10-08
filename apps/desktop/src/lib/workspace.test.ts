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

/** One of those files, which is what "outside" means: nothing but this disk is
 *  holding it, and something else may be writing it too. */
const OUTSIDE = '/elsewhere/outside.md'

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

/** This device's Recently deleted, as the crate keeps it: what a closed tab with no
 *  file left there. */
const trash: { id: string; path: string; content: string }[] = []

// The desktop app, the one build that holds a web note's page in a tab of its own;
// see `openWeb` in the workspace.
vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: pathOf(args),
      content: typeof args?.content === 'string' ? args.content : '',
    })

    // The crate's judge: nib opens nothing from outside its spaces but its own two
    // settings files, and the stamp is where the window asks; see `openable`.
    if (command === 'file_stamp' && pathOf(args).startsWith('/elsewhere/')) {
      throw new Error(`${pathOf(args)} is outside the notes folder`)
    }
    if (command === 'write_note' && holding.write) await holding.write
    if (command === 'trash_words') {
      const id = `t${String(trash.length + 1)}`
      trash.push({ id, path: pathOf(args), content: String(args?.content) })
      return { id }
    }
    if (command === 'list_trash') return trash.map((one) => ({ id: one.id }))
    if (command === 'purge_trash') {
      const at = trash.findIndex((one) => one.id === args?.id)
      if (at >= 0) trash.splice(at, 1)
      return undefined
    }
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

/** The sheet, scripted: every question is answered from here and written down, so a
 *  test can say that nothing was asked - which, now that nothing is ever saved by hand,
 *  is what closing a tab, a pane or the window must come to. */
const sheet = {
  asked: [] as string[],
  /** What `choose` answers, or null for dismissed. */
  answer: null as string | null,
}

vi.mock('./prompt.svelte', () => ({
  prompt: {
    choose: (options: { title: string }) => {
      sheet.asked.push(options.title)
      return Promise.resolve(sheet.answer)
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
const { pages } = await import('./web-tab/pages.svelte')
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')
const ops = await import('./tab-strip/ops')
const { Tab } = await import('./workspace/documents.svelte')
const { isDraft } = await import('./workspace/drafts')
const { STARTS_RIGHT } = await import('./workspace/panels')
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

afterEach(async () => {
  // Whatever a test typed goes down before the next one runs, rather than landing
  // in the middle of it: the next tab brought forward writes everything waiting.
  holding.write = null
  holding.read = null
  await workspace.writesSettled()

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

  test('is what Ctrl+S does, even with nothing to write', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.dirty).toBe(false)

    await workspace.writeNow()
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

/** Emil: "browser tabs should open in the same italic way with the same behaviour
 *  as notes when just clicked". One preview for every kind of file, so a website, a
 *  plane, a page note and a paper clicked past in the list take one tab between them
 *  and the note they are clicked past to. */
describe('previewing every kind of file', () => {
  const SITE = '/space/site.url'
  const OTHER_SITE = '/space/other.url'
  const DECK = '/space/deck.pages'
  const PAPER = '/space/paper.pdf'
  const PLANE = '/space/plan.canvas'

  /** A single click on a row of the list, whatever the row is. */
  async function look(path: string) {
    await workspace.openEntry(path, { preview: true })
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)
    return tab
  }

  const paths = () => workspace.tabs.map((one) => one.path)

  beforeEach(() => {
    notes[SITE] = '[InternetShortcut]\r\nURL=https://example.com/\r\n'
    notes[OTHER_SITE] = '[InternetShortcut]\r\nURL=https://example.org/\r\n'
    notes[DECK] = '{}'
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/site.url']
    delete notes['/space/other.url']
    delete notes['/space/deck.pages']
    vi.restoreAllMocks()
  })

  test('a website clicked in the list is the preview', async () => {
    const tab = await look(SITE)

    expect(tab.kind).toBe('web')
    expect(workspace.previewTabId).toBe(tab.id)
  })

  test('the next website takes its place, and the page goes with the tab', async () => {
    const forget = vi.spyOn(pages, 'forget')
    const first = await look(SITE)
    const second = await look(OTHER_SITE)

    expect(paths()).toEqual([OTHER_SITE])
    expect(workspace.previewTabId).toBe(second.id)
    expect(forget).toHaveBeenCalledWith(first.id)
  })

  test('a note takes a previewed website’s place in the strip, and the other way', async () => {
    await workspace.open('/space/a.md')
    await look(SITE)
    await workspace.open('/space/c.md')
    expect(paths()).toEqual(['/space/a.md', SITE, '/space/c.md'])

    const note = await look('/space/b.md')
    expect(paths()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.previewTabId).toBe(note.id)

    await look(OTHER_SITE)
    expect(paths()).toEqual(['/space/a.md', OTHER_SITE, '/space/c.md'])
  })

  test('a plane, a page note and a paper are previews like the rest', async () => {
    await look(PLANE)
    expect(paths()).toEqual([PLANE])

    await look(DECK)
    expect(paths()).toEqual([DECK])

    const paper = await look(PAPER)
    expect(paths()).toEqual([PAPER])
    expect(workspace.previewTabId).toBe(paper.id)
  })

  test('a replaced preview is nothing the closed stack brings back', async () => {
    const record = vi.spyOn(workspace.closed, 'record')
    await look(SITE)
    await look('/space/a.md')

    expect(record).not.toHaveBeenCalled()
  })

  test('opening the website for real keeps it, the double click on its row', async () => {
    const tab = await look(SITE)
    await workspace.openEntry(SITE)

    expect(workspace.previewTabId).toBeNull()
    await look('/space/a.md')
    expect(paths()).toEqual([SITE, '/space/a.md'])
    expect(workspace.tabs[0]?.id).toBe(tab.id)
  })

  test('the same for a paper, which opens without reading anything', async () => {
    await look(PAPER)
    workspace.openPdf(PAPER)

    expect(workspace.previewTabId).toBeNull()
  })

  test('an address typed into the bar keeps it', async () => {
    const tab = await look(SITE)
    await workspace.webAimed(tab, 'https://example.com/elsewhere')

    expect(workspace.previewTabId).toBeNull()
  })

  test('a pinned website is kept, and the next look gets a tab of its own', async () => {
    const tab = await look(SITE)
    workspace.togglePin(tab.id)
    await look('/space/a.md')

    expect(paths()).toEqual([SITE, '/space/a.md'])
    workspace.togglePin(tab.id)
  })

  test('drawing on a previewed plane keeps it, the way typing keeps a note', async () => {
    const tab = await look(PLANE)
    tab.note.live.replace(`${DRAWN} `)

    expect(workspace.previewTabId).toBeNull()
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

describe('the right side’s button', () => {
  beforeEach(() => {
    workspace.right = [...STARTS_RIGHT]
    workspace.rightPanel = null
    workspace.lastRight = null
    workspace.panel = null
  })

  test('opens the side on its first panel and shuts it again', () => {
    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('outline')
    expect(workspace.panel).toBeNull()

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBeNull()
  })

  test('comes back to whatever the side showed last', () => {
    workspace.showPanel('ask')
    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBeNull()

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('ask')
  })

  test('and to its first panel once that one has moved to the other side', () => {
    workspace.showPanel('properties')
    workspace.movePanel('properties', 'left')
    workspace.closePanel('right')

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('outline')
  })

  test('a key for a panel on the right opens it there, whichever side is open', () => {
    workspace.showPanel('tree')
    workspace.showPanel('links')

    expect(workspace.openOn('left')).toBe('tree')
    expect(workspace.openOn('right')).toBe('links')
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

describe('a note found in the file list', () => {
  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.device.expanded = {}
    workspace.panel = null
    workspace.revealing = null
  })

  afterEach(() => {
    workspace.activeSpaceId = null
  })

  test('unfolds the rows above it, shows the list and asks for its row', () => {
    workspace.revealNote('/space/work/plans/q3.md')

    expect(workspace.device.expanded).toEqual({ '/space/work': true, '/space/work/plans': true })
    expect(workspace.panel).toBe('tree')
    expect(workspace.revealing).toBe('/space/work/plans/q3.md')
  })

  /** Its folder's row is the note, so that row is found without unfolding it. */
  test('a note its folder is drawn as unfolds only what holds that folder', () => {
    workspace.revealNote('/space/work/plans/plans.md')
    expect(workspace.device.expanded).toEqual({ '/space/work': true })

    workspace.device.expanded = {}
    workspace.revealNote('/space/work/work.md')
    expect(workspace.device.expanded).toEqual({})
  })

  test('a note outside the space is nowhere in the list to be found', () => {
    workspace.revealNote('/elsewhere/outside.md')

    expect(workspace.revealing).toBeNull()
    expect(workspace.panel).toBeNull()
  })

  test('and folding the list shuts the rows of this space only', () => {
    workspace.device.expanded = { '/space/work': true, '/other/x': true }
    expect(workspace.unfolded).toBe(true)

    workspace.foldList()

    expect(workspace.device.expanded).toEqual({ '/other/x': true })
    expect(workspace.unfolded).toBe(false)
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

  test('opens to the side, leaving the pane in front on what it showed', async () => {
    await workspace.open('/space/a.md')
    const [first] = workspace.panes.all

    await workspace.openAside('/space/b.md')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.showing(first?.id ?? '')?.path).toBe('/space/a.md')
    expect(workspace.active?.path).toBe('/space/b.md')
    expect(workspace.active?.paneId).not.toBe(first?.id)
  })

  test('opens a note already open to the side as a second view of it', async () => {
    await workspace.open('/space/a.md')
    const shown = workspace.active

    await workspace.openAside('/space/a.md')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.active?.note).toBe(shown?.note)
    expect(workspace.active?.id).not.toBe(shown?.id)
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

  test('is one note and one write, whichever pane it was typed in', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const [left, right] = workspace.tabs
    if (!left || !right) throw new Error('the split did not happen')

    sent.length = 0
    left.note.live.replace('# a, typed in one pane')
    expect(right.dirty).toBe(true)

    await workspace.writesSettled()
    expect(right.doc).toBe(left.doc)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: '/space/a.md', content: '# a, typed in one pane' },
    ])
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

  /** What Emil asked for: the cross is gone and the deliberate ways are not. This
   *  used to refuse, so a tab pinned in the morning could not be closed at all until
   *  it was let go of. Ctrl+W asks first; see pinned-close.effect.test.ts. */
  test('closes when the row in its own menu asks', async () => {
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

    await workspace.closeAround(id('/space/a.md'), 'others')

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

  /** The pane that stays names no tab. It went on naming the last one it had shown,
   *  which nothing drew but Cmd+W read: on a Mac that key closes a window with
   *  nothing left in it, and it went on closing a tab that was no longer there. */
  test('and the pane that stays names no tab as the one it shows', async () => {
    await workspace.open('/space/a.md')
    const [only] = workspace.tabs
    if (only) workspace.close(only.id)

    expect(workspace.activeTabId).toBeNull()
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

  test('keeps a note whose words are not on the disk yet rather than dropping it', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('one up')

    onePane()
    await workspace.open('/space/b.md')
    workspace.active?.note.live.replace('# unwritten words')
    await workspace.useLayout('one up')

    expect(workspace.tabs.some((tab) => tab.doc === '# unwritten words')).toBe(true)
  })

  test('comes back from its file where the words are too many to copy', async () => {
    await workspace.open('/space/b.md')
    workspace.active?.note.live.replace(`# long\n${'x'.repeat(1_000_000)}`)

    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)

    expect(workspace.active?.dirty).toBe(true)
    expect(drafts.map((draft) => [draft.doc, draft.dirty])).toEqual([['', false]])
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

/** Closing never asks. Every note writes itself a moment after its last keystroke,
 *  so there is nothing a question on the way out could be about: whatever a tab was
 *  waiting to write goes down as it closes, and a pane and the window go the same
 *  way. Emil, 2026-09-30: *"I don't want there to be any manual saving anymore. Only
 *  autosaving, that's it."* */
describe('closing, which never asks anything', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    sheet.asked = []
    sheet.answer = 'cancel'
    sent.length = 0
  })

  /** A note open with something typed into it that has not been written. */
  async function dirty(path: string) {
    await workspace.open(path)
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)

    tab.note.live.replace(`${notes[path] ?? ''}, typed`)
    return tab
  }

  const written = () =>
    sent.filter((one) => one.command === 'write_note').map((one) => [one.path, one.content])

  test('writes what a tab was typing as it closes, and asks nothing', async () => {
    const tab = await dirty('/space/a.md')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([['/space/a.md', '# a, typed']])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('closes an empty new note without a word, and writes nothing', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  test('closes a pane and everything in it, writing what was typed', async () => {
    await workspace.open('/space/a.md')
    await beside(OUTSIDE)
    const paneId = workspace.panes.focusedId
    await dirty(OUTSIDE)

    await workspace.closePane(paneId)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.map((one) => one.path)).toEqual(['/space/a.md'])
    expect(written()).toEqual([[OUTSIDE, '# outside, typed']])
  })

  /** The window waits for its writes before it goes; see start.ts. */
  test('and the window going has nothing left to wait for once the writes are down', async () => {
    await dirty('/space/a.md')
    await dirty('/space/b.md')

    expect(workspace.writing).toBe(true)
    await workspace.writesSettled()

    expect(workspace.writing).toBe(false)
    expect(sheet.asked).toEqual([])
    expect(
      written()
        .map(([path]) => path)
        .sort(),
    ).toEqual(['/space/a.md', '/space/b.md'])
  })
})

/** A tab with no file, of every kind there is.
 *
 *  Emil, 2026-09-14: *"if you create a new webnote by clicking the plus for a new tab,
 *  then it should open it as a tab and not create it in the sidebar. Same for canvas and
 *  page notes."* And 2026-09-30: no saving at all. So a new note, plane or deck is a
 *  tab and nothing else until something is put in it, and then it is a file in the
 *  space with no question asked. A web tab is a browser tab: nothing is written until
 *  somebody keeps it. */
describe('a new tab', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    workspace.tree = null
    sheet.asked = []
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

  /** A tab and nothing else, however much is in it, until somebody gives it a place:
   *  the words are the session's, the way VS Code's hot exit keeps an untitled editor. */
  test('a note stays a tab with no file however much is written, and asks nothing', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    tab.note.live.replace('# Weekly review\n\nwords')
    await vi.advanceTimersByTimeAsync(2500)
    await workspace.writesSettled()

    expect(tab.path).toBeNull()
    expect(written()).toEqual([])
    expect(sheet.asked).toEqual([])
    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)
    expect(drafts[0]?.doc).toBe('# Weekly review\n\nwords')
  })

  test('saved, is a file where it is put, under the name given, in the same tab', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Weekly review\n\nwords')

    const saved = await workspace.save(tab, '/space', 'Review.md')

    expect(saved).toBe('/space/Review.md')
    expect(workspace.active).toBe(tab)
    expect(tab.path).toBe('/space/Review.md')
    expect(written().map((one) => [one.path, one.content])).toEqual([
      ['/space/Review.md', '# Weekly review\n\nwords'],
    ])
  })

  /** Where a new note has always gone, and under its first line, when nobody says. */
  test('saved with nothing said, goes to the root of the space it was opened in', async () => {
    workspace.spaces = [
      { id: 's', name: 'Notes', root: '/space' },
      { id: 't', name: 'Other', root: '/other' },
    ]
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Weekly review')
    workspace.activeSpaceId = 't'

    await workspace.save(tab)

    expect(tab.path).toBe('/space/Weekly review.md')
  })

  /** An import and a file uploaded into the browser arrive with words and a name,
   *  and are files from the start. */
  test('that arrives with words is a file at once, under the name it came with', async () => {
    workspace.openBlank('Report', '# Quarterly\n\nwords')
    await vi.advanceTimersByTimeAsync(0)
    await workspace.writesSettled()

    expect(workspace.active?.path).toBe('/space/Report.md')
    expect(written().map((one) => one.path)).toEqual(['/space/Report.md'])
  })

  test('never writes over a file the folder already has', async () => {
    workspace.tree = {
      name: 'space',
      path: '/space',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        { name: 'W.md', path: '/space/W.md', is_dir: false, modified: 0, created: 0, children: [] },
      ],
    }
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('W')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/W 2.md')
    workspace.tree = null
  })

  test('a plane saved is written as it stands, as Untitled', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/Untitled.canvas')
    expect(written().map((one) => one.path)).toEqual(['/space/Untitled.canvas'])
  })

  test('closes without a word while nothing has been drawn on it, and leaves nothing', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
    expect(written()).toEqual([])
    expect(workspace.closed.any).toBe(false)
  })

  /** A browser closes a tab without a question; the words are kept twice over. */
  test('closed with words asks nothing, and keeps them for Ctrl+Shift+T and Recently deleted', async () => {
    trash.length = 0
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Plan\n\nwords')

    workspace.close(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.at(-1)?.trashed).toBe('t1'))

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([])
    expect(trash).toEqual([{ id: 't1', path: '/space/Plan.md', content: '# Plan\n\nwords' }])

    await workspace.reopenClosed()

    const back = workspace.tabs.at(-1)
    expect(back?.doc).toBe('# Plan\n\nwords')
    expect(back?.path).toBeNull()
    // Back in the tab, and so no longer in Recently deleted as well.
    expect(trash).toEqual([])
  })

  /** Put back as a note from Recently deleted, it is a note in the space now, and the
   *  closed tab is not a second copy of it to reopen. */
  test('restored from Recently deleted, is not reopened as well', async () => {
    trash.length = 0
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Plan')
    workspace.close(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.at(-1)?.trashed).toBe('t1'))

    trash.length = 0
    await workspace.reopenClosed()

    expect(workspace.tabs).toEqual([])
  })

  /** A web tab closes like a browser tab: no question, whatever the page is. */
  test('while a website closes without a question either way', () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.close(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  /** The shortcut holds the address the tab is on and is named after the page. See
   *  web-tab/shortcut.ts. */
  test('a website is saved as a shortcut holding the address it is on', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.com/a'
    pages.of(tab.id).title = 'Example: the page'

    await workspace.writeNow()
    expect(written()).toEqual([])

    await workspace.save(tab)

    const wrote = written()
    expect(wrote.map((one) => one.path)).toEqual(['/space/Example the page.url'])
    expect(wrote[0]!.content).toContain('URL=https://example.com/a')
    // The same tab, in place: what changed is which file the document is of.
    expect(tab.path).toBe('/space/Example the page.url')
  })

  test('and under the name and in the place given', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.com/a'

    await workspace.save(tab, '/space/Reading', 'Later.url')

    expect(tab.path).toBe('/space/Reading/Later.url')
    expect(written()[0]!.content).toContain('Title=Later')
  })

  /** One file is one document, and keeping a website is a document being given a
   *  file - the one place in the app where that happens to a document that already
   *  exists. A listing is a round trip behind what is open, so two tabs kept in the
   *  same instant once read the same listing and were handed the same name. The name
   *  is asked for at the moment of writing, against what is open as well as what is
   *  listed, and claimed before the write begins. See workspace/open.ts. */
  test('never lands two websites on one file', async () => {
    workspace.openWebsite()
    const first = workspace.active
    workspace.openWebsite()
    const second = workspace.active
    if (!first || !second || first.id === second.id) throw new Error('two tabs did not open')

    first.address = 'https://example.com/a'
    second.address = 'https://example.com/b'
    pages.of(first.id).title = 'Example'
    pages.of(second.id).title = 'Example'

    await Promise.all([workspace.save(first), workspace.save(second)])

    expect(first.path).toBe('/space/Example.url')
    expect(second.path).toBe('/space/Example 2.url')
    expect(workspace.documentAt('/space/Example.url')).toBe(first.note)
    expect(written().map((one) => one.path)).toEqual(['/space/Example.url', '/space/Example 2.url'])
  })

  test('a website saved twice from one tab is one file', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    pages.of(tab.id).title = 'Example'

    await Promise.all([workspace.save(tab), workspace.save(tab)])

    expect(written().map((one) => one.path)).toEqual(['/space/Example.url'])
  })

  /** Emil, 2026-10-03: *"Still getting a lot of name-clash files for web notes."* A
   *  page kept under the name of a web note on the same site, that no tab is showing,
   *  is that note written again; a `Example 2.url` beside it is a clash file by another
   *  name. See `keepWeb` in workspace/placing.ts. */
  test('a website kept under the name of a web note on its own site is that note', async () => {
    notes['/space/Example.url'] =
      '[InternetShortcut]\r\nURL=https://www.example.com/\r\nTitle=Example\r\nNib-Added=2026-09-01T00:00:00.000Z\r\nNib-Icon=data:kept\r\n'
    try {
      workspace.openWebsite()
      const tab = workspace.active
      if (!tab) throw new Error('nothing opened')
      tab.address = 'https://example.com/b'

      await workspace.save(tab, '/space', 'Example.url')

      expect(tab.path).toBe('/space/Example.url')
      const wrote = written()[0]!.content
      expect(wrote).toContain('URL=https://example.com/b')
      expect(wrote).toContain('Nib-Added=2026-09-01T00:00:00.000Z')
      expect(wrote).toContain('Nib-Icon=data:kept')
    } finally {
      delete notes['/space/Example.url']
    }
  })

  /** A browser brings back the tabs it had, and so does this: the words of a document
   *  with no file exist in the session and nowhere else. See `draftOf`. */
  test('an untouched one comes back after a restart', async () => {
    await workspace.newPages()

    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)
    expect(drafts[0]?.doc.length).toBeGreaterThan(0)
  })
})

describe('a note writes itself, wherever it is', () => {
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
    await workspace.writesSettled()
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

  test('a note in a space goes down well inside a second of the typing pausing', async () => {
    const tab = await typedIn('/space/a.md')

    await vi.advanceTimersByTimeAsync(400)

    expect(written()).toEqual(['/space/a.md'])
    expect(tab.dirty).toBe(false)
  })

  test('signing out changes nothing about it: a space is a space', async () => {
    // Nothing here has ever been told about an account, which is the state a
    // browser on a first visit and a desktop nobody has signed in on are both in.
    await typedIn(WELCOME)

    await vi.advanceTimersByTimeAsync(400)

    expect(written()).toEqual([WELCOME])
    expect(workspace.outside(WELCOME)).toBe(false)
  })

  test('a file typed in while it was being written is written again', async () => {
    const tab = await typedIn('/space/a.md')

    // Writing a file is a round trip, and a keystroke can land inside it. What
    // went down is the words as they were when the write began; the ones typed
    // after that are the next write's.
    let release: () => void = () => undefined
    holding.write = new Promise<void>((resolve) => {
      release = resolve
    })

    const writing = workspace.writeNow()
    await vi.advanceTimersByTimeAsync(0)
    tab.note.live.edit([{ from: 0, to: 0, insert: 'typed during the write\n' }])
    release()
    await writing
    holding.write = null

    // Ctrl+S waits for everything owed, the keystroke from inside its own write too.
    expect(tab.dirty).toBe(false)
    expect(written()).toEqual(['/space/a.md', '/space/a.md'])
  })

  test('Ctrl+S stays harmless: it writes at once and keeps the preview tab', async () => {
    const tab = await preview('/space/a.md')
    tab.note.live.replace('# a, typed')

    await workspace.writeNow()

    expect(written()).toEqual(['/space/a.md'])
    expect(workspace.previewTabId).toBeNull()
    expect(sheet.asked).toEqual([])
  })

  /** A rename landing inside a write used to move the file out from under it, and
   *  the write put the old name back beside the new one. */
  test('a rename during a write waits for it, and one file is left, with the words', async () => {
    const tab = await typedIn('/space/a.md')

    let release: () => void = () => undefined
    holding.write = new Promise<void>((resolve) => {
      release = resolve
    })

    const writing = workspace.writeNow()
    await vi.advanceTimersByTimeAsync(0)
    const renaming = workspace.rename('/space/a.md', 'Renamed.md')
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.some((one) => one.command === 'rename_note')).toBe(false)

    release()
    await Promise.all([writing, renaming])
    holding.write = null

    const order = sent
      .filter((one) => one.command === 'write_note' || one.command === 'rename_note')
      .map((one) => one.command)
    expect(order).toEqual(['write_note', 'rename_note'])
    expect(tab.path).toBe('/space/Renamed.md')
  })

  test('file recovery is offered a version of every note with a file', async () => {
    await typedIn('/space/a.md')
    await typedIn(OUTSIDE)
    // Nowhere to keep a version of, so nothing to offer.
    workspace.openBlank()

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

  test('brings back what was typed a moment before it closed', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# a, typed just now')

    workspace.close(tab.id)
    await workspace.reopenClosed()

    expect(workspace.active.doc).toBe('# a, typed just now')
    await workspace.writesSettled()
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

/** A sitting written by an older nib, which opened files from anywhere on the disk.
 *  nib opens nothing from outside its spaces now, so a tab on such a file does not
 *  come back - not clean, not with words unwritten in it, not as a paper - and the
 *  rest of the sitting does. The app's own settings files are the exception the
 *  crate makes, and they come back. */
describe('a tab on a file outside every space, after the update', () => {
  function drafted(tabs: { kind: 'note' | 'pdf'; path: string; dirty?: boolean }[]) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: tabs.map(({ kind, path, dirty = false }) => ({
            kind,
            path,
            name: path.slice(path.lastIndexOf('/') + 1),
            doc: dirty ? '# typed' : '',
            dirty,
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
  })

  test('is left out quietly, and the rest of the sitting comes back', async () => {
    notes['/config/custom.css'] = 'body {}'
    await workspace.applyLayout(
      drafted([
        { kind: 'note', path: OUTSIDE },
        { kind: 'note', path: '/space/a.md' },
        { kind: 'note', path: '/elsewhere/beside it.md', dirty: true },
        { kind: 'pdf', path: '/elsewhere/paper.pdf' },
        { kind: 'note', path: '/config/custom.css' },
      ]),
      false,
    )

    expect(workspace.tabs.map((one) => one.path)).toEqual(['/space/a.md', '/config/custom.css'])
    // Nothing of the file was read, and nothing was written over it.
    const touched = sent.filter((one) => one.path.startsWith('/elsewhere/'))
    expect(touched.map((one) => one.command)).not.toContain('read_note')
    expect(touched.map((one) => one.command)).not.toContain('write_note')
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
   *  an arrangement with no notes in it, and a note whose words were not on the disk
   *  yet carried into it. */
  test('is the first in the strip only where the pane was left showing nothing', async () => {
    await workspace.open('/space/c.md')
    workspace.active?.note.live.replace('# unwritten words')

    const empty = drafted(0)
    empty.frame.pane.tabs = []
    await workspace.applyLayout(empty)

    expect(workspace.active?.doc).toBe('# unwritten words')
  })
})

describe('what a document is called on screen', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
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

  test('is its file name once the draft is saved, and the new one once renamed', async () => {
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')
    tab.note.live.replace('# A draft: first\n')
    expect(tab.shown).toBe('A draft: first')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/A draft first.md')
    expect(tab.shown).toBe('A draft first')

    await workspace.rename('/space/A draft first.md', 'Kept.md')
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
 *  app's own words, syncing already refuses to carry it up (see sync/pass.ts),
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

  /** Every way a path changes owes the bookmarks what it owes the tabs and the
   *  index. A bookmark keeps the path it was made with, so a note renamed, dragged
   *  into a folder or put back by an undo left its bookmark on a name nothing
   *  answered to, and its row was gone from the list. */
  test('takes its bookmark with it, and an undo takes it back', async () => {
    const mark = (path: string) => ({ kind: 'note' as const, path, text: '' })
    workspace.bookmarks.toggle(mark('a.md'))

    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')
    expect(workspace.bookmarks.has(mark('renamed.md'))).toBe(true)
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(false)

    await workspace.undoFileAction()
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(true)

    await workspace.move('/space/a.md', '/space/deep')
    expect(workspace.bookmarks.has(mark('deep/a.md'))).toBe(true)

    await workspace.undoFileAction()
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(true)
    workspace.bookmarks.toggle(mark('a.md'))
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

/** A website the app writes itself is a file `[[its name]]` reaches the moment it is
 *  written, like a note is. Nothing rescans a space while it is open, so the index
 *  knows what the writer tells it - and the website made from the file list, the
 *  address typed into its bar and the Ctrl+S that first saves one all wrote straight
 *  to the disk and told it nothing: `[[Docs]]` found no Docs until the next launch. */
describe('a website the app writes', () => {
  const LINKING = '/space/One.md'

  beforeEach(async () => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    // The launch's turns, taken at once: the index reads a space after the first
    // paint, and a test has no paint to wait for.
    void startup.shown()
    await links.build('/space')
    links.noteSaved(LINKING, 'see [[Docs]] and [[Docs.url]]')
  })

  afterEach(() => {
    workspace.tabs = []
    links.noteGone(LINKING)
    startup.reset()
  })

  const linkedFrom = (path: string) => links.backlinks(path).map((one) => one.path)

  test('is linked the moment the file list makes it', async () => {
    await workspace.createWebsite('/space', 'Docs.url')

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
  })

  // A file the scan never saw - one a sync brought down after it - is the index's to
  // hear about the moment the app writes it, and aiming the bar writes it.
  test('and is linked once its bar is aimed somewhere', async () => {
    notes['/space/Docs.url'] = '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n'
    await workspace.openWeb('/space/Docs.url')
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    expect(links.fileNamed('Docs.url')).toBeNull()

    await workspace.webAimed(tab, 'https://svelte.dev/docs')

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
    delete notes['/space/Docs.url']
  })

  test('and is linked once a tab nobody had kept is saved', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    tab.address = 'https://svelte.dev/'
    pages.of(tab.id).title = 'Docs'

    await workspace.save(tab)

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
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

/** The rows of a tab's own menu that act on more than the tab: Chrome's, VS Code's
 *  and Obsidian's, which nib's menu had only two of. See tab-strip/menu.ts. */
describe('what a tab s own menu does to the strip', () => {
  const entry = (path: string, children: Entry[] = [], isDir = false): Entry => ({
    name: path.split('/').pop() ?? path,
    path,
    is_dir: isDir,
    modified: 0,
    created: 0,
    children,
  })

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)

  async function opened(...paths: string[]): Promise<(path: string) => string> {
    for (const path of paths) await workspace.open(path)

    return (path: string) => {
      const tab = workspace.tabs.find((one) => one.path === path)
      if (!tab) throw new Error(`${path} is not open`)
      return tab.id
    }
  }

  test('closes the tabs to the right of one, and leaves it in front', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')

    await workspace.closeAround(id('/space/a.md'), 'right')

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.active?.path).toBe('/space/a.md')
  })

  test('closes every tab of the strip but a pinned one', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')
    workspace.togglePin(id('/space/b.md'))

    await workspace.closeAround(id('/space/c.md'), 'all')

    expect(strip()).toEqual(['/space/b.md'])
  })

  test('says how many tabs each close would take', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')

    expect(workspace.closesAround(id('/space/c.md'), 'right')).toBe(0)
    expect(workspace.closesAround(id('/space/a.md'), 'right')).toBe(2)
    expect(workspace.closesAround(id('/space/a.md'), 'all')).toBe(3)
  })

  /** Chrome's duplicate: right after the tab, in front, at the same place. */
  test('duplicates a tab right after it, on the same document and the same place', async () => {
    const id = await opened('/space/a.md', '/space/b.md')
    const original = workspace.tabs.find((one) => one.id === id('/space/a.md'))
    if (!original) throw new Error('nothing opened')
    workspace.noteView(original.id, 2, 40, 1)

    ops.duplicateTab(original.id)

    expect(strip()).toEqual(['/space/a.md', '/space/a.md', '/space/b.md'])
    const copy = workspace.active
    expect(copy?.id).not.toBe(original.id)
    expect(copy?.note).toBe(original.note)
    expect(copy?.cursor).toBe(2)
  })

  test('duplicates a pinned tab as a pinned one', async () => {
    const id = await opened('/space/a.md', '/space/b.md')
    workspace.togglePin(id('/space/b.md'))

    ops.duplicateTab(id('/space/b.md'))

    expect(workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.pinned)).toEqual([
      true,
      true,
      false,
    ])
  })

  test('does not duplicate the graph, which is one to a pane', () => {
    workspace.openGraph()
    const graph = workspace.active
    if (!graph) throw new Error('no graph')

    ops.duplicateTab(graph.id)

    expect(workspace.tabs).toHaveLength(1)
  })

  /** VS Code's "move editor into next group", which makes the group when there is
   *  none. */
  test('moves a tab into a new pane beside its own when there is no other', async () => {
    const id = await opened('/space/a.md', '/space/b.md')

    ops.moveToOtherPane(id('/space/b.md'))

    expect(workspace.panes.count).toBe(2)
    const [left, right] = workspace.panes.all
    expect(workspace.tabsIn(left?.id ?? '').map((tab) => tab.path)).toEqual(['/space/a.md'])
    expect(workspace.tabsIn(right?.id ?? '').map((tab) => tab.path)).toEqual(['/space/b.md'])
    expect(workspace.panes.focusedId).toBe(right?.id)
  })

  test('moves a tab into the other pane, and the pane it leaves empty goes', async () => {
    const id = await opened('/space/a.md', '/space/b.md')
    ops.moveToOtherPane(id('/space/b.md'))

    ops.moveToOtherPane(id('/space/b.md'))

    expect(workspace.panes.count).toBe(1)
    expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
  })

  test('does not move the only tab of the only pane anywhere', async () => {
    const id = await opened('/space/a.md')

    expect(workspace.canMoveToOtherPane(id('/space/a.md'))).toBe(false)
    ops.moveToOtherPane(id('/space/a.md'))
    expect(workspace.panes.count).toBe(1)
  })

  /** Renaming from a tab is renaming on the file's own row, with the list brought
   *  out and the folder down to the row opened. */
  test('renames on the file s own row, with the file list out and its folder open', async () => {
    workspace.tree = entry(
      '/space',
      [entry('/space/a.md'), entry('/space/f', [entry('/space/f/b.md')], true)],
      true,
    )
    workspace.closePanel('left')
    notes['/space/f/b.md'] = '# b'
    const id = await opened('/space/f/b.md')

    ops.renameFromTab(id('/space/f/b.md'))

    expect(workspace.openOn(workspace.sideOf('tree'))).toBe('tree')
    expect(workspace.isExpanded('/space/f')).toBe(true)
    expect(workspace.naming?.path).toBe('/space/f/b.md')
    workspace.cancelNaming()
  })

  /** A folder that is also a note is one row, named for the folder; renaming it
   *  there renames both. See folder-notes.ts. */
  test('renames a folder s own note on the folder s row', async () => {
    workspace.tree = entry(
      '/space',
      [entry('/space/f', [entry('/space/f/f.md'), entry('/space/f/c.md')], true)],
      true,
    )
    notes['/space/f/f.md'] = '# f'
    const id = await opened('/space/f/f.md')

    ops.renameFromTab(id('/space/f/f.md'))

    expect(workspace.naming?.path).toBe('/space/f')
    workspace.cancelNaming()
  })

  test('offers no rename for a file with no row in the list', async () => {
    workspace.tree = entry('/space', [entry('/space/a.md')], true)
    await opened(OUTSIDE)
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    expect(workspace.canRenameFromTab(tab)).toBe(false)
  })
})

/** A tab asked for with Ctrl+click, the middle button or Ctrl+Enter: beside the tab
 *  in front, never the preview, and in front of the reader only when Shift said so.
 *  The press is read in new-tab.ts; this is what every open does with the answer. */
describe('a tab asked for with a modifier', () => {
  const strip = () => workspace.tabs.map((one) => one.path ?? one.address)
  const jump = (path: string) => ({ path, target: path, heading: null, block: null, page: null })

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
  })

  test('behind opens it beside the tab in front, and leaves that tab in front', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { activate: false, beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
    expect(workspace.previewTabId).toBeNull()
  })

  test('a run of them from one tab keeps the order they were asked for in', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { activate: false, beside: true })
    await workspace.openEntry('/space/plan.canvas', { activate: false, beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/plan.canvas', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
  })

  test('in front opens it beside the tab and goes there', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('a tab left behind closes no blank note, which may be the one being read', async () => {
    workspace.openBlank()
    await workspace.openEntry('/space/b.md', { activate: false, beside: true })

    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.active?.path).toBeNull()
  })

  test('a link to a note followed with the modifier opens it behind', async () => {
    await workspace.open('/space/a.md')
    const reading = workspace.active

    await workspace.followLink(jump('b.md'), 'behind')

    expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.active).toBe(reading)
  })

  test('a link to a note followed with Alt as well opens it in a pane to the right', async () => {
    await workspace.open('/space/a.md')
    const [first] = workspace.panes.all

    await workspace.followLink(jump('b.md'), 'aside')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.showing(first?.id ?? '')?.path).toBe('/space/a.md')
    expect(workspace.active?.path).toBe('/space/b.md')
    expect(workspace.active?.paneId).not.toBe(first?.id)
  })

  test('and makes the note there when the space has none by that name', async () => {
    await workspace.open('/space/a.md')
    // What the disk answers once the note is written; the mock writes nothing.
    notes['/space/New.md'] = '# New\n\n'

    try {
      await workspace.followLink({ ...jump('New.md'), path: null, target: 'New' }, 'aside')

      expect(workspace.panes.count).toBe(2)
      expect(workspace.active?.path).toBe('/space/New.md')
    } finally {
      delete notes['/space/New.md']
    }
  })

  test('a paper followed the same way opens behind too', async () => {
    await workspace.open('/space/a.md')
    const reading = workspace.active

    await workspace.followLink({ ...jump('paper.pdf'), page: 2 }, 'behind')

    expect(strip()).toEqual(['/space/a.md', '/space/paper.pdf'])
    expect(workspace.active).toBe(reading)
  })

  test('a page a link opened behind lands beside the tab it was pressed in', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    workspace.openPage('https://example.com/', 'behind')

    expect(strip()).toEqual(['/space/a.md', 'https://example.com/', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
  })

  test('a page a page asked for lands beside that page, even one not in front', async () => {
    await workspace.open('/space/a.md')
    const asking = workspace.openPage('https://example.com/')
    await workspace.open('/space/c.md')
    const reading = workspace.active

    workspace.openPage('https://example.org/', 'behind', asking ?? undefined)

    expect(strip()).toEqual([
      '/space/a.md',
      'https://example.com/',
      'https://example.org/',
      '/space/c.md',
    ])
    expect(workspace.active).toBe(reading)
  })

  test('a plain page still goes to the end and in front, as it did', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    workspace.openPage('https://example.com/')

    expect(strip()).toEqual(['/space/a.md', '/space/c.md', 'https://example.com/'])
    expect(workspace.active?.address).toBe('https://example.com/')
  })

  test('the back arrow with the middle button opens the step behind', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    workspace.keep(looking.id)

    workspace.goBack(looking.id, 'behind')
    await vi.waitFor(() => expect(workspace.tabs).toHaveLength(2))

    expect(strip()).toEqual(['/space/b.md', '/space/a.md'])
    expect(workspace.active?.id).toBe(looking.id)
    expect(looking.path).toBe('/space/b.md')
  })
})

/** Whose web data a page is built in, which is the space the tab belongs to: the one
 *  holding its file, and for a tab with no file the one it was opened in. Emil,
 *  2026-09-30: *"unsaved web tabs should use the current store of the current space.
 *  And a note should always use the data saving option from the space that it is
 *  from."* */
describe('the space a tab belongs to', () => {
  const WORK = { id: 'w', name: 'Work', root: '/work' }
  const HOME = { id: 'h', name: 'Home', root: '/space' }

  beforeEach(() => {
    onePane()
    workspace.spaces = [HOME, WORK]
    workspace.activeSpaceId = 'w'
  })

  afterEach(() => {
    delete notes['/work/Mail.url']
  })

  test('is the space a web tab was opened in, kept when another is opened', () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.activeSpaceId = 'h'

    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('and comes back with it after a restart', async () => {
    workspace.openWebsite()
    const layout = workspace.layout()
    expect(panesOf(layout.frame)[0]?.tabs[0]?.space).toBe('w')

    workspace.activeSpaceId = 'h'
    onePane()
    await workspace.applyLayout(layout)

    const tab = workspace.tabs[0]
    if (!tab) throw new Error('nothing came back')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('is, for a web note, the space holding its file, whichever is on screen', async () => {
    notes['/work/Mail.url'] = '[InternetShortcut]\r\nURL=https://mail.example.com/\r\n'
    workspace.activeSpaceId = 'h'

    await workspace.openWeb('/work/Mail.url')

    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  /** A link followed out of a work page stays signed in as work. */
  test('is, for a page opened out of a tab, that tab’s space', () => {
    workspace.openWebsite()
    const from = workspace.active
    if (!from) throw new Error('nothing opened')
    workspace.activeSpaceId = 'h'

    const opened = workspace.openPage('https://example.com/', 'front', from.id)

    const tab = workspace.tabs.find((one) => one.id === opened)
    if (!tab) throw new Error('the page did not open')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('is, for a new note, where it is saved to', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# Plan')
    workspace.activeSpaceId = 'h'

    await workspace.save(tab)

    expect(tab.path).toBe('/work/Plan.md')
  })
})

/** Emil, 2026-09-30: *"it should NEVER be possible that we have the same web note open
 *  multiple times within one nib session."* One check in the strip itself, so every
 *  door is held to it; see `secondWebTabs` in workspace/open.ts. */
describe('a web note', () => {
  const SITE = '/space/Site.url'

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    notes[SITE] = '[InternetShortcut]\r\nURL=https://example.com/start\r\n'
  })

  afterEach(() => {
    delete notes['/space/Site.url']
  })

  /** Every tab over the web note's file, which is never more than one. */
  const onSite = () => workspace.tabs.filter((one) => one.path === SITE)

  async function openSite() {
    await workspace.openWeb(SITE)
    const tab = workspace.active
    if (tab?.path !== SITE) throw new Error('the site did not open')
    // Where the reading got to, which the page says and the session remembers.
    pages.of(tab.id).url = 'https://example.com/deep'
    tab.address = 'https://example.com/deep'
    return tab
  }

  test('opened again shows the tab it is in, wherever that is', async () => {
    const tab = await openSite()
    await workspace.open('/space/a.md')
    workspace.split('row')

    await workspace.openWeb(SITE)
    await workspace.openEntry(SITE, { beside: true })
    await workspace.openAside(SITE)

    expect(onSite()).toEqual([tab])
    expect(workspace.active).toBe(tab)
  })

  test('duplicated is an unsaved web tab at the page it is on, with no dot', async () => {
    const tab = await openSite()

    ops.duplicateTab(tab.id)

    expect(onSite()).toEqual([tab])
    const copy = workspace.tabs.find((one) => one !== tab)
    expect(copy?.kind).toBe('web')
    expect(copy?.path).toBeNull()
    expect(copy?.address).toBe('https://example.com/deep')
    expect(copy && isDraft(copy.note)).toBe(false)
    expect(copy && workspace.spaceOf(copy.note)).toBe('s')
  })

  test('split is the same: a web tab of its own beside it', async () => {
    const tab = await openSite()

    workspace.split('row', tab.id)

    expect(onSite()).toEqual([tab])
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.tabs.find((one) => one !== tab)?.address).toBe('https://example.com/deep')
  })

  test('is one tab however a second is put in the strip', async () => {
    const tab = await openSite()

    workspace.tabs = [...workspace.tabs, new Tab(tab.note, tab.paneId)]

    expect(onSite()).toEqual([tab])
    expect(workspace.tabs).toHaveLength(2)
  })

  test('two tabs of it in a session from before come back as one and a copy', async () => {
    const tab = await openSite()
    workspace.split('row', tab.id)
    const layout = workspace.layout()
    // As a build before this one wrote it: both tabs on the file.
    for (const pane of panesOf(layout.frame)) {
      for (const draft of pane.tabs) {
        draft.path = SITE
        draft.share = tab.note.key
      }
    }

    onePane()
    await workspace.applyLayout(layout)

    expect(onSite()).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(2)
  })

  /** Markdown notes are out of it: a note may still be shown twice. */
  test('a note may still be in two panes', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    expect(workspace.tabs.filter((one) => one.path === '/space/a.md')).toHaveLength(2)
  })
})

/** A note with no file is its space's though it is on no disk, so a search of the
 *  space finds it where its words are; see search/unsaved.ts. */
describe('a search of the space', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
  })

  test('finds the words of a note with no file, by its tab', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# Plan\n\nbuy milk')
    const { unsavedHits } = await import('./search/unsaved')
    const { parseQuery } = await import('./search/query')

    expect(unsavedHits(parseQuery('milk'), 's', 10)).toEqual([
      expect.objectContaining({ tab: tab.id, line: 2, text: 'buy milk' }),
    ])
    expect(unsavedHits(parseQuery('milk'), 'another', 10)).toEqual([])
  })
})
