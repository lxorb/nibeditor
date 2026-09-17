/** What the log keeps, and - the part worth a test of its own - what it lets go
 *  of. A clash holds the other device's whole note, so this store is the one
 *  place on the device where somebody else's words are written outside the vault. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Clash } from './conflicts'

const KEY = 'nib:sync-log'

/** The spaces this device holds, which is what says whether a path read back out
 *  of storage is a note at all. */
const spaces = [{ root: '/Work' }]

/** What a document open on the settled note was told, if anything. */
const reloaded: { path: string; content: string }[] = []

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces,
    reload: (path: string, content: string) => void reloaded.push({ path, content }),
  },
}))

/** Every command settling an answer sent to the crate, and the path it named. */
const invoked: { command: string; path: string }[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    invoked.push({ command, path: String(args.path) })
    return Promise.resolve(command === 'read_note' ? 'what is here' : undefined)
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
}))

const { record } = await import('./record.svelte')

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

function aClash(path: string): Clash {
  return { path, id: 'note-id', version: 2, theirs: 'what the other device wrote', at: 1 }
}

function stored(): string {
  return localStorage.getItem(KEY) ?? ''
}

beforeEach(() => {
  localStorage.clear()
  invoked.length = 0
  reloaded.length = 0
  record.restore()
})

/** The log as an earlier launch left it, which is a string like any other string
 *  and the only thing a restore has to go on. */
function held(clashes: Clash[]) {
  localStorage.setItem(KEY, JSON.stringify({ passes: [], clashes }))
  record.restore()
}

describe('the log', () => {
  test('keeps a pass that moved something and skips one that moved nothing', () => {
    record.wrote({ at: 1, space: 'Work', pulled: 0, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(0)

    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(1)
  })

  test('and clearing it leaves what is still waiting to be answered', () => {
    record.clash(aClash('Plan.md'))
    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })

    record.clear()

    expect(record.passes).toHaveLength(0)
    expect(record.clashes).toHaveLength(1)
  })
})

/** A clash is written down and read back a launch later, and what comes back out
 *  of storage is a string: the entry may have been written by another version of
 *  the app, or edited by hand. Settling one writes a file, so the path is judged
 *  against the spaces this device holds before anything on disk is touched - and
 *  what is written is the path built back up from the space and the name, not the
 *  string storage held. */
describe('a path read back out of storage', () => {
  test('is settled when a space holds it', async () => {
    held([aClash('/Work/Plan.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(invoked).toEqual([
      { command: 'read_note', path: '/Work/Plan.md' },
      { command: 'snapshot_note', path: '/Work/Plan.md' },
      { command: 'write_note', path: '/Work/Plan.md' },
    ])
    expect(record.clashes).toHaveLength(0)
  })

  /** And the document, if the note is open. Taking the other copy writes the file,
   *  and a document over that file is still holding what this machine said: clean
   *  it shows words the file no longer has, and the first keystroke after that
   *  writes them back over the copy the reader just chose. Nothing writes a file a
   *  document is open on without telling the document; see workspace/open.ts. */
  test('and the note on screen becomes the copy that was chosen', async () => {
    held([aClash('/Work/Plan.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(reloaded).toEqual([{ path: '/Work/Plan.md', content: 'what the other device wrote' }])
  })

  test('and touches nothing when no space does', async () => {
    held([aClash('/Users/me/Downloads/theirs.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(invoked).toEqual([])
    // And it stops being asked about: a note no space holds is not a note.
    expect(record.clashes).toHaveLength(0)
  })

  test('nor when it climbs back out of the space it names', async () => {
    held([aClash('/Work/../../etc/passwd')])

    await record.settle(record.clashes[0]!, 'both')

    expect(invoked).toEqual([])
    expect(record.clashes).toHaveLength(0)
  })
})

describe('signing out', () => {
  test('takes the other device’s words off this one', () => {
    // A clash is kept whole, because it is the copy the pass had in its hand. It
    // is also somebody's note in browser storage, and the session that reached it
    // has gone: leaving it behind means the next person at this machine can read
    // a note that the token no longer opens.
    record.clash(aClash('Plan.md'))
    expect(stored()).toContain('what the other device wrote')

    record.forgetEverything()

    expect(record.clashes).toHaveLength(0)
    expect(record.passes).toHaveLength(0)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
