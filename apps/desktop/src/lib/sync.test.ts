import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Bookmark } from './workspace/bookmarks.svelte'

/** The account's own refusal, so a write that names a version the account has moved
 *  past comes back the way the service answers it; see services/sync/src/notes.ts. */
const { ApiError } = await import('./api')

/** Syncing is driven here the way the app drives it, one pass at a time,
 *  against a disk and an account that both live in memory. Under node there is
 *  neither a platform shim nor a network, so both are stood in for before the
 *  stores are imported - which is why those come in further down. */

const fake = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  interface Note {
    id: string
    spaceId: string
    path: string
    content: string
    version: number
    seq: number
    deleted: boolean
  }

  const disk = new Map<string, string>()
  const remote = {
    spaces: [] as {
      id: string
      name: string
      bookmarks?: Bookmark[]
      /** What the account lets this session do here. Absent is its own. */
      role?: 'owner' | 'write' | 'read'
    }[],
    notes: [] as Note[],
    /** Every write the account received, in order. */
    calls: [] as string[],
    /** And every folder this machine took away, by how it took it. */
    local: [] as string[],
    seq: 0,
  }

  const basename = (path: string) => path.split('/').pop() ?? path
  const parent = (path: string) => path.split('/').slice(0, -1).join('/') || '/'
  /** A space is a folder straight under the root, and a folder exists while
   *  something is in it - the same rule the desktop's disk follows. */
  const spaces = () => [...new Set([...disk.keys()].map((path) => `/${path.split('/')[1]}`))].sort()

  function tree(root: string): Entry {
    if (!spaces().includes(root)) throw new Error('root is not a directory')

    const node = (path: string): Entry => ({
      name: basename(path),
      path,
      is_dir: true,
      modified: 0,
      created: 0,
      children: [],
    })
    const folders = new Map([[root, node(root)]])
    const folder = (path: string): Entry => {
      let found = folders.get(path)
      if (!found) {
        found = node(path)
        folders.set(path, found)
        folder(parent(path)).children.push(found)
      }
      return found
    }

    for (const path of [...disk.keys()].filter((one) => one.startsWith(`${root}/`)).sort()) {
      const name = basename(path)
      if (name.startsWith('.')) {
        folder(parent(path))
        continue
      }
      folder(parent(path)).children.push({
        name,
        path,
        is_dir: false,
        modified: 0,
        created: 0,
        children: [],
      })
    }

    return folders.get(root)!
  }

  /** What an invoke was given, when it is the kind of value it should be:
   *  `args` is a bag of unknowns. */
  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    switch (command) {
      case 'list_spaces':
        return spaces().map((root) => ({ name: basename(root), path: root })) as T
      case 'create_space': {
        const name = text(args.name)
        const root = `/${name}`
        disk.set(`${root}/.keep`, '')
        return { name, path: root } as T
      }
      case 'delete_space':
      case 'trash_item':
        // Which of the two a folder went through is the difference between
        // gone and recoverable, so the fake writes it down.
        remote.local.push(`${command} ${path}`)
        for (const key of [...disk.keys()]) if (key.startsWith(`${path}/`)) disk.delete(key)
        return undefined as T
      case 'read_tree':
        return tree(text(args.root)) as T
      case 'read_note': {
        const doc = disk.get(path)
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        return doc as T
      }
      case 'write_note':
        disk.set(path, text(args.content))
        return undefined as T
      case 'delete_note':
        disk.delete(path)
        return undefined as T
      default:
        return undefined as T
    }
  }

  async function sha256(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  const wire = async (note: Note) => ({
    id: note.id,
    path: note.path,
    seq: note.seq,
    version: note.version,
    updatedAt: 0,
    deleted: note.deleted,
    size: note.content.length,
    hash: await sha256(note.content),
  })

  const listed = (
    space: { id: string; name: string; bookmarks?: Bookmark[]; role?: string },
    position: number,
  ) => ({
    ...space,
    position,
    icon: null,
    role: space.role ?? 'owner',
    shared: (space.role ?? 'owner') !== 'owner',
    // What the account says it holds, which is what a machine bringing it down
    // for the first time counts against.
    notes: remote.notes.filter((note) => note.spaceId === space.id && !note.deleted).length,
    bookmarks: space.bookmarks ?? [],
    createdAt: 0,
    updatedAt: 0,
    blog: { enabled: false, subdomain: null, domain: null, title: null, note: null, dns: [] },
  })

  /** The space these two answer about. Neither is called before one exists, so
   *  an empty list here means the test set itself up wrong. */
  const firstRemoteSpace = () => {
    const [space] = remote.spaces
    if (!space) throw new Error('the account holds no spaces')
    return space
  }

  const user = { id: 'u1', email: 'me@example.com', name: null }
  const found = (id: string) => {
    const note = remote.notes.find((one) => one.id === id)
    if (!note) throw new Error(`no such remote note: ${id}`)
    return note
  }

  const api = {
    requestCode: async () => ({ ok: true as const, resendIn: 30 }),
    verifyCode: async () => ({ token: 'session', user }),
    me: async () => ({ user }),
    signOut: async () => ({ ok: true as const }),
    usage: async () => ({ used: 0, limit: 1 }),
    listSpaces: async () => ({ spaces: remote.spaces.map(listed), deleted: [] as string[] }),
    createSpace: async (_token: string, name: string) => {
      remote.calls.push(`createSpace ${name}`)
      const space = { id: `s-${name}`, name }
      remote.spaces.push(space)
      return { space: listed(space, remote.spaces.length - 1) }
    },
    changes: async (_token: string, spaceId: string, since: number) => {
      const notes = remote.notes.filter((note) => note.spaceId === spaceId && note.seq > since)
      const page = {
        notes: await Promise.all(notes.map(wire)),
        cursor: Math.max(since, ...notes.map((note) => note.seq)),
        more: false,
      }

      // Whatever the test says happens while the pass is running: a room settling
      // the note somebody is typing in, which lands after this page was taken and
      // before the push below reaches that note. See `meanwhile`.
      between()
      return page
    },
    readNote: async (_token: string, id: string) => {
      const note = found(id)
      return { note: await wire(note), content: note.content }
    },
    createNote: async (_token: string, spaceId: string, path: string, content: string) => {
      remote.calls.push(`createNote ${path}`)
      const note = {
        id: `n-${path}`,
        spaceId,
        path,
        content,
        version: 1,
        seq: ++remote.seq,
        deleted: false,
      }
      remote.notes.push(note)
      return { note: await wire(note) }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      baseVersion: number,
    ) => {
      remote.calls.push(`writeNote ${path}`)
      const note = found(id)

      // The account takes one write per version: a write naming a version it has
      // moved past is answered with what it holds instead, so the two copies can be
      // kept. See notes.ts in the service.
      if (note.version !== baseVersion) {
        throw new ApiError(409, 'this note changed elsewhere', {
          note: await wire(note),
          content: note.content,
        })
      }

      Object.assign(note, { path, content, version: note.version + 1, seq: ++remote.seq })
      return { note: await wire(note) }
    },
    deleteNote: async (_token: string, id: string) => {
      remote.calls.push(`deleteNote ${id}`)
      const note = remote.notes.find((one) => one.id === id)
      if (note) Object.assign(note, { deleted: true, seq: ++remote.seq })
      return { ok: true as const }
    },
    deleteSpace: async (_token: string, id: string) => {
      remote.calls.push(`deleteSpace ${id}`)
      return { ok: true as const }
    },
    leaveSpace: async (_token: string, id: string) => {
      remote.calls.push(`leaveSpace ${id}`)
      return { ok: true as const }
    },
    reorderSpaces: async () => ({ ok: true as const }),
    setSpaceIcon: async () => ({ space: listed(firstRemoteSpace(), 0) }),
    renameSpace: async () => ({ space: listed(firstRemoteSpace(), 0) }),
    saveBookmarks: async (_token: string, id: string, bookmarks: Bookmark[]) => {
      remote.calls.push(`saveBookmarks ${id}`)
      const space = remote.spaces.find((one) => one.id === id)
      if (space) space.bookmarks = bookmarks
      return { bookmarks }
    },
  }

  function addRemoteNote(spaceId: string, path: string, content: string) {
    remote.notes.push({
      id: `n-${path}`,
      spaceId,
      path,
      content,
      version: 1,
      seq: ++remote.seq,
      deleted: false,
    })
  }

  /** The account's copy of a note, written again the way another device's push or a
   *  room's settle writes it: new words, and the version and the cursor moved on. */
  function writeRemoteNote(spaceId: string, path: string, content: string) {
    const found = remote.notes.find((one) => one.spaceId === spaceId && one.path === path)
    if (!found) throw new Error(`no note at ${path}`)

    found.content = content
    found.version += 1
    found.seq = ++remote.seq
  }

  /** The notes a room is carrying, as the rooms store answers for them; see the mock
   *  below. A test adds one the moment its room settles. */
  const rooms = new Set<string>()

  /** What happens in the middle of a pass, said once and taken as it fires. */
  let inTheMiddle: (() => void) | null = null

  function between() {
    const now = inTheMiddle
    inTheMiddle = null
    now?.()
  }

  function reset() {
    disk.clear()
    remote.spaces = []
    remote.notes = []
    remote.calls = []
    remote.local = []
    remote.seq = 0
    rooms.clear()
    inTheMiddle = null
  }

  return {
    disk,
    remote,
    invoke,
    api,
    addRemoteNote,
    writeRemoteNote,
    meanwhile: (then: () => void) => (inTheMiddle = then),
    reset,
    rooms,
  }
})

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: fake.api,
}))

