/** Every kind of tab, as an agent sees and works it: where the reader is and what they
 *  have selected, a tab of each kind made behind the one in front, a page, the graph and
 *  the scratchpad's card shown, a tab renamed and saved, a note, a canvas and a terminal
 *  reached by the tab's id - and, the core of it, what none of these does without
 *  `workspace.focus`: change what the reader is looking at (docs/agent-native.md 5.4).
 *
 *  The window is a stand-in that writes down what it was asked, the way
 *  workspace.test.ts stands one in. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf, type Caller } from '../../automation/caller'

vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

// ---- the window ------------------------------------------------------------------------

const work = { id: 'work', name: 'Work', root: '/s/Work' }

interface FakeTab {
  id: string
  kind: string
  path: string | null
  paneId: string
  pinned: boolean
  shown: string
  doc: string
  page?: number
  note: {
    kind: string
    path: string | null
    shared: string | null
    home: string | null
    name: string
    live: { readerAt: number | null }
  }
}

function tab(id: string, kind: string, path: string | null, more: Partial<FakeTab> = {}): FakeTab {
  return {
    id,
    kind,
    path,
    paneId: 'p1',
    pinned: false,
    shown: id,
    doc: '',
    note: { kind, path, shared: null, home: 'work', name: 'Untitled', live: { readerAt: null } },
    ...more,
  }
}

let tabs: FakeTab[] = []
/** The tab in front of each pane. */
const showing: Record<string, string> = {}

const workspace = {
  spaces: [work],
  activeSpaceId: 'work',
  activeSpace: work,
  get tabs() {
    return tabs
  },
  activeTabId: 'n1',
  previewTabId: null as string | null,
  panes: { focusedId: 'p1' },
  get active() {
    return tabs.find((one) => one.id === this.activeTabId) ?? null
  },
  get tree() {
    return {
      name: 'Work',
      path: '/s/Work',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        {
          name: 'Plan.md',
          path: '/s/Work/Plan.md',
          is_dir: false,
          modified: 1,
          created: 1,
          children: [],
        },
      ],
    }
  },
  outside: (path: string) => !path.startsWith('/s/Work/'),
  showing: (pane: string) => tabs.find((one) => one.id === showing[pane]) ?? null,
  spaceOf: (note: { home: string | null }) => note.home,
  webAddressOf: () => null,
  documentAt: () => null,
  noteText: (path: string) => Promise.resolve(path === '/s/Work/Plan.md' ? '# Plan\n' : null),
  openUnsaved: vi.fn(
    (kind: string, _text: string, _name?: string, _beside?: string | null, _activate?: boolean) => {
      const made = tab(`new-${kind}`, kind, null)
      tabs.push(made)
      return made
    },
  ),
  openPage: vi.fn((url: string) => {
    const made = tab('web-new', 'web', null)
    tabs.push(made)
    return url ? made.id : null
  }),
  openGraph: vi.fn(),
  open: vi.fn(() => Promise.resolve()),
  openEntry: vi.fn(() => Promise.resolve()),
  save: vi.fn((_tab: FakeTab, folder: string, file: string) =>
    Promise.resolve(`${folder}/${file}`),
  ),
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve()),
  activate: vi.fn(),
  close: vi.fn(),
  split: vi.fn(),
  showSpace: vi.fn(),
  loadTree: vi.fn(() => Promise.resolve()),
  scheduleSession: vi.fn(),
}

vi.mock('../../workspace.svelte', () => ({ workspace }))

/** What `agents_ask` answers next. */
let answer: Record<string, unknown> = { status: 'ok', result: {} }
const asked: { command: string; args: Record<string, unknown> }[] = []

vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    return Promise.resolve(command === 'agents_ask' ? answer : null)
  },
}))

vi.mock('../../sharing.svelte', () => ({ isShared: () => false, canWriteAt: () => true }))
vi.mock('../../web-tab/pages.svelte', () => ({ pages: { addressOf: () => null } }))
vi.mock('../../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../../sync.svelte', () => ({ sync: { nudge: () => undefined } }))
vi.mock('../../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../../modes.svelte', () => ({ modes: { pagesPaper: 'a4' } }))
const settings = { show: vi.fn() }
vi.mock('../../settings.svelte', () => ({ settings }))

