import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The list of spaces, driven by a stand-in store.
 *
 *  Three rules are what this is about, and all three are about two machines
 *  agreeing. Ids survive a reload, so the space that was open still is. The order is
 *  the account's rather than the folder's, so a listing that comes back
 *  alphabetical does not undo every move. And a space that is renamed takes its
 *  four per-space stores with it, while a space that goes is forgotten by all of
 *  them. */

const sent: { command: string; args: Record<string, unknown> }[] = []

/** What `list_spaces` answers, and what `create_space` and `rename_space` will
 *  make of a name. Set per test. */
let listed: { name: string; path: string }[] = []
let refuses = false

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push({ command, args: args ?? {} })

    if (command === 'list_spaces') return Promise.resolve(listed)
    if (refuses) return Promise.reject(new Error('the disk said no'))

    if (command === 'create_space' || command === 'rename_space') {
      const name = typeof args?.name === 'string' ? args.name : ''
      return Promise.resolve({ name, path: `/spaces/${name}` })
    }

    return Promise.resolve('')
  },
}))

vi.mock('../account.svelte', () => ({ account: { signedIn: false } }))

const { applySpaceOrder, deleteSpace, loadSpaces, moveSpace, renameSpace } =
  await import('./spaces')
type HoldsSpaces = import('./spaces').HoldsSpaces
type Space = import('../workspace.svelte').Space

/** A store holding the spaces given, with the first of them open. The five things
 *  a space's own stores are asked are recorded rather than done. */
function store(spaces: Space[]) {
  const told: string[] = []
  const follows = (name: string) => ({
    spaceMoved: (from: string, to: string) => void told.push(`${name} ${from} -> ${to}`),
    forget: (root: string) => void told.push(`${name} forgot ${root}`),
  })

  const ws = {
    // Copies: a rename writes the new name and root into the space it was given,
    // which is what makes one list of spaces the one thing they are all read from.
    spaces: spaces.map((one) => ({ ...one })),
    activeSpaceId: spaces[0]?.id ?? null,
    tree: null,
    naming: { path: '/spaces/Work', appending: false, making: null },
    panel: null,
    notes: [],
    tabs: [],
    documents: [],
    bookmarks: { migrate: (roots: string[]) => void told.push(`migrated ${roots.join()}`) },
    device: {
      moveIcon: (from: string, to: string) => void told.push(`icon ${from} -> ${to}`),
    },
    folderIcons: follows('folder icons'),
    graphSettings: follows('graph'),
    excluded: follows('left out'),
    archivedFolders: follows('archived folders'),
    close: (id: string) => void told.push(`closed ${id}`),
    clearSelection: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }

  return { ws: ws as unknown as HoldsSpaces, told }
}

const WORK = { id: 'w', name: 'Work', root: '/spaces/Work' }
const HOME = { id: 'h', name: 'Home', root: '/spaces/Home' }

beforeEach(() => {
  sent.length = 0
  listed = []
  refuses = false
})

describe('reading the spaces folder', () => {
  test('keeps the id of a space that is already known', async () => {
    const { ws } = store([WORK, HOME])
    listed = [
      { name: 'Home', path: '/spaces/Home' },
      { name: 'Work', path: '/spaces/Work' },
    ]

    await loadSpaces(ws)

    // The listing came back the other way round; the order on screen is the one
    // the account settled, and the ids are the ones the session wrote down.
    expect(ws.spaces.map((one) => one.id)).toEqual(['w', 'h'])
    expect(ws.activeSpaceId).toBe('w')
  })

  test('and a space that is new to this machine gets an id and goes last', async () => {
    const { ws } = store([WORK])
    listed = [
      { name: 'Ideas', path: '/spaces/Ideas' },
      { name: 'Work', path: '/spaces/Work' },
    ]

    await loadSpaces(ws)

    expect(ws.spaces.map((one) => one.name)).toEqual(['Work', 'Ideas'])
    expect(ws.spaces[1]?.id).toBeTruthy()
  })

  test('and a space that has gone leaves the open one settled on what is left', async () => {
    const { ws } = store([WORK, HOME])
    ws.activeSpaceId = 'h'
    listed = [{ name: 'Work', path: '/spaces/Work' }]

    await loadSpaces(ws)

    expect(ws.spaces.map((one) => one.id)).toEqual(['w'])
    expect(ws.activeSpaceId).toBe('w')
  })

  test('and none at all leaves nothing open', async () => {
    const { ws } = store([WORK])
    await loadSpaces(ws)

    expect(ws.spaces).toEqual([])
    expect(ws.activeSpaceId).toBeNull()
  })
})