/** The rooms, which under node there are none of: no socket, no document, nothing to
 *  join. What the pass asks of them is one question - whether a room is carrying this
 *  note - and a test answers it for itself, so a room can settle in the middle of a
 *  pass the way one does when somebody stops typing. */
vi.mock('./rooms.svelte', () => ({
  rooms: { carries: (noteId: string) => fake.rooms.has(noteId), present: {} },
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

let account: typeof import('./account.svelte').account
let sync: typeof import('./sync.svelte').sync
let workspace: typeof import('./workspace.svelte').workspace

/** The store graph, loaded here rather than by whichever `beforeEach` runs
 *  first, which was seven seconds of it against a hook's budget of thirty. What
 *  `resetModules` costs each test after this is the re-execution alone, a tenth
 *  of a second. See docs/conventions.md. */
await Promise.all([
  import('./account.svelte'),
  import('./sync.svelte'),
  import('./workspace.svelte'),
])

/** Whether the stores below have been made at least once, which is what says
 *  whether there is a loop for the hook to wait on. */
let everStarted = false

beforeEach(async () => {
  // A pass the test before this left in the air, waited out before anything is put
  // back. What is left of a pass reaches for the loop again when a note lands - and
  // it does that through a dynamic import, which hands it whichever instance is
  // current by then, so a stale write would nudge the loop this test is about and
  // push the pass it is timing two seconds out. See noPassInTheAir.
  if (everStarted) await noPassInTheAir()
  everStarted = true

  fake.reset()
  // Put back rather than cleared: a test that stubs a global of its own ends by
  // unstubbing all of them, which takes this one with it. Whichever test runs
  // next should not be able to tell.
  vi.stubGlobal('localStorage', memoryStorage())

  // The stores are singletons that remember mirrors and tabs from one test to
  // the next, so each test gets freshly made ones.
  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  ;({ sync } = await import('./sync.svelte'))
  ;({ workspace } = await import('./workspace.svelte'))

  // Every test drives the clock from here on, so a timer one test leaves running
  // - a note's autosave waiting out its pause, the loop's next tick - is one the
  // afterEach can drop rather than let fire into the test after it. That was the
  // flake this closed: a note edited in one test scheduled a save on a real timer
  // that no teardown cancelled, and a second and change later it woke, reached
  // through the shared fake, and wrote that note's words onto whichever test was
  // running by then - so the failure moved from one test to another with how the
  // runner happened to spread the files across its workers. A test that wants the
  // clock held still - to hold a loop's first tick - says so with its own
  // useFakeTimers; shouldAdvanceTime keeps a note coming down and a hash being
  // taken moving as they do on the wall clock. See afterEach.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // Whatever a test scheduled and did not clear is dropped here, before the next
  // one runs, so nothing a stale timer would do can reach it. Dropping is not
  // firing: the write a leaked save would have made never happens. A test that
  // ended on real timers of its own has already let its timers go with them; only
  // the fake clock this file installs can drop what is still sitting on it. Real
  // again on the way out, so the next beforeEach waits out a pass in real time.
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
})

/** A machine with one space and a note open in it, the way a browser starts. */
async function machineWithNotes() {
  fake.disk.set('/Notes/Read me.md', '# Read me')
  workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]
  workspace.activeSpaceId = 'local'
  await workspace.loadTree()
  await workspace.open('/Notes/Read me.md')
}

/** An account that already holds a space with a note in it. */
function accountWithNotes() {
  fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
  fake.addRemoteNote('s-Account', 'Hello.md', '# Hello from the account')
}

async function signIn() {
  account.email = 'me@example.com'
  expect(await account.verify('123456')).toBe(true)
}

/** Waits until the loop has nothing in the air.
 *
 *  What is left of a pass is promises, and one of them may be a module the worker
 *  is still loading - `saving.svelte.ts` imports the loop back when a note lands.
 *  A fake clock cannot hurry either of those, so this spends real time as well as
 *  fake, and waits for the condition rather than for a number of ticks: a count of
 *  ticks is a guess about how busy the machine is, which is exactly what differs
 *  between a laptop and a runner with four workers on it.
 *
 *  Bounded well inside the test timeout, and it answers rather than throws: a loop
 *  that is still going after this is a test that will say so in its own words. */
async function noPassInTheAir(): Promise<void> {
  const { setTimeout: sleep } = await import('node:timers/promises')

  for (let at = 0; at < 400 && sync.passing; at++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1)
    await sleep(5)
  }
}

/** The two globals the loop listens on, stood in for. It adds and removes
 *  listeners on both at every start and every stop, and node has neither. */
function standInForTheWindow(): void {
  const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined }
  vi.stubGlobal('document', { hidden: false, ...listeners })
  vi.stubGlobal('window', listeners)
}

