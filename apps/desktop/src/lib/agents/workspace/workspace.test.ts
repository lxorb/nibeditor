/** An agent in the workspace, verb by verb, against a window that has two spaces and a
 *  third the agent was not granted, with Work open and Home not.
 *
 *  The window is a stand-in the way the automation tests stand one in (see
 *  automation/acts.test.ts): the workspace, the crate, the index of a space and the
 *  search are fakes that write down what they were asked, so each test can say what an
 *  agent's verb did and - the core of it - what it did not: switch the reader's space,
 *  or touch the tabs in front of them (docs/agent-native.md 8.6). */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf, type Caller, READER } from '../../automation/caller'
import { AGENT_WINDOW_VERBS } from '../verbs'
import { type FileOp, FileOps, type Kind } from '../../workspace/file-ops'

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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

// ---- the window ------------------------------------------------------------------------

const work = { id: 'work', name: 'Work', root: '/s/Work' }
const home = { id: 'home', name: 'Home', root: '/s/Home' }
const secret = { id: 'secret', name: 'Secret', root: '/s/Secret' }

/** Every file of every space, by its path on this disk. */
const files = new Map<string, string>()
const folders = new Set<string>()

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

/** A space's tree as `read_tree` answers it. */
function treeOf(root: string): Entry {
  const top: Entry = { name: root, path: root, is_dir: true, modified: 0, created: 0, children: [] }
  const at = new Map<string, Entry>([[root, top]])
  const under = (path: string, is_dir: boolean) => {
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (!at.has(parent)) under(parent, true)
    const entry: Entry = {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      is_dir,
      modified: 1,
      created: 1,
      children: [],
    }
    at.get(parent)?.children.push(entry)
    at.set(path, entry)
  }
  for (const path of [...folders].sort()) if (path.startsWith(`${root}/`)) under(path, true)
  for (const path of [...files.keys()].sort()) if (path.startsWith(`${root}/`)) under(path, false)
  return top
}

/** What the reader has open, which no agent verb in another space may change. */
const tabs = [
  {
    id: 't1',
    kind: 'note',
    path: '/s/Work/Plan.md',
    paneId: 'p1',
    pinned: false,
    shown: 'Plan',
    note: { live: { readerAt: null } },
  },
  {
    id: 't2',
    kind: 'note',
    path: '/s/Work/Pinned.md',
    paneId: 'p1',
    pinned: true,
    shown: 'Pinned',
    note: { live: { readerAt: null } },
  },
  {
    id: 'w1',
    kind: 'web',
    path: '/s/Work/Docs.url',
    paneId: 'p2',
    pinned: false,
    shown: 'Docs',
    note: { live: { readerAt: null } },
  },
]

const marks: Record<string, { kind: string; path: string; text: string }[]> = {}

const workspace = {
  spaces: [work, home, secret],
  activeSpaceId: 'work',
  get activeSpace() {
    return this.spaces.find((one) => one.id === this.activeSpaceId) ?? null
  },
  get tree() {
    return treeOf(this.activeSpace?.root ?? '')
  },
  tabs,
  panes: { focusedId: 'p1' },
  activeTabId: 't1',
  get active() {
    return tabs[0]
  },
  showSpace: vi.fn(),
  selectSpace: vi.fn(),
  noteText: (path: string) => Promise.resolve(files.get(path) ?? null),
  keepsArchived: (path: string) => path === '/s/Home/Old.md',
  remove: vi.fn((path: string) => {
    files.delete(path)
    return Promise.resolve()
  }),
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve()),
  loadTree: vi.fn(() => Promise.resolve()),
  openEntry: vi.fn(() => Promise.resolve()),
  close: vi.fn(),
  activate: vi.fn(),
  split: vi.fn(),
  showing: (pane: string) => tabs.find((one) => one.paneId === pane && !one.pinned) ?? null,
  webAddressOf: () => 'https://docs.example/',
  archive: {
    keysOf: (root: string) => new Set(root === '/s/Home' ? ['Old.md'] : []),
  },
  leftOutOf: (root: string) => (root === '/s/Home' ? ['Old.md'] : []),
  bookmarks: {
    of: (root: string) => marks[root] ?? [],
    put: vi.fn((root: string, list: { kind: string; path: string; text: string }[]) => {
      marks[root] = list
    }),
    remove: vi.fn(),
  },
  documentAt: () => null,
  // The one sentence every file operation is said as, heard for real by whatever
  // follows it; see workspace/file-ops.ts.
  fileOps: new FileOps(),
  fileMoved: vi.fn((from: string, to: string, kind: Kind) =>
    workspace.fileOps.tell({ op: 'moved', from, to, kind, root: '/s/Home' }),
  ),
}