const openDocument = vi.fn((_path: string) => Promise.reject(new Error('no PDF here')))
vi.mock('../../pdf/document', () => ({ openDocument }))

/** Recently deleted: a note of this space, one of a space the agent does not reach. */
const trash = {
  error: null as string | null,
  items: [
    {
      id: 'device:1',
      ref: '1',
      kind: 'note',
      name: 'Old.md',
      detail: 'Work/archive',
      deletedAt: 5,
      purgeAt: 9,
      source: 'device',
    },
    {
      id: 'note:2',
      ref: '2',
      kind: 'note',
      name: 'Diary.md',
      detail: 'Secret',
      deletedAt: 4,
      purgeAt: 9,
      source: 'account',
    },
  ],
  load: vi.fn(() => Promise.resolve()),
  restore: vi.fn((_item: unknown) => Promise.resolve()),
}
vi.mock('../../trash.svelte', () => ({ trash }))

const showPad = vi.fn()
vi.mock('../../scratchpad/pad', () => ({
  scratchpad: { where: () => Promise.resolve('/app/Scratchpad.md'), show: showPad },
}))

const docs = {
  readNote: vi.fn((at: { path: string; tab?: string }) =>
    Promise.resolve({ path: at.path, rev: 'r1', text: 'words' }),
  ),
  writeNote: vi.fn((_agent: unknown, at: { path: string; tab?: string }) =>
    Promise.resolve({ path: at.path, rev: 'r2' }),
  ),
  editNote: vi.fn(() => Promise.resolve({ rev: 'r2' })),
}
vi.mock('../docs', async () => ({ ...(await import('../docs/problem')), notes: docs }))

/** The canvas drawn on screen, by document. */
const card = { id: 'card-1', type: 'text', text: 'Idea', x: 0, y: 0, width: 200, height: 60 }
const drawn = {
  picked: ['card-1'],
  canvas: { nodes: [card], edges: [], ink: [] },
  edit: vi.fn(),
}
vi.mock('../../canvas/store.svelte', () => ({
  CanvasStore: { drawing: (note: unknown) => (note === tabs[2]?.note ? drawn : null) },
}))

vi.mock('../../terminal/shells.svelte', () => ({
  shells: {
    ask: () =>
      Promise.resolve([
        { id: 'pwsh', name: 'PowerShell' },
        { id: 'bash', name: 'Git Bash' },
      ]),
    chosen: { id: 'pwsh', name: 'PowerShell' },
  },
}))

const openTerminal = vi.fn((shell: string, _where: unknown) => {
  const made = tab(`term-${shell}`, 'terminal', null)
  tabs.push(made)
  return Promise.resolve(made)
})
vi.mock('../../terminal/open', () => ({ openTerminal }))

const renameTerminal = vi.fn((_tab: unknown, _name: string) => Promise.resolve())
vi.mock('../../terminal/rename', () => ({ renameTerminal }))

/** Which tabs have a shell running. */
const running = new Set<string>()
vi.mock('../../terminal/running', () => ({
  ptyOf: (id: string) => (running.has(id) ? `${id}-1` : undefined),
}))

vi.mock('../../terminal/history', () => ({
  historyOf: () =>
    Promise.resolve({ cols: 80, rows: 24, at: 7, text: '\x1b[32mbuilt\x1b[0m\r\nok\r\n' }),
}))