/** Runs something with the clock far enough on that the loop asks the account
 *  for its spaces again: within one interval it works from the list it already
 *  has, which is the whole point of the interval. */
async function afterTheReconcileInterval(run: () => Promise<unknown>) {
  const { RECONCILE_INTERVAL } = await import('./backoff')

  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(Date.now() + RECONCILE_INTERVAL + 1)
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

describe('signing in when the account will not answer', () => {
  test('is still a sign-in, and still asks about the notes already here', async () => {
    await machineWithNotes()

    // The code is accepted, and the request that follows it is not.
    const real = fake.api.listSpaces
    fake.api.listSpaces = () => Promise.reject(new Error('offline'))

    try {
      account.email = 'me@example.com'
      // False here would tell the sign-in sheet the code was refused, and the
      // question about the notes on this machine would never be asked - while
      // the session it made in passing let syncing upload them unasked.
      expect(await account.verify('123456')).toBe(true)
      expect(account.signedIn).toBe(true)
      expect(account.syncable).toBe(false)
    } finally {
      fake.api.listSpaces = real
    }
  })
})

describe('signing in on a machine that already holds notes', () => {
  test('holds syncing back until the question about them is answered', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()
    expect(account.signedIn).toBe(true)
    expect(account.syncable).toBe(false)

    account.settled()
    expect(account.syncable).toBe(true)
  })

  test('erasing them brings the account down in their place, without a restart', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    await workspace.eraseLocalSpaces()
    account.settled()
    await sync.pass()

    expect(workspace.spaces.map((space) => space.name)).toEqual(['Account'])
    expect(workspace.activeSpace?.name).toBe('Account')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    // Nothing that was erased reaches the account, and nothing of the
    // account's is taken for deleted.
    expect(fake.remote.calls).toEqual([])
    expect(fake.remote.spaces.map((space) => space.name)).toEqual(['Account'])

    // No tab is left pointing at a note that is gone.
    expect(workspace.tabs.every((tab) => !tab.path)).toBe(true)
  })

  test("keeping them sends them up and takes the account's spaces alongside", async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    account.settled()
    await sync.pass()

    expect(fake.remote.calls).toEqual(['createSpace Notes', 'createNote Read me.md'])
    expect(workspace.spaces.map((space) => space.name).sort()).toEqual(['Account', 'Notes'])
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    // What was on screen stays on screen.
    expect(workspace.activeSpace?.name).toBe('Notes')
    expect(workspace.active?.path).toBe('/Notes/Read me.md')
  })
})