vi.mock('../../workspace.svelte', () => ({ workspace }))

/** Everything the crate was asked, by command. */
const asked: { command: string; args: Record<string, unknown> }[] = []
/** What `agents_ask` answers next: the reader already allowed it, or a question. */
let answer: Record<string, unknown> = { status: 'ok', result: {} }

/** The page as the crate reads it for a capture: the article, or a file as base64. */
const PAGE = {
  url: 'https://docs.example/a',
  title: 'A page',
  html: '<article><p>Words of the page.</p></article>',
}
/** What `agents_capture` answers next. */
let captured: Record<string, unknown> = {}
function reads(result: Record<string, unknown>) {
  captured = { status: 'ok', result: { ...PAGE, ...result }, untrusted: PAGE.url }
}

function crate(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  asked.push({ command, args })
  const path = typeof args.path === 'string' ? args.path : ''

  switch (command) {
    case 'read_tree':
      return Promise.resolve(treeOf(String(args.root)))
    case 'read_note':
      return files.has(path) ? Promise.resolve(files.get(path)) : Promise.reject(new Error('gone'))
    case 'write_note':
      files.set(path, String(args.content))
      return Promise.resolve()
    case 'rename_note': {
      const from = String(args.from)
      const to = String(args.to)
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return Promise.resolve()
    }
    case 'create_folder':
      folders.add(path)
      return Promise.resolve()
    case 'agents_ask':
      return Promise.resolve(answer)
    case 'agents_capture':
      return Promise.resolve(captured)
    case 'save_asset':
      return Promise.resolve(`files/${String(args.name)}`)
    case 'agents_log':
      return Promise.resolve(log)
    default:
      return Promise.resolve(null)
  }
}

vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => crate(command, args),
}))

vi.mock('../../sharing.svelte', () => ({
  isShared: (root: string) => root === '/s/Home',
  canWriteAt: () => true,
}))

/** What each space's index was asked, by root. */
const indexed: { root: string; asked: string; args: unknown[] }[] = []

vi.mock('../../link-index.svelte', () => {
  class Links {
    root = ''
    archivedIn: (root: string) => ReadonlySet<string> = () => new Set()
    build(root: string) {
      this.root = root
      indexed.push({ root, asked: 'build', args: [] })
      return Promise.resolve()
    }
    scanned() {
      return Promise.resolve()
    }
    backlinks(path: string) {
      indexed.push({ root: this.root, asked: 'backlinks', args: [path] })
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
      return [...files]
        .filter(([at, text]) => at.startsWith(`${this.root}/`) && text.includes(`[[${name}]]`))
        .map(([at]) => ({
          path: at.slice(this.root.length + 1),
          name: '',
          line: 2,
          text: ` [[${name}]] `,
        }))
    }
    outgoing() {
      return []
    }
    retarget(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'retarget', args })
      return Promise.resolve(1)
    }
    notesMoved(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'notesMoved', args })
    }
    noteGone(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'noteGone', args })
    }
    follow(op: FileOp) {
      if (op.op === 'moved') this.notesMoved(op.from, op.to)
      else if (op.op === 'removed') this.noteGone(op.path)
    }
    noteSaved() {
      return undefined
    }
  }
  const links = new Links()
  links.root = '/s/Work'
  return { links, spaceLinks: () => new Links() }
})

vi.mock('../../search/query', () => ({ parseQuery: (text: string) => ({ text }) }))

/** Which roots were searched. */
const searched: string[] = []

vi.mock('../../search/space', () => ({
  searchSpace: (
    root: string,
    query: { text: string },
    _terms: unknown,
    _limit: number,
    found: (batch: { hits: unknown[] }) => void,
    excluded: string[],
  ) => {
    searched.push(root)
    const hits = [...files]
      .filter(([at]) => at.startsWith(`${root}/`) && !excluded.some((one) => at.endsWith(one)))
      .filter(([, text]) => text.toLowerCase().includes(query.text.toLowerCase()))
      .map(([at, text]) => ({
        path: at,
        name: '',
        line: 0,
        text: text.split('\n')[0] ?? '',
        ranges: [],
      }))
    found({ hits })
    return Promise.resolve()
  },
}))

/** The notes' own verbs (lib/agents/docs), which have tests of their own: here, what
 *  they were handed. */