/** A screen: its rows, what was typed into it, and what it prints back. */
const screen = {
  rows: ['PS C:\\> git status', 'On branch main', ''],
  typed: [] as string[],
}
const term = {
  get buffer() {
    return {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: screen.rows.length - 1,
        length: screen.rows.length,
        getLine: (at: number) => {
          const row = screen.rows[at]
          return row === undefined ? undefined : { isWrapped: false, translateToString: () => row }
        },
      },
    }
  },
  modes: { applicationCursorKeysMode: false },
  getSelection: () => 'On branch',
  input: (data: string) => {
    screen.typed.push(data)
    screen.rows.splice(screen.rows.length - 1, 0, `> ${data.trim()}`, 'done')
  },
  onWriteParsed: () => ({ dispose: () => undefined }),
}
vi.mock('../../terminal/sessions.svelte', () => ({
  sessionOf: () => ({ term, host: { isConnected: true } }),
}))

const { runAgentVerb } = await import('./index')

// ---- the agent ---------------------------------------------------------------------------

const EVERY = ['context', 'notes.read', 'notes.write', 'tree', 'workspace', 'terminal']

function agent(scopes: string[] = EVERY, change: Record<string, unknown> = {}): Caller {
  return callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes,
    spaces: 'all',
    mode: 'unsupervised',
    programs: ['git'],
    sites: { 'bank.example': 'deny' },
    ...change,
  })
}

function call(verb: string, args: Record<string, unknown>, caller: Caller = agent()) {
  return runAgentVerb(verb, args, caller)
}

const focusing = [...EVERY, 'workspace.focus']

beforeEach(() => {
  tabs = [
    tab('n1', 'note', '/s/Work/Plan.md', { shown: 'Plan' }),
    tab('d1', 'note', null, { shown: 'Draft' }),
    tab('c1', 'canvas', null, { paneId: 'p2' }),
    tab('t1', 'terminal', null, {
      shown: 'PowerShell',
      doc: JSON.stringify({ shell: 'pwsh', folder: null, key: 'k1' }),
    }),
    tab('s1', 'note', '/s/Work/Pinned.md', { shown: 'Pinned', pinned: true }),
  ]
  showing.p1 = 'n1'
  showing.p2 = 'c1'
  workspace.activeTabId = 'n1'
  workspace.previewTabId = 'd1'
  running.clear()
  screen.rows = ['PS C:\\> git status', 'On branch main', '']
  screen.typed = []
  answer = { status: 'ok', result: {} }
  asked.length = 0
  vi.clearAllMocks()
})

// ---- the tests ---------------------------------------------------------------------------

describe('where the reader is', () => {
  test('every tab, of every kind, with its pane and its state', async () => {
    const said = (await call('get_context', {})) as { result: Record<string, unknown> }
    expect(said.result).toMatchObject({
      space: 'Work',
      selected: { id: 'n1', kind: 'note', path: 'Plan.md', selected: true, front: true },
      tabs: [
        { id: 'n1', pane: 'p1', front: true },
        { id: 'd1', unsaved: true, preview: true, front: false },
        { id: 'c1', kind: 'canvas', unsaved: true, pane: 'p2', front: true, selected: false },
        { id: 't1', kind: 'terminal', running: false },
        { id: 's1', path: 'Pinned.md', pinned: true },
      ],
    })
  })

  test('the selection is the selected tab kind', async () => {
    workspace.activeTabId = 'c1'
    expect(await call('get_context', {})).toMatchObject({
      result: { selection: { picked: ['card-1'] } },
    })

    workspace.activeTabId = 't1'
    running.add('t1')
    expect(await call('get_context', {})).toMatchObject({
      result: { selection: { running: true, selected: 'On branch' } },
      untrusted: 'tab titles and terminal output',
    })
  })
})