describe('what arrives from the account', () => {
  test('is shown at once on a machine that had nothing', async () => {
    accountWithNotes()
    await signIn()
    account.settled()

    await sync.pass()

    expect(workspace.activeSpace?.name).toBe('Account')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
  })

  test('shows in the tree of the open space without anything else touching it', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    fake.addRemoteNote('s-Account', 'Later.md', '# Later')
    await sync.pass()

    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md', 'Later.md'])
  })

  /** An account with one note, brought down and opened, so the next pass writes a
   *  file that a tab is showing. */
  async function readingWhatTheAccountSent() {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()
    await workspace.open('/Account/Hello.md')

    expect(workspace.active?.doc).toBe('# Hello from the account')
  }

  test('is put into the tab showing it, rather than left stale on screen', async () => {
    await readingWhatTheAccountSent()

    // Another device wrote the note. A space's notes are not watched - nothing else
    // writes them - so a pass was the one thing that rewrote a file under an open tab
    // and said nothing: the words on screen stayed as they were, and the next save
    // wrote them back over what had arrived. Which for a device that cannot reach the
    // note's room is the same words offered again on every pass, and the account
    // keeping a copy of what it replaced every time.
    fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello from somewhere else')
    await sync.pass()

    expect(workspace.active?.doc).toBe('# Hello from somewhere else')
  })

  test('leaves a tab with unsaved words in it exactly as it is', async () => {
    await readingWhatTheAccountSent()

    // Those words are somebody's writing, and what happens to them is the conflict
    // rule's to say rather than a reload's; see sync/conflicts.ts.
    workspace.replace('# Hello, and something I am still typing')
    fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello from somewhere else')
    await sync.pass()

    expect(workspace.active?.doc).toBe('# Hello, and something I am still typing')
  })
})

describe('a note that is open in its room while a pass runs', () => {
  /** One device, one note, and the two ways its words travel: the room, which carries
   *  every keystroke into the account as it is typed, and the pass, which carries the
   *  file. A pass leaves a note its room is carrying alone for exactly that reason.
   *
   *  What it must not do is decide that once, at the top, and hold the answer for the
   *  minutes a pass can run. A room settles whenever somebody stops typing, so the note
   *  whose room settled halfway through went up as a file naming a version that had
   *  just moved - the account answered 409, the pass read that as a second writer, and
   *  the machine that had been typing in one note the whole time was left with a second
   *  copy of it beside the first. */
  async function typingInTheOpenNote() {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    // The note is open, so it is in a room, and what is typed into it reaches the
    // file at the next pause; see workspace/saving.svelte.ts.
    fake.disk.set('/Account/Hello.md', '# Hello, and a line typed here')

    // The room settles those same keystrokes a moment after the pass took the
    // account's page of changes, which is the whole of the race: what the pass knows
    // about the rooms is from before that moment.
    fake.meanwhile(() => {
      fake.rooms.add('n-Hello.md')
      fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello, and a line typed here')
    })

    await sync.pass()
  }

  /** What the folder holds, so a second copy under any name shows up. */
  function files(): string[] {
    return [...fake.disk.keys()]
      .filter((path) => path.startsWith('/Account/') && !path.includes('/.'))
      .sort()
  }

  test('is left where it is rather than pushed against a version that moved', async () => {
    await typingInTheOpenNote()

    expect(files()).toEqual(['/Account/Hello.md'])
    expect(fake.remote.notes.filter((one) => !one.deleted).map((one) => one.path)).toEqual([
      'Hello.md',
    ])
  })

  test('and the pass says nothing about it in the log', async () => {
    await typingInTheOpenNote()

    // Nothing was sent and nothing clashed: the room had it the whole time.
    expect(fake.remote.calls).toEqual([])
  })
})