const docs = {
  readNote: vi.fn((at: { path: string; space: string }) => {
    const root = [work, home, secret].find((one) => one.id === at.space)?.root ?? ''
    return Promise.resolve({
      path: at.path,
      space: at.space,
      rev: 'r1',
      open: false,
      typing: false,
      text: files.get(`${root}/${at.path}`) ?? '',
      tasks: [{ anchor: { task: 'Buy milk' }, done: false, line: 2 }],
    })
  }),
  editNote: vi.fn((_agent: unknown, at: { path: string }) =>
    Promise.resolve({ path: at.path, rev: 'r2', edits: 1, lines: [0] }),
  ),
  writeNote: vi.fn((_agent: unknown, at: { path: string }) =>
    Promise.resolve({ path: at.path, rev: 'r2', edits: 1, lines: [0] }),
  ),
}

vi.mock('../docs', async () => ({ ...(await import('../docs/problem')), notes: docs }))

vi.mock('../../commands', () => ({
  appCommands: () => [
    { id: 'files', label: 'File list', run: () => ran.push('files') },
    { id: 'record', label: 'Record', byHand: true, run: () => ran.push('record') },
    { id: 'new-terminal', label: 'New terminal', ownWindow: true, run: () => ran.push('shell') },
    { id: 'close-window', label: 'Close window', run: () => ran.push('close-window') },
    { id: 'publish', label: 'Publish this space as a blog', run: () => ran.push('publish') },
    { id: 'space:home', label: 'Space: Home', run: () => ran.push('space:home') },
  ],
}))
const ran: string[] = []

vi.mock('../../web-tab/pages.svelte', () => ({
  pages: {
    addressOf: () => 'https://docs.example/a',
    read: () =>
      Promise.resolve({
        url: 'https://docs.example/a',
        title: 'A page',
        html: '<article><p>Words of the page.</p></article>',
      }),
  },
}))

vi.mock('../../versions', () => ({
  versionsOf: () => Promise.resolve([{ at: 1_000, size: 9, path: '/h/1', by: '' }]),
  versionText: () => Promise.resolve('old words'),
}))

vi.mock('../../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

vi.mock('../../terminal/shells.svelte', () => ({
  shells: { ask: () => Promise.resolve([]), chosen: { id: 'pwsh', name: 'PowerShell' } },
}))

/** What `agents_log` holds for today. */
let log: unknown[] = []

const { runAgentVerb, AGENT_VERBS, answerTheCrate } = await import('./index')
const { forgetIndexes } = await import('./links')

// ---- the agent ---------------------------------------------------------------------------

const EVERY = [
  'context',
  'notes.read',
  'notes.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'settings',
  'terminal',
]

function agent(change: Record<string, unknown> = {}): Caller {
  return callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes: EVERY,
    spaces: ['Work', 'Home'],
    mode: 'unsupervised',
    programs: ['git'],
    ...change,
  })
}

function call(verb: string, args: Record<string, unknown>, caller: Caller = agent()) {
  return runAgentVerb(verb, args, caller)
}

beforeEach(() => {
  files.clear()
  folders.clear()
  files.set('/s/Work/Plan.md', '# Plan\n')
  files.set('/s/Work/Pinned.md', '# Pinned\n')
  files.set('/s/Home/Recipes.md', '# Recipes\n\nSee [[Soup]] tonight.\n')
  files.set('/s/Home/Soup.md', '# Soup\n\n- [ ] Buy milk\n')
  files.set('/s/Home/Old.md', '# Old soup\n')
  files.set('/s/Home/board.canvas', '{"nodes":[],"edges":[]}')
  files.set('/s/Secret/Diary.md', '# Diary\n')
  for (const key of Object.keys(marks)) Reflect.deleteProperty(marks, key)
  asked.length = 0
  indexed.length = 0
  searched.length = 0
  ran.length = 0
  answer = { status: 'ok', result: {} }
  reads({})
  forgetIndexes()
  vi.clearAllMocks()
})

// ---- the tests ---------------------------------------------------------------------------

describe('the verbs', () => {
  test('are the crate list, every one', () => {
    expect([...AGENT_VERBS].sort()).toEqual(Object.keys(AGENT_WINDOW_VERBS).sort())
  })
})