describe('a tab of every kind, made behind the reader', () => {
  test('a note with words, a canvas, a page note: behind, beside the selected tab', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'note', content: 'Hello' }),
    ).toMatchObject({ result: { id: 'new-note', unsaved: true } })
    expect(workspace.openUnsaved).toHaveBeenLastCalledWith('note', '', undefined, 'n1', false)
    // The words go in as the agent's own edit, by the tab.
    expect(docs.writeNote).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Claude Code' }),
      { path: '', tab: 'new-note' },
      'Hello',
    )

    await call('workspace_tabs', { op: 'new', kind: 'canvas' })
    expect(workspace.openUnsaved.mock.lastCall?.slice(0, 1)).toEqual(['canvas'])
    await call('workspace_tabs', { op: 'new', kind: 'pages' })
    expect(workspace.openUnsaved.mock.lastCall?.[0]).toBe('pages')
    expect(workspace.openUnsaved.mock.lastCall?.[4]).toBe(false)
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  test('in front only with workspace.focus', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'note', background: false }),
    ).toMatchObject({ code: 'not_granted' })
    expect(workspace.openUnsaved).not.toHaveBeenCalled()

    await call('workspace_tabs', { op: 'new', kind: 'note', background: false }, agent(focusing))
    expect(workspace.openUnsaved).toHaveBeenLastCalledWith('note', '', undefined, null, true)
  })

  test('a web tab on its page, never a denied site or something not on the web', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'https://docs.example/' }),
    ).toMatchObject({ result: { id: 'web-new' } })
    expect(workspace.openPage).toHaveBeenCalledWith('https://docs.example/', 'behind')

    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'https://login.bank.example/' }),
    ).toMatchObject({ code: 'site_denied' })
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'file:///C:/secret.txt' }),
    ).toMatchObject({ code: 'bad_arguments' })
    expect(workspace.openPage).toHaveBeenCalledTimes(1)
  })

  test('a terminal in the shell and folder asked for, behind', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'terminal', shell: 'git bash', cwd: 'src' }),
    ).toMatchObject({ result: { id: 'term-bash', kind: 'terminal' } })
    expect(openTerminal).toHaveBeenCalledWith('bash', {
      folder: '/s/Work/src',
      beside: 'n1',
      activate: false,
    })

    expect(
      await call('workspace_tabs', { op: 'new', kind: 'terminal', shell: 'fish' }),
    ).toMatchObject({ code: 'bad_arguments', message: expect.stringContaining('Git Bash') })
  })

  test('in confirm mode, a new tab asks first', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'A new note tab' }
    expect(
      await call('workspace_tabs', { op: 'new' }, agent(EVERY, { mode: 'confirm' })),
    ).toMatchObject({ status: 'needs_approval' })
    expect(workspace.openUnsaved).not.toHaveBeenCalled()
  })
})

describe('opening', () => {
  test('a page behind; the graph only in front; the scratchpad behind', async () => {
    await call('workspace_tabs', { op: 'open', url: 'https://docs.example/a' })
    expect(workspace.openPage).toHaveBeenCalledWith('https://docs.example/a', 'behind')

    expect(await call('workspace_tabs', { op: 'open', view: 'graph' })).toMatchObject({
      code: 'not_granted',
    })
    await call('workspace_tabs', { op: 'open', view: 'graph' }, agent(focusing))
    expect(workspace.openGraph).toHaveBeenCalled()

    // The scratchpad is its card, never a tab, and behind leaves the keyboard alone.
    expect(await call('workspace_tabs', { op: 'open', view: 'scratchpad' })).toMatchObject({
      result: { scratchpad: true },
    })
    expect(showPad).toHaveBeenCalledWith(null, false)
    expect(workspace.open).not.toHaveBeenCalled()
  })
})