describe('the order the switcher shows', () => {
  test('takes the account’s, and says it moved', () => {
    const { ws } = store([WORK, HOME])
    expect(applySpaceOrder(ws, ['Home', 'Work'])).toBe(true)
    expect(ws.spaces.map((one) => one.name)).toEqual(['Home', 'Work'])
  })

  test('and stays quiet where the account says what is already on show', () => {
    const { ws } = store([WORK, HOME])
    expect(applySpaceOrder(ws, ['Work', 'Home'])).toBe(false)
  })

  test('and keeps the place of a space the account has never heard of', () => {
    const { ws } = store([WORK, HOME, { id: 'l', name: 'Local', root: '/spaces/Local' }])
    applySpaceOrder(ws, ['Home', 'Work'])

    expect(ws.spaces.map((one) => one.name)).toEqual(['Home', 'Work', 'Local'])
  })

  test('a drag that ends where it started is quiet', () => {
    const { ws } = store([WORK, HOME])
    expect(moveSpace(ws, 'w', 'h')).toBe(false)
    expect(moveSpace(ws, 'w', 'w')).toBe(false)
  })

  test('and a drag to the end moves it', () => {
    const { ws } = store([WORK, HOME])
    expect(moveSpace(ws, 'w', null)).toBe(true)
    expect(ws.spaces.map((one) => one.id)).toEqual(['h', 'w'])
  })
})

describe('a space renamed', () => {
  test('takes its folder icons, its graph, its exclusions and its archive with it', async () => {
    const { ws, told } = store([WORK])
    await renameSpace(ws, 'w', 'Studio')

    expect(ws.spaces[0]).toEqual({ id: 'w', name: 'Studio', root: '/spaces/Studio' })
    expect(told).toEqual([
      'icon /spaces/Work -> /spaces/Studio',
      'folder icons /spaces/Work -> /spaces/Studio',
      'graph /spaces/Work -> /spaces/Studio',
      'left out /spaces/Work -> /spaces/Studio',
      'archived folders /spaces/Work -> /spaces/Studio',
    ])
  })

  test('and the field it was typed in is done with, whatever the folder answers', async () => {
    const { ws } = store([WORK])
    refuses = true
    await renameSpace(ws, 'w', 'Studio')

    expect(ws.naming).toBeNull()
    expect(ws.spaces[0]?.name).toBe('Work')
  })

  test('and a name of nothing at all is not a rename', async () => {
    const { ws } = store([WORK])
    await renameSpace(ws, 'w', '   ')

    expect(sent).toEqual([])
    expect(ws.spaces[0]?.name).toBe('Work')
  })
})

describe('a space deleted', () => {
  test('is forgotten by each of its own stores, and the next one opens', async () => {
    const { ws, told } = store([WORK, HOME])
    await deleteSpace(ws, 'w')

    expect(ws.spaces.map((one) => one.id)).toEqual(['h'])
    expect(told).toEqual([
      'folder icons forgot /spaces/Work',
      'graph forgot /spaces/Work',
      'left out forgot /spaces/Work',
      'archived folders forgot /spaces/Work',
    ])
    expect(ws.activeSpaceId).toBe('h')
  })

  test('goes to this device’s trash while there is no account to keep it', async () => {
    const { ws } = store([WORK])
    await deleteSpace(ws, 'w')

    expect(sent.map((one) => one.command)).toEqual(['trash_item'])
  })

  test('and a folder that will not go leaves the list alone', async () => {
    const { ws } = store([WORK, HOME])
    refuses = true
    await deleteSpace(ws, 'w')

    expect(ws.spaces.map((one) => one.id)).toEqual(['w', 'h'])
  })
})
