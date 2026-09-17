import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Putting the last file operation back, driven by a stand-in store.
 *
 *  The workspace's own tests already take each of these the long way round -
 *  delete a note and undo it, rename one and undo that; see workspace.test.ts and
 *  trash.test.ts. What is here is what those cannot reach without a disk that
 *  refuses: an entry whose file will not go, a deletion with nothing kept and
 *  nothing in the trash, and a write that fails halfway, which must leave the entry
 *  on the stack so it can be asked for again. */

const sent: { command: string; path: string; content: string }[] = []

/** Commands the disk refuses, by the path or the trash id they name. */
const refused = new Set<string>()

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    const id = typeof args?.id === 'string' ? args.id : ''
    sent.push({ command, path, content })

    const named = path || id
    if (refused.has(named)) return Promise.reject(new Error(`${named} will not budge`))
    return Promise.resolve('')
  },
}))

/** The index, the papers and the two per-space stores all hear about a file that
 *  moved or went. What they do with that is their own business and tested there;
 *  what matters here is that they are told. */
const told: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    noteGone: (path: string) => void told.push(`gone ${path}`),
    noteSaved: (path: string) => void told.push(`saved ${path}`),
    notesMoved: (from: string, to: string) => void told.push(`moved ${from} -> ${to}`),
  },
}))

vi.mock('../pdf/papers', () => ({
  paperMoved: (from: string, to: string) => void told.push(`paper ${from} -> ${to}`),
}))

const { undoLastFileAction } = await import('./undoing')
const { FileActions } = await import('./undo.svelte')
type PutsBack = import('./undoing').PutsBack
type FileAction = import('./undo.svelte').FileAction

/** A store with nothing open in it: no documents, no tabs, and the two per-space
 *  stores standing in as counters, since what they are asked is all this cares
 *  about. */
function store(action: FileAction): PutsBack & { loaded: number; wrote: number } {
  const undone = new FileActions()
  undone.record(action)

  const moved: string[] = []
  const kept = {
    undone,
    tabs: [],
    documentAt: () => null,
    positions: { move: (from: string, to: string) => void moved.push(`${from} -> ${to}`) },
    folderIcons: { moved: (from: string, to: string) => void moved.push(`icon ${from} -> ${to}`) },
    // The order a folder was arranged into. Missing here until now, so a name put
    // back threw halfway down `putName` and the undo was swallowed by the catch
    // around it - which every assertion below happened to be taken before.
    arranged: { moved: (from: string, to: string) => void moved.push(`order ${from} -> ${to}`) },
    excluded: { moved: (from: string, to: string) => void moved.push(`left out ${from} -> ${to}`) },
    close: () => undefined,
    reload: (path: string) => void told.push(`reloaded ${path}`),
    retarget: (from: string, to: string) => {
      told.push(`retargeted ${from} -> ${to}`)
      return Promise.resolve(1)
    },
    movedOnAccount: (from: string, to: string) => {
      told.push(`account ${from} -> ${to}`)
      return Promise.resolve()
    },
    loadTree: () => {
      kept.loaded += 1
      return Promise.resolve()
    },
    persist: () => {
      kept.wrote += 1
    },
    loaded: 0,
    wrote: 0,
    moved,
  }

  return kept as unknown as PutsBack & { loaded: number; wrote: number }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  refused.clear()
})

describe('an entry that goes back', () => {
  test('comes off the stack, and the rows and the strip are written again', async () => {
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    await undoLastFileAction(ws)

    expect(sent).toEqual([{ command: 'write_note', path: '/s/a.md', content: '# a' }])
    expect(ws.undone.stack).toEqual([])
    expect(ws.loaded).toBe(1)
    expect(ws.wrote).toBe(1)
  })

  test('and nothing at all happens where the stack is empty', async () => {
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    ws.undone.drop()
    await undoLastFileAction(ws)

    expect(sent).toEqual([])
    expect(ws.loaded).toBe(0)
  })
})