describe('a mirror whose folder is gone', () => {
  test('is left alone rather than read as every note deleted', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    // The folder goes without syncing hearing of it.
    await fake.invoke('delete_space', { path: '/Account' })
    workspace.spaces = []

    await sync.run()
    expect(fake.remote.calls).toEqual([])
  })
})

describe('the bookmarks of a space', () => {
  /** A machine that has bookmarked a note in the space it holds. */
  async function machineWithABookmark() {
    await machineWithNotes()
    workspace.bookmarks.toggle({ kind: 'note', path: 'Read me.md', text: '' })
  }

  test('join the account’s own list on the first pass and are sent up', async () => {
    await machineWithABookmark()
    fake.remote.spaces.push({
      id: 's-Notes',
      name: 'Notes',
      bookmarks: [{ kind: 'search', path: '', text: 'tea' }],
    })

    await signIn()
    account.settled()
    await sync.pass()

    expect(workspace.bookmarks.of('/Notes')).toEqual([
      { kind: 'search', path: '', text: 'tea' },
      { kind: 'note', path: 'Read me.md', text: '' },
    ])
    expect(fake.remote.calls).toContain('saveBookmarks s-Notes')
    expect(fake.remote.spaces[0]?.bookmarks).toHaveLength(2)
  })

  test('follow the account from then on, so one removed elsewhere stays gone', async () => {
    await machineWithABookmark()
    fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })

    await signIn()
    account.settled()
    await sync.pass()
    expect(workspace.bookmarks.of('/Notes')).toHaveLength(1)

    // Another machine dropped it. The pass that next asks the account for its
    // spaces takes that, rather than offering this machine's copy back.
    const [space] = fake.remote.spaces
    if (space) space.bookmarks = []
    fake.remote.calls.length = 0
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.bookmarks.of('/Notes')).toEqual([])
    expect(fake.remote.calls).toEqual([])
  })

  test('are offered to the account as soon as one is added', async () => {
    await machineWithNotes()
    fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })

    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls.length = 0

    workspace.bookmarks.toggle({ kind: 'folder', path: 'Work', text: '' })
    await vi.waitFor(() => {
      expect(fake.remote.calls).toEqual(['saveBookmarks s-Notes'])
    })
  })
})

describe('a space somebody shared', () => {
  /** An account holding one space that belongs to somebody else, with a note
   *  already in it. */
  function sharedWithMe(role: 'write' | 'read') {
    fake.remote.spaces.push({ id: 's-Theirs', name: 'Theirs', role })
    fake.addRemoteNote('s-Theirs', 'Plan.md', '# Their plan')
  }

  test('arrives as a folder like any other', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()

    expect(fake.disk.get('/Theirs/Plan.md')).toBe('# Their plan')
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Theirs'])
  })

  test('is never written back to when it was shared to read', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    // Something writes into the folder anyway - another program, or a machine
    // that has since lost the role. The pass says nothing about it, because
    // saying it would be refused and because a folder somebody is reading is
    // not a statement about what the space should hold.
    fake.disk.set('/Theirs/Mine.md', '# not mine to add')
    await workspace.loadTree()
    await sync.pass()

    expect(fake.remote.calls).toEqual([])
  })

  test('is written back to when it was shared to write', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    fake.disk.set('/Theirs/Mine.md', '# mine to add')
    await workspace.loadTree()
    await sync.pass()

    expect(fake.remote.calls).toEqual(['createNote Mine.md'])
  })

  test('is let go of rather than deleted when the folder goes', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    const [space] = workspace.spaces
    if (space) await sync.forget(space.root)

    expect(fake.remote.calls).toEqual(['leaveSpace s-Theirs'])
  })

  test('takes its folder with it when the sharing is taken back', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Theirs'])

    // The account stops listing it, with no marker: the space still exists, it
    // is simply not this one's to reach. Uploading the folder again would put a
    // copy of somebody else's space into this account.
    fake.remote.spaces = []
    fake.remote.calls = []
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.spaces).toEqual([])
    expect(fake.remote.calls).toEqual([])
  })

  test('leaves that folder somewhere it can be got back from', async () => {
    // Nobody's Recently deleted holds a space somebody stopped sharing, so the
    // copy on this disk is the last one of what was read here.
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()

    fake.remote.spaces = []
    await afterTheReconcileInterval(() => sync.pass())

    expect(fake.remote.local).toEqual(['trash_item /Theirs'])
  })

  test('is never asked to keep the bookmarks of one shared to read', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    workspace.bookmarks.toggle({ kind: 'note', path: 'Plan.md', text: '' })
    await afterTheReconcileInterval(() => sync.pass())

    // The account would refuse the list, and asking on every pass is a refusal
    // on every pass.
    expect(fake.remote.calls).toEqual([])
  })
})