describe('another space, without switching', () => {
  test('an agent reads and writes Home while the reader stays in Work, tabs untouched', async () => {
    const before = JSON.stringify(tabs)

    const calls: [string, Record<string, unknown>][] = [
      ['list_notes', { space: 'Home' }],
      ['search_notes', { space: 'Home', query: 'soup' }],
      ['list_backlinks', { space: 'Home', path: 'Soup' }],
      ['read_note', { space: 'Home', path: 'Soup' }],
      ['read_canvas', { space: 'Home', path: 'board.canvas' }],
      [
        'edit_canvas',
        { space: 'Home', path: 'board.canvas', ops: [{ op: 'add_card', text: 'Hi' }] },
      ],
      ['create_note', { space: 'Home', path: 'Stew', content: '# Stew\n' }],
      ['write_note', { space: 'Home', path: 'Soup', content: '# Soup!\n' }],
      ['append_note', { space: 'Home', path: 'Soup', content: 'More.' }],
      ['set_task', { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true }],
      ['list_versions', { space: 'Home', path: 'Soup' }],
      ['bookmarks', { space: 'Home', op: 'add', path: 'Recipes.md' }],
      ['move_file', { space: 'Home', path: 'Soup.md', to: 'Food/Soup.md' }],
      ['create_folder', { space: 'Home', path: 'Drinks' }],
      ['trash_file', { space: 'Home', path: 'Recipes.md' }],
      ['read_setting', { space: 'Home', key: 'web_data' }],
    ]
    for (const [verb, args] of calls) {
      expect(await call(verb, args), verb).toMatchObject({ ok: true, status: 'ok' })
    }

    expect(workspace.showSpace).not.toHaveBeenCalled()
    expect(workspace.selectSpace).not.toHaveBeenCalled()
    expect(workspace.activeSpace?.name).toBe('Work')
    expect(JSON.stringify(tabs)).toBe(before)
    expect(workspace.openEntry).not.toHaveBeenCalled()
    expect(workspace.close).not.toHaveBeenCalled()
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  test('the tree of Home is read off the disk, and the search asked of Home', async () => {
    const listed = await call('list_notes', { space: 'Home' })
    expect(listed).toMatchObject({
      result: [
        { path: 'board.canvas', kind: 'canvas' },
        { path: 'Recipes.md', kind: 'note' },
        { path: 'Soup.md', kind: 'note' },
      ],
      // Somebody else writes in Home: its names are data.
      untrusted: 'shared space Home',
    })
    expect(asked).toContainEqual({
      command: 'read_tree',
      args: { root: '/s/Home', options: { showHidden: false } },
    })

    const found = await call('search_notes', { space: 'Home', query: 'soup' })
    expect(searched).toEqual(['/s/Home'])
    // The archived note is left out, as the Search panel leaves it out.
    expect(found).toMatchObject({
      result: [
        { space: 'Home', path: 'Recipes.md', line: 1 },
        { space: 'Home', path: 'Soup.md', line: 1 },
      ],
    })
  })

  test('the backlinks of Home come from an index of Home, not the window own', async () => {
    const answered = await call('list_backlinks', { space: 'Home', path: 'Soup' })
    expect(answered).toMatchObject({ result: [{ path: 'Recipes.md', line: 3 }] })
    expect(indexed).toContainEqual({ root: '/s/Home', asked: 'build', args: [] })
  })

  test('a move in Home rewrites the links through Home and tells its stores, off the reader undo', async () => {
    await call('move_file', { space: 'Home', path: 'Soup.md', to: 'Food/Soup' })

    expect(files.has('/s/Home/Food/Soup.md')).toBe(true)
    expect(indexed).toContainEqual({
      root: '/s/Home',
      asked: 'retarget',
      args: ['/s/Home/Soup.md', '/s/Home/Food/Soup.md', '/s/Home'],
    })
    expect(workspace.fileMoved).toHaveBeenCalledWith(
      '/s/Home/Soup.md',
      '/s/Home/Food/Soup.md',
      'file',
    )
    // And the index of Home hears it the way every store does: said once, followed.
    expect(indexed).toContainEqual({
      root: '/s/Home',
      asked: 'notesMoved',
      args: ['/s/Home/Soup.md', '/s/Home/Food/Soup.md'],
    })
    // The tree's own rename is the open space's, and its undo the reader's.
    expect(workspace.rename).not.toHaveBeenCalled()
    expect(workspace.moveMany).not.toHaveBeenCalled()
  })

  test('the space that is open takes the tree own rename', async () => {
    await call('move_file', { path: 'Plan.md', to: 'Old plan' })
    expect(workspace.rename).toHaveBeenCalledWith('/s/Work/Plan.md', 'Old plan.md')
  })

  test('a space the grant does not reach does not exist', async () => {
    const listed = await call('list_spaces', {})
    expect(listed).toMatchObject({ result: [{ name: 'Work', open: true }, { name: 'Home' }] })
    expect(JSON.stringify(listed)).not.toContain('Secret')

    for (const verb of ['read_note', 'list_notes', 'search_notes', 'trash_file']) {
      expect(await call(verb, { space: 'Secret', path: 'Diary', query: 'x' }), verb).toMatchObject({
        code: 'no_such_space',
        message: 'there is no space called Secret',
      })
    }
    // Searching everywhere is everywhere it may reach.
    await call('search_notes', { query: 'diary' })
    expect(searched).toEqual(['/s/Work', '/s/Home'])
  })

  test('the reader own command line reaches every space', async () => {
    expect(await call('list_notes', { space: 'Secret' }, READER)).toMatchObject({
      result: [{ path: 'Diary.md' }],
    })
  })
})

describe('the tree', () => {
  test('hides what is archived unless asked, and filters by kind and folder', async () => {
    expect(await call('list_notes', { space: 'Home', archived: true, kind: 'note' })).toMatchObject(
      {
        result: [{ path: 'Old.md', archived: true }, { path: 'Recipes.md' }, { path: 'Soup.md' }],
      },
    )
    expect(await call('list_notes', { space: 'Home', kind: 'sticker' })).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('never writes over a file, never puts a folder inside itself, and leaves hidden ones be', async () => {
    expect(
      await call('move_file', { space: 'Home', path: 'Soup.md', to: 'Recipes' }),
    ).toMatchObject({
      code: 'exists',
    })
    folders.add('/s/Home/Food')
    expect(
      await call('move_file', { space: 'Home', path: 'Food', to: 'Food/Inner' }),
    ).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('trash_file', { space: 'Home', path: '.obsidian/app.json' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(
      await call('move_file', { space: 'Home', path: '../Work/Plan.md', to: 'x' }),
    ).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('trashes to Recently deleted with the agent named, never the archive, never a changed note', async () => {
    expect(await call('trash_file', { space: 'Home', path: 'Old.md' })).toMatchObject({
      code: 'archived',
    })
    expect(
      await call('trash_file', { space: 'Home', path: 'Soup', if_rev: 'stale' }),
    ).toMatchObject({
      code: 'rev_changed',
    })
    expect(await call('trash_file', { space: 'Home', path: 'Soup' })).toMatchObject({
      result: { path: 'Soup.md', trashed: true },
    })
    expect(workspace.remove).toHaveBeenCalledWith('/s/Home/Soup.md', false, 'Claude Code')
  })

  test('closes a tab of the reader only with workspace.focus', async () => {
    expect(
      await call('trash_file', { path: 'Plan.md' }, agent({ scopes: ['tree'] })),
    ).toMatchObject({ code: 'not_granted' })
    expect(workspace.remove).not.toHaveBeenCalled()
    expect(await call('trash_file', { path: 'Plan.md' })).toMatchObject({ status: 'ok' })
  })

  test('makes a folder once', async () => {
    expect(await call('create_folder', { path: 'Ideas' })).toMatchObject({ result: { made: true } })
    expect(await call('create_folder', { path: 'Ideas' })).toMatchObject({
      result: { made: false },
    })
    expect(workspace.loadTree).toHaveBeenCalled()
  })
})

describe('the reader tabs', () => {
  test('opens behind the tab in front, and nothing more without workspace.focus', async () => {
    await call('workspace_tabs', { op: 'open', path: 'Pinned.md' })
    expect(workspace.openEntry).toHaveBeenCalledWith('/s/Work/Pinned.md', {
      activate: false,
      beside: true,
    })

    const plain = agent({ scopes: ['workspace'] })
    for (const [args, why] of [
      [{ op: 'open', path: 'Plan.md', background: false }, 'opening in front'],
      [{ op: 'open', path: 'Soup.md', space: 'Home' }, 'another space'],
      [{ op: 'focus', tab: 't2' }, 'bringing a tab to the front'],
      [{ op: 'split', tab: 't1' }, 'a split'],
      [{ op: 'close', tab: 't1' }, 'closing a tab the reader can see'],
    ] as const) {
      expect(await call('workspace_tabs', args, plain), why).toMatchObject({
        code: 'not_granted',
        message: `${why} needs workspace.focus, which this agent was not granted`,
      })
    }
    expect(workspace.showSpace).not.toHaveBeenCalled()
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  test('a pinned tab is the reader to close', async () => {
    expect(await call('workspace_tabs', { op: 'close', tab: 't2' })).toMatchObject({
      code: 'by_hand',
    })
  })

  test('lists them, a page title marked as the page', async () => {
    expect(await call('workspace_tabs', { op: 'list' })).toMatchObject({
      result: [{ id: 't1', path: 'Plan.md', front: true }, { id: 't2' }, { id: 'w1', kind: 'web' }],
      untrusted: 'tab titles',
    })
  })

  test('the context says where the reader is', async () => {
    expect(await call('get_context', {})).toMatchObject({
      result: {
        space: 'Work',
        front: { id: 't1', path: 'Plan.md' },
        selection: null,
        typing: false,
      },
    })
  })
})

describe('what asks the reader first', () => {
  test('a version put back is deleting for good, and goes through once allowed', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'Put back' }
    expect(
      await call('restore_version', { space: 'Home', path: 'Soup', version: 'device:1000' }),
    ).toEqual({ ok: true, status: 'needs_approval', approval: 'a1', summary: 'Put back' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      agent: 'claude-code',
      category: 'deleting',
    })
    expect(docs.writeNote).not.toHaveBeenCalled()

    answer = { status: 'ok', result: {} }
    await call('restore_version', { space: 'Home', path: 'Soup', version: 'device:1000' })
    // What it replaced kept first, said to be the agent's doing, then one edit.
    expect(asked).toContainEqual({
      command: 'snapshot_note',
      args: {
        path: '/s/Home/Soup.md',
        content: '# Soup\n\n- [ ] Buy milk\n',
        source: 'Claude Code',
      },
    })
    expect(docs.writeNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      'old words',
    )
  })

  test('a setting asks, and a value it cannot be is refused before anybody is asked', async () => {
    expect(await call('write_setting', { key: 'scheme', value: 'purple' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
    expect(await call('read_setting', { key: 'sync_token' })).toMatchObject({
      code: 'no_such_setting',
    })

    answer = { status: 'needs_approval', approval: 'a2', summary: 'Change scheme' }
    expect(await call('write_setting', { key: 'scheme', value: 'dark' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'settings',
    })
  })

  test('the palette: never by hand or the window, publishing asks, moving the reader needs focus', async () => {
    for (const id of ['record', 'new-terminal', 'close-window']) {
      expect(await call('run_command', { id }), id).toMatchObject({ code: 'by_hand' })
    }
    expect(
      await call('run_command', { id: 'space:home' }, agent({ scopes: ['workspace'] })),
    ).toMatchObject({
      code: 'not_granted',
    })

    answer = { status: 'needs_approval', approval: 'a3', summary: 'Publish' }
    expect(await call('run_command', { id: 'publish' })).toMatchObject({ status: 'needs_approval' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'publishing',
    })

    expect(await call('run_command', { id: 'files' })).toMatchObject({ result: { id: 'files' } })
    expect(ran).toEqual(['files'])
  })

  test('in confirm mode every write asks, as a write', async () => {
    answer = { status: 'needs_approval', approval: 'a4', summary: 'Edit' }
    const careful = agent({ mode: 'confirm' })
    expect(
      await call(
        'edit_note',
        { space: 'Home', path: 'Soup', edits: [{ at: { end: true }, insert_after: 'x' }] },
        careful,
      ),
    ).toMatchObject({ status: 'needs_approval' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'writing',
    })
    expect(docs.editNote).not.toHaveBeenCalled()

    // A read asks nothing.
    asked.length = 0
    await call('read_note', { space: 'Home', path: 'Soup' }, careful)
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('the terminal: never the command line, and a program off the list asks', async () => {
    expect(await call('run_terminal', { command: 'git status' }, READER)).toMatchObject({
      code: 'by_hand',
    })

    answer = { status: 'needs_approval', approval: 'a5', summary: 'rm' }
    for (const command of ['rm -rf build', 'git status; rm -rf ~']) {
      asked.length = 0
      expect(await call('run_terminal', { command }), command).toMatchObject({
        status: 'needs_approval',
      })
      expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
        category: 'terminal',
        summary: command,
      })
    }
  })
})

describe('the notes, on the road', () => {
  test('a note of a shared space is read as data', async () => {
    expect(await call('read_note', { space: 'Home', path: 'Soup' })).toMatchObject({
      untrusted: 'shared space Home',
    })
    expect(await call('read_note', { path: 'Plan' })).not.toHaveProperty('untrusted')
  })

  test('a property is one edit of the whole note against the words it was worked out from', async () => {
    await call('set_property', {
      space: 'Home',
      path: 'Soup',
      key: 'tags',
      value: ['food', 'warm'],
    })
    expect(docs.writeNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      '---\ntags: [food, warm]\n---\n# Soup\n\n- [ ] Buy milk\n',
      'r1',
    )
  })

  test('a task is ticked on its own line', async () => {
    await call('set_task', { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true })
    expect(docs.editNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      [{ at: { task: 'Buy milk' }, replace: '- [x] Buy milk' }],
      'r1',
    )
  })

  test('a new note is never written over one, and write_note makes one that is not there', async () => {
    expect(await call('create_note', { space: 'Home', path: 'Soup' })).toMatchObject({
      code: 'exists',
    })
    expect(
      await call('write_note', { space: 'Home', path: 'Broth', content: '# Broth\n' }),
    ).toMatchObject({
      result: { path: 'Broth.md', created: true },
    })
    expect(files.get('/s/Home/Broth.md')).toBe('# Broth\n')
  })
})

describe('a page into a note', () => {
  /** The one crate call a capture made, if any. */
  const capture = () => asked.find((one) => one.command === 'agents_capture')?.args
  const saved = () => asked.find((one) => one.command === 'save_asset')?.args

  test('is the markdown the clip button writes, with its source, read by the crate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'))
    try {
      const answered = await call('capture_to_note', { tab: 'w1', as: 'clip' })
      // The note is named after the page, so the answer is the page's words too.
      expect(answered).toMatchObject({
        result: { path: 'A page.md', created: true },
        untrusted: 'https://docs.example/a',
      })

      const { clipNote } = await import('../../web-tab/note')
      const clip = await clipNote(PAGE, new Date())
      expect(files.get('/s/Work/A page.md')).toBe(clip)
      expect(clip).toContain('source: https://docs.example/a')
      expect(capture()).toMatchObject({ agent: 'claude-code', tab: 'w1', shape: 'clip' })
    } finally {
      vi.useRealTimers()
    }
  })

  test('an agent tab is clipped the same way, through the crate', async () => {
    const answered = await call('capture_to_note', { tab: 'a1', as: 'clip', note: 'Research' })
    expect(answered).toMatchObject({ result: { path: 'Research.md', created: true } })
    expect(files.get('/s/Work/Research.md')).toContain('Words of the page.')
    expect(capture()).toMatchObject({ agent: 'claude-code', tab: 'a1', shape: 'clip' })
  })

  test('a screenshot is a picture kept beside the note, the whole page when asked', async () => {
    reads({ html: undefined, png: btoa('PNG bytes') })
    await call('capture_to_note', { tab: 'a1', as: 'screenshot', full_page: true })

    expect(capture()).toMatchObject({ shape: 'screenshot', fullPage: true })
    const kept = saved()
    expect(String(kept?.name)).toMatch(/^page-[\d-]+\.png$/)
    expect(kept?.bytes).toEqual([80, 78, 71, 32, 98, 121, 116, 101, 115])
    expect(files.get('/s/Work/A page.md')).toContain(`![[files/${String(kept?.name)}]]`)
  })

  test('a PDF is printed on the reader own paper and kept beside the note', async () => {
    reads({ html: undefined, pdf: btoa('%PDF-1.7') })
    await call('capture_to_note', { tab: 'a1', as: 'pdf' })

    // The A4 and the 20 mm the app's page setup starts on.
    expect(capture()).toMatchObject({
      shape: 'pdf',
      fullPage: false,
      page: { width: 8.27, height: 11.69, margin: 0.787, landscape: false },
    })
    expect(String(saved()?.name)).toMatch(/\.pdf$/)
    expect(files.get('/s/Work/A page.md')).toMatch(/!\[\[files\/page-[\d-]+\.pdf\]\]/)
  })

  test('the crate refusal is the answer, code and all, and nothing is written', async () => {
    captured = {
      status: 'error',
      code: 'password_field',
      message: 'a filled secret field is on the page',
    }
    expect(await call('capture_to_note', { tab: 'a1', as: 'pdf' })).toMatchObject({
      ok: false,
      status: 'error',
      code: 'password_field',
      message: 'a filled secret field is on the page',
    })
    expect(saved()).toBeUndefined()
    expect(files.has('/s/Work/A page.md')).toBe(false)

    captured = { status: 'error', code: 'paused_by_reader', message: 'the reader is using it' }
    expect(await call('capture_to_note', { tab: 'w1', as: 'clip' })).toMatchObject({
      code: 'paused_by_reader',
    })
  })

  test('needs the reader tabs scope for a tab of the reader, and browser for its own', async () => {
    expect(
      await call('capture_to_note', { tab: 'w1', as: 'link' }, agent({ scopes: ['notes.write'] })),
    ).toMatchObject({ code: 'not_granted' })
    expect(
      await call(
        'capture_to_note',
        { tab: 'a1', as: 'clip' },
        agent({ scopes: ['notes.write', 'browser.reader'] }),
      ),
    ).toMatchObject({ code: 'not_granted' })
    expect(capture()).toBeUndefined()
  })

  test('a reader tab in a space the agent may not reach is not there', async () => {
    expect(
      // Into Home, which it may reach, from a tab of Work, which it may not.
      await call(
        'capture_to_note',
        { tab: 'w1', as: 'clip', space: 'Home' },
        agent({ spaces: ['Home'] }),
      ),
    ).toMatchObject({ code: 'no_such_space' })
    expect(capture()).toBeUndefined()
  })

  test('where the engine has no road, a reader tab is clipped the button way and never photographed', async () => {
    captured = {
      status: 'error',
      code: 'unsupported_on_this_engine',
      message: 'capturing a page is not available on this engine yet',
    }
    expect(await call('capture_to_note', { tab: 'w1', as: 'clip' })).toMatchObject({
      result: { path: 'A page.md' },
    })
    expect(files.get('/s/Work/A page.md')).toContain('Words of the page.')

    for (const shape of ['screenshot', 'pdf']) {
      expect(await call('capture_to_note', { tab: 'w1', as: shape }), shape).toMatchObject({
        code: 'unsupported_on_this_engine',
      })
    }
    expect(saved()).toBeUndefined()
  })

  test('a reader page put away is clipped as its address, and not printed', async () => {
    captured = { status: 'error', code: 'no_such_tab', message: 'there is no tab w1' }
    await call('capture_to_note', { tab: 'w1', as: 'clip', note: 'Kept' })
    expect(files.get('/s/Work/Kept.md')).toContain('<https://docs.example/a>')

    expect(await call('capture_to_note', { tab: 'w1', as: 'pdf' })).toMatchObject({
      code: 'failed',
    })
  })

  test('says which shapes there are', async () => {
    expect(await call('capture_to_note', { tab: 'w1', as: 'gif' })).toMatchObject({
      code: 'bad_arguments',
      message: 'as is one of clip, screenshot, pdf, link',
    })
  })
})

describe('the log into a note', () => {
  test('is this agent calls of the day, each with what it touched', async () => {
    log = [
      {
        at: Date.parse('2026-09-30T09:00:01Z'),
        agent: 'claude-code',
        verb: 'read_note',
        args: { path: 'Soup.md' },
        status: 'ok',
      },
      {
        at: Date.parse('2026-09-30T09:00:02Z'),
        agent: 'someone-else',
        verb: 'read_note',
        args: { path: 'Diary.md' },
        status: 'ok',
      },
      {
        at: Date.parse('2026-09-30T09:00:03Z'),
        agent: 'claude-code',
        verb: 'browser_open',
        args: { url: 'https://docs.example/' },
        status: 'error',
        code: 'site_denied',
      },
    ]

    await call('attach_agent_log', { note: 'Session', session: '2026-09-30' })
    expect(files.get('/s/Work/Session.md')).toBe(
      '## Claude Code, 2026-09-30\n\n- 09:00:01 `read_note` [[Soup]]\n- 09:00:03 `browser_open` <https://docs.example/> - error (site_denied)\n',
    )
  })
})

describe('what the crate asks', () => {
  test('the reader web tabs, with their space and whether in front', async () => {
    expect(await answerTheCrate('agent.reader_tabs', {})).toEqual([
      {
        id: 'w1',
        title: 'Docs',
        url: 'https://docs.example/a',
        space: 'Work',
        front: false,
        on_screen: true,
      },
    ])
  })

  test('which store a space keeps a site in, and a page as the clipper words it', async () => {
    expect(
      await answerTheCrate('agent.store_for', { space: 'Home', url: 'https://a.example/' }),
    ).toEqual({
      space: 'Home',
      store: null,
    })
    expect(
      await answerTheCrate('agent.markdown', {
        html: '<h2>Title</h2><p>A <b>bold</b> word.</p>',
        url: 'x',
      }),
    ).toBe('## Title\n\nA **bold** word.')
  })
})