describe('an entry that cannot go back', () => {
  test('stays on the stack, so the same undo can be asked for again', async () => {
    refused.add('/s/a.md')
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    await undoLastFileAction(ws)

    expect(ws.undone.stack).toHaveLength(1)
    // Nothing was written and nothing was told: the file on disk is whatever
    // somebody else has since made of it.
    expect(ws.loaded).toBe(0)
    expect(told).toEqual([])
  })

  test('and a deletion with nothing kept says so rather than writing nothing', async () => {
    // What a PDF deleted while signed in looks like: bytes, no snapshot, and the
    // trash entry already swept. Writing the empty content would leave an empty
    // file where the paper was.
    const ws = store({ kind: 'delete', path: '/s/paper.pdf', content: '' })
    await undoLastFileAction(ws)

    expect(sent).toEqual([])
    expect(ws.undone.stack).toHaveLength(1)
  })

  test('and a deletion the trash refuses falls back to the snapshot', async () => {
    refused.add('trash-1')
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a', trashId: 'trash-1' })
    await undoLastFileAction(ws)

    expect(sent.map((one) => one.command)).toEqual(['restore_trash', 'write_note'])
    expect(ws.undone.stack).toEqual([])
  })
})

describe('an import taken back', () => {
  test('steps over the one file that will not go and removes the rest', async () => {
    refused.add('/s/b.md')
    const ws = store({ kind: 'import', paths: ['/s/a.md', '/s/b.md', '/s/c.md'] })
    await undoLastFileAction(ws)

    expect(sent.map((one) => one.path)).toEqual(['/s/a.md', '/s/b.md', '/s/c.md'])
    // Only the two that went are gone as far as the index is concerned.
    expect(told).toEqual(['gone /s/a.md', 'gone /s/c.md'])
    expect(ws.undone.stack).toEqual([])
  })
})

/** Putting a name back is a rename, and owes everything a rename owes - the links
 *  that followed the note, the index, the papers, and the account, which keeps a
 *  note under an id rather than under a name. Without that last one the note that
 *  came back from a mistaken rename is a third note up there, with the history of
 *  neither; see `movedHere` in sync/mirror.ts. */
describe('a name put back', () => {
  test('rewrites the links that followed it, and only when they were rewritten', async () => {
    const ws = store({ kind: 'rename', from: '/s/a.md', to: '/s/b.md', rewrote: true })
    await undoLastFileAction(ws)

    expect(sent).toEqual([{ command: 'rename_note', path: '', content: '' }])
    expect(told).toEqual([
      'retargeted /s/b.md -> /s/a.md',
      'moved /s/b.md -> /s/a.md',
      'paper /s/b.md -> /s/a.md',
      'account /s/b.md -> /s/a.md',
    ])
  })

  test('and leaves the links alone where the rename did not touch them', async () => {
    const ws = store({ kind: 'move', from: '/s/a.md', to: '/s/f/a.md' })
    await undoLastFileAction(ws)

    expect(told).toEqual([
      'moved /s/f/a.md -> /s/a.md',
      'paper /s/f/a.md -> /s/a.md',
      'account /s/f/a.md -> /s/a.md',
    ])
  })
})

describe('a merge and a carve put back', () => {
  test('a merge writes both notes and points the links back at the one that left', async () => {
    const ws = store({
      kind: 'merge',
      from: '/s/a.md',
      fromContent: '# a',
      into: '/s/b.md',
      intoContent: '# b',
    })
    await undoLastFileAction(ws)

    expect(sent.map((one) => one.path)).toEqual(['/s/b.md', '/s/a.md'])
    expect(told).toEqual([
      'saved /s/b.md',
      'saved /s/a.md',
      'reloaded /s/b.md',
      'retargeted /s/b.md -> /s/a.md',
    ])
  })

  test('a split writes the note whole again and takes the carved one away', async () => {
    const ws = store({
      kind: 'split',
      from: '/s/a.md',
      fromContent: '# a\n\n## b\n',
      created: '/s/b.md',
    })
    await undoLastFileAction(ws)

    expect(sent.map((one) => `${one.command} ${one.path}`)).toEqual([
      'write_note /s/a.md',
      'delete_note /s/b.md',
    ])
    expect(told).toEqual(['saved /s/a.md', 'gone /s/b.md', 'reloaded /s/a.md'])
  })

  test('and a carved note that will not go does not stop the note coming back', async () => {
    refused.add('/s/b.md')
    const ws = store({ kind: 'extract', from: '/s/a.md', fromContent: '# a', created: '/s/b.md' })
    await undoLastFileAction(ws)

    expect(ws.undone.stack).toEqual([])
    expect(told).toEqual(['saved /s/a.md', 'gone /s/b.md', 'reloaded /s/a.md'])
  })
})