describe('the mirrors this machine remembers', () => {
  /** Starts the loop, which is what reads them back, with the two globals it
   *  listens on stood in for. */
  async function started(): Promise<void> {
    standInForTheWindow()
    vi.useFakeTimers()

    await signIn()
    account.settled()
    sync.start()
  }

  function stopped(): void {
    sync.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  test('belong to one account, and another one starts from nothing', async () => {
    // Otherwise a folder that mirrored a space somebody shared reads, under the
    // next account to sign in here, as a space that went - and goes.
    localStorage.setItem(
      'nib:mirrors',
      JSON.stringify({
        account: 'somebody-else',
        mirrors: { '/Theirs': { spaceId: 's-Theirs', root: '/Theirs', shared: true } },
      }),
    )

    await started()
    try {
      expect(sync.remoteIdFor('/Theirs')).toBeNull()
    } finally {
      stopped()
    }
  })

  test('are kept by a machine that wrote them before there was an account beside them', async () => {
    // The shape an older version wrote. Whoever signs in now is who they are
    // about, because they are the only account that machine had.
    localStorage.setItem(
      'nib:mirrors',
      JSON.stringify({ '/Notes': { spaceId: 's-Notes', root: '/Notes' } }),
    )

    await started()
    try {
      expect(sync.remoteIdFor('/Notes')).toBe('s-Notes')
    } finally {
      stopped()
    }
  })

  /** A storage that answers in two goes, which is what a packed plugin has: the
   *  cookie is read before the first paint, and what it had no room for arrives
   *  from the phone app's own store seconds later. See `reread`. */
  describe('are read again when the rest of the storage lands', () => {
    /** What the second seeding puts there: the whole table, as the pass that wrote
     *  it left it. */
    function landed(notes: Record<string, { id: string; version: number; hash: string }>) {
      localStorage.setItem(
        'nib:mirrors',
        JSON.stringify({
          account: 'u1',
          seen: true,
          mirrors: {
            '/Notes': { spaceId: 's-Notes', root: '/Notes', cursor: 40, notes, files: {} },
          },
        }),
      )
    }

    test('fills in the entries the first read had no room for', async () => {
      await started()
      try {
        expect(sync.tracked('/Notes/one.md')).toBeNull()

        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
        expect(sync.remoteIdFor('/Notes')).toBe('s-Notes')
      } finally {
        stopped()
      }
    })

    test('does not undo what a pass has already settled', async () => {
      // A real space on both sides, so a pass has something to settle in the very
      // mirror this then fills in.
      fake.disk.set('/Notes/.keep', '')
      fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })
      fake.addRemoteNote('s-Notes', 'two.md', '# two')
      workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]

      await started()
      try {
        await sync.pass()
        expect(sync.tracked('/Notes/two.md')).not.toBeNull()

        // And now the phone app answers with the table as it was before that pass:
        // older, and without the note the pass just brought down.
        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        // Both. What a pass settled is newer than anything storage is only now
        // getting round to mentioning, and what storage had is news to this.
        expect(sync.tracked('/Notes/two.md')).not.toBeNull()
        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
      } finally {
        stopped()
      }
    })

    test('adds to the mirror it holds rather than swapping it for another', async () => {
      await started()
      try {
        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        // A second answer naming a different note: two goes at one table, or a
        // reread called twice while a pass is running.
        landed({ 'two.md': { id: 'n2', version: 4, hash: 'bbb' } })
        sync.reread()

        // Both, because the mirror is added to where it stands. That is what makes
        // this safe to call during a pass: a pass writes into these very objects,
        // and one swapped for another would leave it writing into nothing.
        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
        expect(sync.tracked('/Notes/two.md')).toEqual({ id: 'n2', version: 4, hash: 'bbb' })
      } finally {
        stopped()
      }
    })

    /** The launch this is all for, end to end on the storage's own terms.
     *
     *  `nib:mirrors` does not ride the cookie any more - 133 bytes plus the path per
     *  note, 7,706 of them for Emil's twenty once the cookie's encoding is counted,
     *  against a 3,500 byte cookie - so a plugin starts with none of it and the phone
     *  app's own store answers seconds later. Nothing may be lost by that: what comes
     *  back has to be the whole table, not the fourteen notes that used to fit. See
     *  lib/even/local.ts, and the second seeding in even.ts. */
    test('a launch that starts with nothing ends with every note back', async () => {
      const many = Object.fromEntries(
        Array.from({ length: 20 }, (_one, at) => [
          `note ${String(at)}.md`,
          { id: `n${String(at)}`, version: at + 1, hash: 'f'.repeat(64) },
        ]),
      )

      localStorage.removeItem('nib:mirrors')
      await started()
      try {
        expect(sync.tracked('/Notes/note 0.md')).toBeNull()

        landed(many)
        sync.reread()

        for (let at = 0; at < 20; at++) {
          expect(sync.tracked(`/Notes/note ${String(at)}.md`), `note ${String(at)}`).toEqual({
            id: `n${String(at)}`,
            version: at + 1,
            hash: 'f'.repeat(64),
          })
        }
      } finally {
        stopped()
      }
    })

    test('says nothing at all when storage held nothing new', async () => {
      await started()
      try {
        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        const written = localStorage.getItem('nib:mirrors')
        sync.reread()

        expect(localStorage.getItem('nib:mirrors')).toBe(written)
      } finally {
        stopped()
      }
    })

    test('leaves another account’s mirrors where they are', async () => {
      await started()
      try {
        localStorage.setItem(
          'nib:mirrors',
          JSON.stringify({
            account: 'somebody-else',
            mirrors: { '/Theirs': { spaceId: 's-Theirs', root: '/Theirs' } },
          }),
        )
        sync.reread()

        expect(sync.remoteIdFor('/Theirs')).toBeNull()
      } finally {
        stopped()
      }
    })
  })
})

