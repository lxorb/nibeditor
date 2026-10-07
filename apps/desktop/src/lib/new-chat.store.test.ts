import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A new chat has its place before it has a tab.
 *
 *  Emil, 2026-10-08: *"A chat should never be created 'just' as a new tab with an unknown
 *  save location."* Every way of making one - Ctrl+T's M, the Chats panel's plus, the file
 *  list's New - goes through the file list: a row waits for the name in the folder it was
 *  asked in, and the name typed writes the `.chat` pointer there before the tab opens,
 *  under that name. The disk is a map and the account answers every chat with one id, so
 *  what is asked here is where the pointer is, and whether it was there before the tab. */

const files = new Map<string, string>()
const folders = new Set<string>()
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const CHAT = `c_${'0'.repeat(32)}`

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

function listing(root: string): Entry {
  const node = (path: string, dir: boolean): Entry => ({
    name: path.split('/').pop() ?? path,
    path,
    is_dir: dir,
    modified: 0,
    created: 0,
    children: [],
  })
  const tree = node(root, true)
  const at = new Map<string, Entry>([[root, tree]])
  for (const path of [...folders].sort()) {
    const made = node(path, true)
    at.set(path, made)
    at.get(path.slice(0, path.lastIndexOf('/')))?.children.push(made)
  }
  for (const path of [...files.keys()].sort()) {
    at.get(path.slice(0, path.lastIndexOf('/')))?.children.push(node(path, false))
  }
  return tree
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note': {
        const held = files.get(path)
        return held === undefined ? Promise.reject(new Error(`no ${path}`)) : Promise.resolve(held)
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return Promise.resolve()
      case 'read_tree':
        return Promise.resolve(listing(text(args?.root)))
      case 'file_stamp':
        return Promise.resolve(files.has(path) ? { modified: 1, len: 1 } : null)
      default:
        return Promise.resolve()
    }
  },
}))

/** The account: every chat it is asked for is the one id. */
const asked = vi.hoisted(() => ({ spaces: [] as string[] }))
vi.mock('./chats/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chats/http')>()),
  makeChat: (space: string) => {
    asked.spaces.push(space)
    return Promise.resolve({ v: 1, chat: `c_${'0'.repeat(32)}` })
  },
}))

/** The chats' store, making through the real pointer code and nothing else. */
vi.mock('./chats/store.svelte', async () => {
  const { makePointer } = await import('./chats/pointers')
  return {
    chats: {
      ready: true,
      make: async (folder: string, name: string) => (await makePointer(folder, name))?.path ?? null,
    },
  }
})

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
const { sync } = await import('./sync.svelte')
const { account } = await import('./account.svelte')
const { newKinds } = await import('./new-kinds')
const { makeChat } = await import('./chats/view/open')

/** Each tab opened, with whether its pointer was on the disk as it opened. */
let opened: { path: string | null; name: string; pointer: boolean }[] = []

beforeEach(async () => {
  vi.restoreAllMocks()
  files.clear()
  folders.clear()
  folders.add('/space/Work')
  files.set('/space/Work/Plan.md', '# Plan')
  asked.spaces = []
  opened = []

  Object.defineProperty(account, 'accountToken', { get: () => 'token', configurable: true })
  vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote-space')
  vi.spyOn(sync, 'wrote').mockImplementation(() => undefined)
  const openView = workspace.openView.bind(workspace)
  vi.spyOn(workspace, 'openView').mockImplementation((...args) => {
    const path = args[2]
    opened.push({ path, name: args[1], pointer: path !== null && files.has(path) })
    return openView(...args)
  })

  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.naming = null
  workspace.panel = 'tree'
  await workspace.loadTree()
})

/** The name typed into the row waiting for one, and the chat it makes. */
async function named(name: string) {
  await workspace.makeNamed(`${name}.chat`)
}

function pointerAt(path: string) {
  expect(JSON.parse(files.get(path) ?? '{}')).toEqual({ v: 1, chat: CHAT })
  expect(opened).toEqual([{ path, name: chatName(path), pointer: true }])
  expect(workspace.active?.path).toBe(path)
  expect(workspace.active?.kind).toBe('channel')
  expect(workspace.active?.name).toBe(chatName(path))
}

const chatName = (path: string) => (path.split('/').pop() ?? '').replace(/\.chat$/, '')

describe('a new chat', () => {
  test("from Ctrl+T's M is a row in the list first, and the name places it", async () => {
    workspace.panel = null
    newKinds()
      .find((one) => one.kind === 'chat')
      ?.make()
    await vi.waitFor(() => expect(workspace.naming?.making).toBe('chat'))

    // The list was shown for it, the row is at the space's top, and nothing is made yet:
    // no account call, no file, no tab.
    expect(workspace.panel).toBe('tree')
    expect(workspace.naming?.path).toBe('/space/Chat.chat')
    expect(asked.spaces).toEqual([])
    expect(files.has('/space/Chat.chat')).toBe(false)
    expect(workspace.tabs).toHaveLength(0)

    await named('Launch')
    expect(asked.spaces).toEqual(['remote-space'])
    pointerAt('/space/Launch.chat')
  })

  test("from the Chats panel's plus the same, the Chats panel giving way to the list", async () => {
    workspace.panel = 'chats'
    await makeChat()

    expect(workspace.panel).toBe('tree')
    expect(workspace.naming?.path).toBe('/space/Chat.chat')
    await named('Team')
    pointerAt('/space/Team.chat')
  })

  test("from the file list's New, in the space it was asked in", async () => {
    await makeChat()
    await named('Standup')
    pointerAt('/space/Standup.chat')
  })

  test('in a folder it was asked in, which opens for it', async () => {
    await makeChat('/space/Work')

    expect(workspace.naming?.path).toBe('/space/Work/Chat.chat')
    expect(workspace.isExpanded('/space/Work')).toBe(true)
    await named('Thesis')
    pointerAt('/space/Work/Thesis.chat')
  })

  test('and a name already there is stepped, never written over', async () => {
    files.set('/space/Team.chat', '{"v":1,"chat":"c_other"}\n')
    await workspace.loadTree()

    await makeChat()
    await named('Team')
    pointerAt('/space/Team 2.chat')
    expect(files.get('/space/Team.chat')).toBe('{"v":1,"chat":"c_other"}\n')
  })

  test('left unnamed makes nothing at all', async () => {
    await makeChat()
    workspace.cancelNaming()

    expect(asked.spaces).toEqual([])
    expect([...files.keys()].filter((one) => one.endsWith('.chat'))).toEqual([])
    expect(workspace.tabs).toHaveLength(0)
  })

  test('with no list to name it in, is made at once under a stepped name', async () => {
    workspace.tree = null
    await makeChat()
    pointerAt('/space/Chat.chat')
  })

  test('and a space the account does not hold makes no tab', async () => {
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue(null)
    await makeChat()
    await named('Nowhere')

    expect(files.has('/space/Nowhere.chat')).toBe(false)
    expect(opened).toEqual([])
  })
})
