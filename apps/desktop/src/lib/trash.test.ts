import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The stores read browser storage and the platform shim the moment they are
 *  made, so both are stood in for before they are imported. The device trash
 *  is a small in-memory copy of what trash.rs does. */

const DAY = 24 * 60 * 60 * 1000

interface Entry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
}

/** What an invoke was given, when it is the kind of value it should be:
 *  `args` is a bag of unknowns. */
const text = (value: unknown) => (typeof value === 'string' ? value : '')

const notes = new Map<string, string>()
/** Notes that are there and will not read: another encoding, or a lock. */
const unreadable = new Set<string>()
let deviceTrash: Entry[] = []

/** The one entry a test has just made. Reaching for it by index everywhere
 *  would mean checking for a gap that the line above rules out. */
function onlyTrashed(): Entry {
  const [entry] = deviceTrash
  if (!entry) throw new Error('nothing is in the device trash')
  return entry
}
let counter = 0
const calls: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push(command)
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        if (unreadable.has(path)) throw new Error(`stream did not contain valid UTF-8: ${path}`)
        return notes.get(path) ?? ''
      case 'snapshot_note':
      case 'write_note':
        if (command === 'write_note') notes.set(path, text(args?.content))
        return undefined
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'trash_item': {
        const entry = {
          id: `t${++counter}`,
          kind: String(args?.kind),
          name: path.split('/').pop() ?? path,
          from: path,
          trashedAt: Date.now(),
        }
        deviceTrash.push(entry)
        notes.delete(path)
        return entry
      }
      case 'list_trash':
        return [...deviceTrash].sort((a, b) => b.trashedAt - a.trashedAt)
      case 'restore_trash': {
        const entry = deviceTrash.find((one) => one.id === args?.id)
        if (!entry) throw new Error('nothing to restore')
        deviceTrash = deviceTrash.filter((one) => one !== entry)
        notes.set(entry.from, 'restored')
        return entry.from
      }
      case 'purge_trash':
        deviceTrash = deviceTrash.filter((one) => one.id !== args?.id)
        return undefined
      case 'purge_trash_older_than': {
        const cutoff = Date.now() - Number(args?.age)
        const old = deviceTrash.filter((one) => one.trashedAt < cutoff)
        deviceTrash = deviceTrash.filter((one) => one.trashedAt >= cutoff)
        return old.length
      }
      default:
        return undefined
    }
  },
}))