describe('a storage with no room left for the note caches', () => {
  /** A storage that takes a short write and refuses a long one, which is what a
   *  browser does at its five megabytes: the setter throws. */
  function cramped(most: number): Storage {
    const store = new Map<string, string>()

    return {
      get length() {
        return store.size
      },
      key: (index) => [...store.keys()][index] ?? null,
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        if (value.length > most) throw new Error('QuotaExceededError')
        store.set(key, value)
      },
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    }
  }

  /** What is under nib:mirrors, read back the way the next launch reads it. */
  function written(): {
    mirrors: Record<string, { cursor?: number; notes?: object; dropped?: boolean }>
  } {
    const held = localStorage.getItem('nib:mirrors')
    expect(held).not.toBeNull()
    return JSON.parse(held ?? '{}') as ReturnType<typeof written>
  }

  test('keeps the cursor, so the next pass does not read the whole account again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()

    // Room for the cursors and not for the notes beside them. Installed before the
    // pass, so the write the pass makes is the one that has to fit.
    const full = JSON.stringify({
      account: 'x',
      seen: true,
      mirrors: {
        '/Account': {
          spaceId: 's-Account',
          root: '/Account',
          cursor: 1,
          notes: {},
          offered: {},
          files: {},
          dropped: true,
        },
      },
    }).length
    vi.stubGlobal('localStorage', cramped(full + 40))

    // The pass itself must not fail over it: what it found is in memory and true.
    await expect(sync.pass()).resolves.not.toThrow()

    const mirror = Object.values(written().mirrors)[0]
    expect(mirror?.cursor).toBeGreaterThan(0)
    // And the thing that would not fit is the thing that was dropped - which the
    // blob says out loud, because a mirror that threw its table away and one that
    // never had it mean opposite things to the next pass; see `dropped`.
    expect(mirror?.notes).toEqual({})
    expect(mirror?.dropped).toBe(true)
    // In memory it is all still there, so nothing this session does reads a note
    // again either.
    expect(sync.tracked('/Account/Hello.md')).not.toBeNull()

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })

  test('says so rather than failing the pass when nothing at all will fit', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    vi.stubGlobal('localStorage', cramped(0))

    await expect(sync.pass()).resolves.not.toThrow()
    expect(localStorage.getItem('nib:mirrors')).toBeNull()
    // The session still knows where it is; only the next launch pays for it.
    expect(sync.remoteIdFor('/Account')).toBe('s-Account')

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })
})