describe('naming and saving', () => {
  test('a file tab renamed is the file renamed, through the one rename', async () => {
    expect(
      await call('workspace_tabs', { op: 'rename', tab: 'n1', name: 'Roadmap' }),
    ).toMatchObject({ result: { from: 'Plan.md', to: 'Roadmap.md' } })
    expect(workspace.rename).toHaveBeenCalledWith('/s/Work/Plan.md', 'Roadmap.md')
  })

  test('an unsaved tab renamed keeps no file and takes the name', async () => {
    expect(await call('workspace_tabs', { op: 'rename', tab: 'd1', name: 'Ideas' })).toMatchObject({
      result: { id: 'd1' },
    })
    expect(tabs[1]?.note.name).toBe('Ideas')
    await call('workspace_tabs', { op: 'rename', tab: 't1', name: 'Server' })
    expect(renameTerminal).toHaveBeenCalledWith(tabs[3], 'Server')
    expect(await call('workspace_tabs', { op: 'rename', tab: 'd1', name: 'a/b' })).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('an unsaved tab saved at a path, under its kind ending', async () => {
    expect(
      await call('workspace_tabs', { op: 'save', tab: 'c1', path: 'boards/Map' }),
    ).toMatchObject({ result: { path: 'boards/Map.canvas' } })
    expect(workspace.save).toHaveBeenCalledWith(tabs[2], '/s/Work/boards', 'Map.canvas')

    expect(await call('workspace_tabs', { op: 'save', tab: 'n1', path: 'x' })).toMatchObject({
      code: 'exists',
    })
  })
})

describe('a file of every kind', () => {
  /** What was written where, by `write_note`. */
  const written = () =>
    Object.fromEntries(
      asked
        .filter((one) => one.command === 'write_note')
        .map((one) => [String(one.args.path), String(one.args.content)]),
    )

  test('a canvas, a page note and a web note, by ending or by kind', async () => {
    expect(await call('create_note', { path: 'boards/Map.canvas' })).toMatchObject({
      result: { path: 'boards/Map.canvas', created: true },
    })
    expect(await call('create_note', { path: 'Lecture', kind: 'pages' })).toMatchObject({
      result: { path: 'Lecture.pages' },
    })
    expect(
      await call('create_note', { path: 'Docs', kind: 'web', url: 'https://docs.example/' }),
    ).toMatchObject({ result: { path: 'Docs.url' } })

    const files = written()
    expect(JSON.parse(files['/s/Work/boards/Map.canvas'] ?? '')).toMatchObject({ nodes: [] })
    expect(JSON.parse(files['/s/Work/Lecture.pages'] ?? '').nodes).toHaveLength(1)
    expect(files['/s/Work/Docs.url']).toContain('URL=https://docs.example/')
  })

  test('never over a file, never a web note with no address', async () => {
    expect(await call('create_note', { path: 'Plan.md' })).toMatchObject({ code: 'exists' })
    expect(await call('create_note', { path: 'Docs.url' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('create_note', { path: 'x', kind: 'sheet' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(written()).toEqual({})
  })
})

describe('a note and a canvas, by their tab', () => {
  test('a file tab is read as its path; a draft by the tab', async () => {
    await call('read_note', { tab: 'n1' })
    expect(docs.readNote).toHaveBeenLastCalledWith({ path: 'Plan.md', space: 'work' }, undefined)

    await call('read_note', { tab: 'd1' })
    expect(docs.readNote).toHaveBeenLastCalledWith(
      { path: '', space: 'work', tab: 'd1' },
      undefined,
    )

    expect(await call('read_note', { tab: 'c1' })).toMatchObject({ code: 'bad_arguments' })
    expect(await call('read_note', { tab: 'nope' })).toMatchObject({ code: 'no_such_tab' })
  })

  test('the scratchpad is a note by its name, and never a tab', async () => {
    await call('read_note', { tab: 'scratchpad' })
    expect(docs.readNote).toHaveBeenLastCalledWith(
      { path: 'Scratchpad.md', space: 'work', tab: 'scratchpad' },
      undefined,
    )

    await call('write_note', { tab: 'scratchpad', content: 'jotted' })
    expect(docs.writeNote).toHaveBeenLastCalledWith(
      expect.anything(),
      { path: 'Scratchpad.md', space: 'work', tab: 'scratchpad' },
      'jotted',
      undefined,
    )
    expect(workspace.open).not.toHaveBeenCalled()
  })

  test('a canvas drawn and never saved is read and edited by its tab, on the surface', async () => {
    expect(await call('read_canvas', { tab: 'c1' })).toMatchObject({
      result: { path: '', nodes: [card], ink: 0 },
    })

    expect(
      await call('edit_canvas', {
        tab: 'c1',
        ops: [{ op: 'edit_text', id: 'card-1', text: 'Plan' }],
      }),
    ).toMatchObject({ result: { path: '' } })
    expect(drawn.edit).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [expect.objectContaining({ text: 'Plan' })] }),
    )
  })
})

describe('a PDF, Settings and Recently deleted', () => {
  test('a PDF read by its tab is its file', async () => {
    tabs.push(tab('pdf1', 'pdf', '/s/Work/paper.pdf'))
    expect(await call('read_pdf', { tab: 'pdf1' })).toMatchObject({ code: 'failed' })
    expect(openDocument).toHaveBeenCalledWith('/s/Work/paper.pdf')
    expect(await call('read_pdf', { tab: 'n1' })).toMatchObject({ code: 'bad_arguments' })
  })

  test('Settings opens at a section, only with workspace.focus', async () => {
    expect(await call('workspace_tabs', { op: 'open', view: 'settings' })).toMatchObject({
      code: 'not_granted',
    })
    expect(
      await call(
        'workspace_tabs',
        { op: 'open', view: 'settings', section: 'ai' },
        agent(focusing),
      ),
    ).toMatchObject({ result: { settings: 'ai' } })
    expect(settings.show).toHaveBeenCalledWith('ai')
    expect(
      await call(
        'workspace_tabs',
        { op: 'open', view: 'settings', section: 'nope' },
        agent(focusing),
      ),
    ).toMatchObject({ code: 'bad_arguments' })
  })

  test('the list as far as the grant reaches, and one thing put back', async () => {
    const only = agent(EVERY, { spaces: ['Work'] })
    expect(await call('recently_deleted', { op: 'list' }, only)).toMatchObject({
      result: [{ id: 'device:1', name: 'Old.md', from: 'Work/archive' }],
    })
    expect(await call('recently_deleted', { op: 'restore', id: 'note:2' }, only)).toMatchObject({
      code: 'not_found',
    })
    expect(trash.restore).not.toHaveBeenCalled()

    expect(await call('recently_deleted', { op: 'restore', id: 'device:1' }, only)).toMatchObject({
      result: { restored: true, from: 'Work/archive' },
    })
    expect(trash.restore).toHaveBeenCalledWith(trash.items[0])
  })
})

describe('the reader terminals', () => {
  test('read: the screen as lines once running, the lines it came back with before', async () => {
    expect(await call('read_terminal', { tab: 't1' })).toMatchObject({
      result: { tab: 't1', running: false, output: 'built\nok', restored: 7 },
      untrusted: 'terminal output',
    })

    running.add('t1')
    expect(await call('read_terminal', { tab: 't1', lines: 1 })).toMatchObject({
      result: { running: true, output: 'On branch main', truncated: true },
    })
    expect(await call('read_terminal', { tab: 'n1' })).toMatchObject({ code: 'bad_arguments' })
  })

  test('type: an allowed program with Enter goes, and answers what it printed', async () => {
    running.add('t1')
    const said = await call('type_terminal', { tab: 't1', text: 'git log', wait_ms: 1 })
    expect(screen.typed).toEqual(['git log\r'])
    expect(said).toMatchObject({
      result: { typed: 'git log + Enter' },
      untrusted: 'terminal output',
    })
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('type: anything else asks, and Ctrl+C alone does not', async () => {
    running.add('t1')
    answer = { status: 'needs_approval', approval: 'a2', summary: 'rm' }
    expect(await call('type_terminal', { tab: 't1', text: 'rm -rf build' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'terminal',
    })
    expect(screen.typed).toEqual([])

    answer = { status: 'ok', result: {} }
    asked.length = 0
    await call('type_terminal', { tab: 't1', keys: ['Ctrl+C'], wait_ms: 1 })
    expect(screen.typed).toEqual(['\x03'])
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('type: one line, known keys, and never the command line', async () => {
    expect(await call('type_terminal', { tab: 't1', text: 'a\nb' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('type_terminal', { tab: 't1', keys: ['F13'] })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(
      await runAgentVerb('type_terminal', { tab: 't1', text: 'ls' }, { agent: null }),
    ).toMatchObject({ code: 'by_hand' })
  })
})