const remote = {
  spaces: [] as { id: string; name: string; deletedAt: number; purgeAt: number; notes: number }[],
  notes: [] as {
    id: string
    spaceId: string
    spaceName: string
    path: string
    deletedAt: number
    purgeAt: number
  }[],
}
const apiCalls: string[] = []

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: {
    ...(await importOriginal<typeof import('./api')>()).api,
    trash: async () => ({ spaces: remote.spaces, notes: remote.notes }),
    restoreNote: async (_token: string, id: string) => {
      apiCalls.push(`restoreNote ${id}`)
      remote.notes = remote.notes.filter((one) => one.id !== id)
      return { note: {} }
    },
    restoreSpace: async (_token: string, id: string) => {
      apiCalls.push(`restoreSpace ${id}`)
      remote.spaces = remote.spaces.filter((one) => one.id !== id)
      return { space: {} }
    },
    purgeNote: async (_token: string, id: string) => {
      apiCalls.push(`purgeNote ${id}`)
      remote.notes = remote.notes.filter((one) => one.id !== id)
      return { ok: true }
    },
    emptyTrash: async () => {
      apiCalls.push('emptyTrash')
      remote.notes = []
      remote.spaces = []
      return { ok: true }
    },
    listSpaces: async () => ({ spaces: [], deleted: [] }),
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
const { account } = await import('./account.svelte')
const { trash } = await import('./trash.svelte')
const { prompt } = await import('./prompt.svelte')

beforeEach(() => {
  notes.clear()
  notes.set('/space/Idea.md', '# Idea')
  unreadable.clear()
  deviceTrash = []
  calls.length = 0
  apiCalls.length = 0
  remote.spaces = []
  remote.notes = []
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.undone.stack = []
  account.token = null
  account.user = null
  trash.items = []
  trash.loaded = false
})

afterEach(() => {
  workspace.tabs = []
})

describe('signed out', () => {
  test('a deleted note goes to the device trash and shows up in the list', async () => {
    await workspace.remove('/space/Idea.md', false)

    expect(calls).toContain('trash_item')
    expect(calls).not.toContain('delete_note')
    expect(notes.has('/space/Idea.md')).toBe(false)

    await trash.load()
    expect(trash.items).toHaveLength(1)
    expect(trash.items[0]).toMatchObject({
      kind: 'note',
      name: 'Idea.md',
      source: 'device',
      detail: '/space',
    })
    const [item] = trash.items
    expect(item ? item.purgeAt - item.deletedAt : null).toBe(14 * DAY)
  })

  test('restoring brings the note back and empties the list', async () => {
    await workspace.remove('/space/Idea.md', false)
    await trash.load()

    const [only] = trash.items
    if (!only) throw new Error('the deleted note is not in the list')
    await trash.restore(only)

    expect(calls).toContain('restore_trash')
    expect(notes.get('/space/Idea.md')).toBe('restored')
    expect(trash.items).toEqual([])
  })

  test('undoing the deletion restores from the trash rather than writing a copy', async () => {
    await workspace.remove('/space/Idea.md', false)
    calls.length = 0

    await workspace.undoFileAction()

    expect(calls).toContain('restore_trash')
    expect(calls).not.toContain('write_note')
    expect(deviceTrash).toEqual([])
  })

  test('a space goes to the device trash too', async () => {
    await workspace.deleteSpace('s')

    expect(calls).toContain('trash_item')
    expect(calls).not.toContain('delete_space')
    expect(onlyTrashed()).toMatchObject({ kind: 'space', from: '/space' })
  })

  test('undoing a deletion the trash no longer holds falls back to the snapshot', async () => {
    await workspace.remove('/space/Idea.md', false)

    // Recently deleted was emptied, or the daily sweep took it: the entry the
    // undo was going to restore from is gone.
    deviceTrash = []
    calls.length = 0

    await workspace.undoFileAction()

    expect(calls).toContain('write_note')
    expect(notes.get('/space/Idea.md')).toBe('# Idea')
    expect(workspace.undone.stack).toEqual([])
  })

  test('an undo that could not happen stays on the stack to be tried again', async () => {
    await workspace.remove('/space/Idea.md', false)
    // Nothing to restore from and nothing worth writing back.
    deviceTrash = []
    const [action] = workspace.undone.stack
    if (action?.kind !== 'delete') throw new Error('the deletion was not recorded')
    action.content = ''

    await workspace.undoFileAction()

    expect(workspace.undone.stack).toHaveLength(1)
    // The name as the row says it, without the ending; see note-name.ts.
    expect(workspace.undoLabel).toBe('Undo deleting Idea')
  })

  test('purging takes it away for good rather than putting it back', async () => {
    await workspace.remove('/space/Idea.md', false)
    await trash.load()
    calls.length = 0

    const [only] = trash.items
    if (!only) throw new Error('the deleted note is not in the list')
    const asked = vi.spyOn(prompt, 'confirm').mockResolvedValue(true)
    await trash.purge(only)

    expect(asked).toHaveBeenCalledOnce()
    expect(calls).toContain('purge_trash')
    expect(calls).not.toContain('restore_trash')
    expect(notes.has('/space/Idea.md')).toBe(false)
    expect(trash.items).toEqual([])
    asked.mockRestore()
  })

  /** Delete now is a slip of the thumb from Restore on a phone, and what it takes
   *  is not in the trash any more to be had back. So it asks, and a no is a no. */
  test('purging asks first, and touches nothing when the answer is no', async () => {
    await workspace.remove('/space/Idea.md', false)
    await trash.load()
    calls.length = 0

    const [only] = trash.items
    if (!only) throw new Error('the deleted note is not in the list')
    const asked = vi.spyOn(prompt, 'confirm').mockResolvedValue(false)
    await trash.purge(only)

    expect(calls).not.toContain('purge_trash')
    expect(trash.items).toHaveLength(1)
    asked.mockRestore()
  })

  test('a restore the disk refuses says so, and the list is read again', async () => {
    await workspace.remove('/space/Idea.md', false)
    await trash.load()
    const [only] = trash.items
    if (!only) throw new Error('the deleted note is not in the list')

    // Swept by another window between the listing and the press.
    deviceTrash = []
    await trash.restore(only)

    expect(trash.error).toBe('nothing to restore')
    expect(trash.busy).toBe(false)
    expect(trash.items).toEqual([])
  })

  test('the sweep drops what is older than 14 days', async () => {
    await workspace.remove('/space/Idea.md', false)
    onlyTrashed().trashedAt = Date.now() - 15 * DAY
    await trash.load()
    expect(trash.items).toHaveLength(1)

    await trash.sweep()
    expect(trash.items).toEqual([])
  })
})

describe('signed in', () => {
  beforeEach(() => {
    account.token = 'token'
    account.user = { id: 'u', email: 'a@b.dev', name: null }
  })

  test('deleting removes the local copy; the account keeps it', async () => {
    await workspace.remove('/space/Idea.md', false)

    expect(calls).toContain('delete_note')
    expect(calls).not.toContain('trash_item')
  })

  /** Nothing could be read, so no snapshot was taken, and the account never had
   *  the words either: deleting the file was the end of the only copy. */
  test('a note that would not read goes to the device trash instead', async () => {
    unreadable.add('/space/Idea.md')

    await workspace.remove('/space/Idea.md', false)

    expect(calls).not.toContain('delete_note')
    expect(onlyTrashed()).toMatchObject({ kind: 'note', from: '/space/Idea.md' })

    // And the undo puts it back from there.
    await workspace.undoFileAction()
    expect(deviceTrash).toEqual([])
  })

  test('the list is the account’s, with any device leftovers', async () => {
    const at = Date.now() - 2 * DAY
    remote.notes = [
      {
        id: 'n1',
        spaceId: 's',
        spaceName: 'Work',
        path: 'notes/Idea.md',
        deletedAt: at,
        purgeAt: at + 14 * DAY,
      },
    ]
    remote.spaces = [
      { id: 's2', name: 'Old', deletedAt: at - DAY, purgeAt: at + 13 * DAY, notes: 3 },
    ]
    deviceTrash = [
      {
        id: 'd1',
        kind: 'note',
        name: 'Local.md',
        from: '/space/Local.md',
        trashedAt: at - 2 * DAY,
      },
    ]

    await trash.load()

    expect(trash.items.map((item) => [item.id, item.source, item.detail])).toEqual([
      ['note:n1', 'account', 'Work / notes'],
      ['space:s2', 'account', '3 notes'],
      ['device:d1', 'device', '/space'],
    ])
  })

  test('restoring and purging call the account', async () => {
    const at = Date.now()
    remote.notes = [
      {
        id: 'n1',
        spaceId: 's',
        spaceName: 'Work',
        path: 'Idea.md',
        deletedAt: at,
        purgeAt: at + 14 * DAY,
      },
    ]
    remote.spaces = [{ id: 's2', name: 'Old', deletedAt: at, purgeAt: at + 14 * DAY, notes: 0 }]
    await trash.load()

    await trash.restore(trash.items.find((item) => item.id === 'note:n1')!)
    await trash.restore(trash.items.find((item) => item.id === 'space:s2')!)
    expect(apiCalls).toEqual(['restoreNote n1', 'restoreSpace s2'])
    expect(trash.items).toEqual([])
  })

  test('purging a note asks the account to forget it', async () => {
    const at = Date.now()
    remote.notes = [
      { id: 'n1', spaceId: 's', spaceName: 'Work', path: 'Idea.md', deletedAt: at, purgeAt: at },
    ]
    await trash.load()

    const asked = vi.spyOn(prompt, 'confirm').mockResolvedValue(true)
    await trash.purge(trash.items.find((item) => item.id === 'note:n1')!)

    expect(apiCalls).toEqual(['purgeNote n1'])
    expect(trash.items).toEqual([])
    asked.mockRestore()
  })

  describe('emptying', () => {
    beforeEach(async () => {
      const at = Date.now()
      remote.notes = [
        { id: 'n1', spaceId: 's', spaceName: 'Work', path: 'Idea.md', deletedAt: at, purgeAt: at },
      ]
      deviceTrash = [
        { id: 'd1', kind: 'note', name: 'Local.md', from: '/space/Local.md', trashedAt: at },
      ]
      await trash.load()
      calls.length = 0
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    test('takes the leftovers here and everything up there, once asked', async () => {
      vi.spyOn(prompt, 'confirm').mockResolvedValue(true)

      await trash.empty()

      expect(calls).toContain('purge_trash')
      expect(apiCalls).toEqual(['emptyTrash'])
      expect(trash.items).toEqual([])
    })

    test('touches nothing when the question is answered no', async () => {
      vi.spyOn(prompt, 'confirm').mockResolvedValue(false)

      await trash.empty()

      expect(calls).not.toContain('purge_trash')
      expect(apiCalls).toEqual([])
      expect(trash.items).toHaveLength(2)
    })
  })
})