describe('turning syncing off while a pass is in the air', () => {
  test('leaves the light off and does not start the loop again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    // One pass first, so there is a mirror for the next one to work on.
    await sync.pass()

    standInForTheWindow()
    vi.useFakeTimers()

    // Holds the next pass open on the network, so it is still in flight when
    // syncing is turned off - which is what signing out looks like from here.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const real = fake.api.changes
    let asked = 0
    fake.api.changes = async (token: string, spaceId: string, since: number) => {
      asked++
      await held
      return real(token, spaceId, since)
    }

    try {
      sync.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBe(1)

      sync.stop()
      expect(sync.status).toBe('off')

      release()
      await vi.advanceTimersByTimeAsync(0)

      // The pass finished after the stop; what it thinks the state is no
      // longer holds.
      expect(sync.status).toBe('off')

      // And it must not have set the next timer: a stopped loop stays stopped.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(asked).toBe(1)
    } finally {
      fake.api.changes = real
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('the first pass, which somebody is waiting on', () => {
  /** The state the app holds the whole surface for; see arriving.svelte.ts. */
  let arriving: typeof import('./arriving.svelte').arriving

  beforeEach(async () => {
    standInForTheWindow()
    ;({ arriving } = await import('./arriving.svelte'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** The loop, started with its own first tick held back.
   *
   *  Every test below drives the pass itself, and the tick `start` schedules
   *  would otherwise race it: whichever got there first would take the one thing
   *  under test, since a session has only one first pass. */
  function startedWithTheTickHeld(): void {
    vi.useFakeTimers()
    sync.start()
  }

  function stoppedAgain(): void {
    sync.stop()
    vi.useRealTimers()
  }

  test('is scheduled for now rather than for the next interval', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    // Counted rather than looked for on the disk: what is under test is when the
    // pass begins, and a whole pass finishing is a different claim.
    const real = fake.api.listSpaces
    let asked = 0
    fake.api.listSpaces = () => {
      asked++
      return real()
    }

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      account.settled()
      sync.start()
      expect(asked).toBe(0)

      // Nought, not an interval.
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBe(1)
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  /** A nudge exists to bring a pass forward, and it used to re-plan one for its own
   *  delay whatever was already planned - so a note written in the first instant of
   *  a launch pushed the pass that was due at once two seconds out, and a hand that
   *  kept typing kept pushing it. Every write goes through one; see
   *  workspace/saving.svelte.ts. */
  test('is not postponed by something saved in the same instant', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    const real = fake.api.listSpaces
    let asked = 0
    fake.api.listSpaces = () => {
      asked++
      return real()
    }

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      account.settled()
      sync.start()
      // A note written in this instant, which is what every save ends in.
      sync.nudge()

      // Asked at least once: what is left of an earlier test's pass reaches the
      // same fake, and one of its questions would be counted here too. What this
      // test says is that the pass the nudge landed on still happened at once.
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBeGreaterThan(0)
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('says so the moment the code is accepted, before anything has been asked', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()

    // Before the question about the notes already here, before the loop, before
    // one note has come down. Nothing is claimed about how much yet.
    expect(arriving.showing).toBe(true)
    expect(arriving.total).toBe(null)
    expect(account.syncable).toBe(false)
  })

  test('stays up across the round trip the pass opens with', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    // Held open on the account's listing, which is the round trip that used to
    // happen behind a screen saying nothing at all.
    const real = fake.api.listSpaces
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fake.api.listSpaces = async () => {
      await held
      return real()
    }

    try {
      startedWithTheTickHeld()
      const running = sync.pass()
      expect(arriving.showing).toBe(true)
      expect(arriving.total).toBe(null)

      release()
      await running
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('is taken down again when the machine already holds everything', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    stoppedAgain()

    // Signing in again on the same machine raises it, because a code being
    // accepted is all that is known at that point.
    await signIn()
    expect(arriving.showing).toBe(true)

    // And the loop, which does know, puts it straight back down: nothing of
    // theirs is on its way, so there is nothing to hold anybody behind.
    account.settled()
    startedWithTheTickHeld()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('counts what it is bringing down, and lifts when it has', async () => {
    await machineWithNotes()
    fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
    for (const name of ['one.md', 'two.md', 'three.md']) {
      fake.addRemoteNote('s-Account', name, `# ${name}`)
    }

    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()

    // The total came from the account's listing, before the first note landed;
    // the count is what actually arrived. They agree, and the state has gone.
    // Read before the loop is stopped, because stopping forgets both.
    expect(arriving.total).toBe(3)
    expect(arriving.done).toBe(3)
    expect(arriving.showing).toBe(false)

    stoppedAgain()
  })

  test('leaves the switcher and the tree holding what came down, with no reload', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    expect(arriving.showing).toBe(false)
    stoppedAgain()

    // The rail has the account's space by the time the wait is over, and the
    // notes are on the disk under it.
    expect(workspace.spaces.map((space) => space.name)).toContain('Account')
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    // And opening it shows them, without anything being reloaded.
    const arrived = workspace.spaces.find((space) => space.name === 'Account')
    expect(arrived).toBeDefined()
    await workspace.showSpace(arrived?.id ?? '')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
  })

  test('says nothing on a machine that has synced before', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    stoppedAgain()

    // The same machine, come back to. Everything is already here, so the sync
    // light is the whole report.
    startedWithTheTickHeld()
    expect(arriving.showing).toBe(false)

    await sync.pass()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('says nothing on a later pass of the same session', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    expect(arriving.showing).toBe(false)

    fake.addRemoteNote('s-Account', 'Later.md', '# written elsewhere')
    await sync.pass()

    expect(arriving.showing).toBe(false)
    expect(fake.disk.get('/Account/Later.md')).toBe('# written elsewhere')
    stoppedAgain()
  })

  test('is taken down by signing out', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    expect(arriving.showing).toBe(true)

    await account.signOut()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('stands through the question about the notes already here', async () => {
    await machineWithNotes()
    accountWithNotes()

    // A code accepted raises it, and syncing is held off until that question is
    // answered - which is the one stretch where somebody is waiting hardest.
    // Stopping the loop used to take the wait with it, and left a blank screen.
    await signIn()
    expect(arriving.showing).toBe(true)

    sync.stop()
    expect(arriving.showing).toBe(true)

    account.settled()
    startedWithTheTickHeld()
    expect(arriving.showing).toBe(true)
    stoppedAgain()
  })
})

describe('a pass that fails partway through', () => {
  /** The state the app holds the whole surface for; see arriving.svelte.ts. */
  let arriving: typeof import('./arriving.svelte').arriving

  beforeEach(async () => {
    standInForTheWindow()
    ;({ arriving } = await import('./arriving.svelte'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('says so, lets anybody waiting in, and leaves the loop looping', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    // Sending this machine's folder up is refused. One request of the several a
    // pass makes before it starts moving notes, and a network is allowed to
    // refuse any of them.
    const real = fake.api.createSpace
    let asked = 0
    fake.api.createSpace = () => {
      asked++
      return Promise.reject(new Error('offline'))
    }

    vi.useFakeTimers()
    try {
      sync.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(asked).toBe(1)
      // What happened is on the light rather than nowhere.
      expect(sync.status).toBe('error')
      // And nobody is left behind the first-pass state, waiting on a pass that
      // has already ended.
      expect(arriving.showing).toBe(false)

      // The loop is still a loop: one refusal is not the end of syncing for the
      // whole sitting.
      const { pollDelay } = await import('./backoff')
      await vi.advanceTimersByTimeAsync(pollDelay(1, false) + 1)
      expect(asked).toBeGreaterThan(1)
    } finally {
      fake.api.createSpace = real
      sync.stop()
    }
  })
})
