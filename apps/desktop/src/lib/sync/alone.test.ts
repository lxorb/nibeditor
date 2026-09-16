import { beforeEach, describe, expect, test, vi } from 'vitest'

/** One device, one note, one copy.
 *
 *  Emil's words, which are the whole specification of this file: "if there's just a
 *  single device editing a note there should never be conflicts". So everything below
 *  drives exactly one machine through the things a person does - type, wait for a
 *  pass, type again, rename, close the app in the middle of one - and asserts the same
 *  invariant every time: one note here, one note on the account, and nothing called
 *  "from another device" anywhere.
 *
 *  Which is a different question from the one mirror.test.ts asks. That file is about
 *  two devices meeting and is right to keep both copies. This one is about the case
 *  where there is nobody to meet, and a second copy is never an answer. */

const { ApiError } = await import('../api')

const fake = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  interface Remote {
    id: string
    path: string
    content: string
    version: number
    seq: number
    deleted: boolean
  }

  const disk = new Map<string, string>()
  const remote = new Map<string, Remote>()
  let seq = 0
  /** Set to make the next write to the account land and then answer with a broken
   *  connection: the account moved on and this machine never heard how. */
  let loseTheAnswer = false

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      return Promise.resolve(held as T)
    }

    if (command === 'write_note') {
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'snapshot_note' || command === 'delete_note') {
      if (command === 'delete_note') disk.delete(path)
      return Promise.resolve(undefined as T)
    }

    if (command === 'file_stamp') return Promise.resolve(0 as T)

    if (command === 'read_tree') {
      const root = text(args.root)
      const children = [...disk.keys()]
        .filter((one) => one.startsWith(`${root}/`))
        .sort()
        .map((one): Entry => ({
          name: one.split('/').pop() ?? one,
          path: one,
          is_dir: false,
          modified: 0,
          created: 0,
          children: [],
        }))

      return Promise.resolve({
        name: root,
        path: root,
        is_dir: true,
        modified: 0,
        created: 0,
        children,
      } as T)
    }

    throw new Error(`no such command: ${command}`)
  }

  async function hashOf(content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function present(note: Remote) {
    return {
      id: note.id,
      path: note.path,
      seq: note.seq,
      version: note.version,
      updatedAt: 0,
      deleted: note.deleted,
      size: note.content.length,
      hash: await hashOf(note.content),
    }
  }

  /** The account, answering the way services/sync/src/notes.ts answers: one live
   *  note per path, a write names the version it edited, and a mismatch is a 409
   *  carrying what is held. */
  const api = {
    changes: async (_token: string, _spaceId: string, since: number) => {
      const notes = [...remote.values()]
        .filter((one) => one.seq > since)
        .sort((a, b) => a.seq - b.seq)

      return {
        notes: await Promise.all(notes.map(present)),
        cursor: notes.at(-1)?.seq ?? since,
        more: false,
      }
    },
    readNote: async (_token: string, id: string) => {
      const note = remote.get(id)
      if (!note) throw new Error('no such note')
      return { note: await present(note), content: note.content }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      baseVersion: number,
    ) => {
      const note = remote.get(id)
      if (!note) throw new Error('no such note')

      if (note.version !== baseVersion) {
        throw new ApiError(409, 'a note already lives there', {
          note: await present(note),
          content: note.content,
        })
      }

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      if (loseTheAnswer) {
        loseTheAnswer = false
        throw new TypeError('Failed to fetch')
      }

      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      const taken = [...remote.values()].find((one) => one.path === path && !one.deleted)
      if (taken) {
        throw new ApiError(409, 'a note already lives there', {
          note: await present(taken),
          content: taken.content,
        })
      }

      const note: Remote = {
        id: `n-${path}`,
        path,
        content,
        version: 1,
        seq: ++seq,
        deleted: false,
      }
      remote.set(note.id, note)
      if (loseTheAnswer) {
        loseTheAnswer = false
        throw new TypeError('Failed to fetch')
      }

      return { note: await present(note) }
    },
    deleteNote: (_token: string, id: string) => {
      const note = remote.get(id)
      if (note) Object.assign(note, { deleted: true, seq: ++seq })
      return Promise.resolve({ ok: true as const })
    },
    saveSpaceFiles: () => Promise.resolve({ files: [], missing: [] as string[] }),
  }

  function addRemote(path: string, content: string): string {
    const note: Remote = { id: `n-${path}`, path, content, version: 1, seq: ++seq, deleted: false }
    remote.set(note.id, note)
    return note.id
  }

  function reset() {
    disk.clear()
    remote.clear()
    seq = 0
    loseTheAnswer = false
  }

  return {
    addRemote,
    api,
    disk,
    hashOf,
    invoke,
    lose: () => (loseTheAnswer = true),
    remote,
    reset,
  }
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: fake.api,
}))

const { newMirror, pull, push, readMirror } = await import('./mirror')
type Mirror = import('./mirror').Mirror

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

/** One machine, one space, one note both sides already agree about. */
async function alone(path: string, content: string) {
  const id = fake.addRemote(path, content)
  fake.disk.set(`${ROOT}/${path}`, content)

  const mirror = newMirror('s-one', ROOT)
  await pull(mirror, 'token', NOBODY)
  await push(mirror, 'token', NOBODY)

  return { mirror, id }
}

/** A keystroke, then the pause that writes the file; see workspace/saving.svelte.ts. */
function types(path: string, content: string) {
  fake.disk.set(`${ROOT}/${path}`, content)
}

/** One pass of the loop, in the order sync.svelte.ts runs it. */
async function pass(mirror: Mirror) {
  await pull(mirror, 'token', NOBODY)
  await push(mirror, 'token', NOBODY)
}

/** What the machine holds, so a second copy under any name shows up. */
function files(): string[] {
  return [...fake.disk.keys()].sort()
}

/** What the account holds, tombstones left out. */
function account(): string[] {
  return [...fake.remote.values()]
    .filter((one) => !one.deleted)
    .map((one) => one.path)
    .sort()
}

/** The mirror as a launch reads it back, through storage and JSON - so a field a
 *  pass keeps in memory and never writes down does not quietly hold a test up.
 *
 *  `caches: false` is the blob a full storage takes instead of the whole table,
 *  exactly as `withoutCaches` in sync.svelte.ts writes it. */
function reloaded(mirror: Mirror, { caches = true } = {}): Mirror {
  const written = JSON.parse(
    JSON.stringify(caches ? mirror : { ...mirror, notes: {}, files: {}, dropped: true }),
  ) as unknown

  const read = readMirror(mirror.root, written)
  if (!read) throw new Error('a mirror that no longer reads as one')
  return read
}

describe('one device typing in one note', () => {
  test('makes one file and one note however many passes run', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(mirror)
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  /** The one that Emil sees. A push lands on the account and the answer never gets
   *  back - a connection dropped, a worker that took too long, a laptop lid. The
   *  account has moved on, this machine's entry has not, and the next keystroke makes
   *  the file differ from both. Read as "two writers", which is one writer and a lost
   *  reply. */
  test('makes no second copy when a push lands and its answer is lost', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    // The hand carries on typing, because nothing on screen said anything happened.
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\none\ntwo\n')
  })

  /** And the same thing a launch later. What the pass wrote down has to be a record a
   *  restart can read: a hash held only in memory answers nothing after a crash, which
   *  is one of the two ways this shows up at all. */
  test('makes no second copy when the lost answer is a launch ago', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    // The failed pass writes itself down and the window closes; see `run` in
    // sync.svelte.ts, which saves what a pass got through before it fell over.
    const next = reloaded(mirror)
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  /** And when storage was full, which drops the note cache and keeps the cursor on
   *  purpose; see `withoutCaches` in sync.svelte.ts. Every note then reads as one the
   *  account has never been told about. */
  test('makes no second copy when a full storage dropped the note cache', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await push(mirror, 'token', NOBODY)

    const next = reloaded(mirror, { caches: false })
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  /** A note renamed while it is being written in. The file leaves under one name and
   *  arrives under another, and the account has to end up holding one of them. */
  test('makes one note when the note is renamed between keystrokes', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)

    fake.disk.delete(`${ROOT}/Plan.md`)
    types('Notes on the plan.md', '# Notes on the plan\none\n')
    await pass(mirror)

    types('Notes on the plan.md', '# Notes on the plan\none\ntwo\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Notes on the plan.md`])
    expect(account()).toEqual(['Notes on the plan.md'])
  })

  /** A second way one device makes two files, proven here and NOT closed by this
   *  change - `test.fails` holds it, so the day somebody mends it this line is what
   *  says so.
   *
   *  The mirror is keyed by the file's name in the space, and the note's id on the
   *  account only rides along inside the entry. So every question about identity is
   *  really "did the path change" - and the pass has one guard for it: a path the
   *  mirror knows whose file has gone is a rename rather than a note this machine has
   *  never seen, and the old name is not written back.
   *
   *  The guard is an entry. Take the entry away - a table storage would not hold - and
   *  the account's copy of the old name is a note this machine has never heard of,
   *  which the pass puts on the disk beside the renamed one. Two files, one note, one
   *  device, and no conflict involved: this is the plain arrival path rather than the
   *  conflict path, which is why the copy wears the old name rather than another
   *  device's.
   *
   *  It cannot be mended by asking the entries a better question, because there are no
   *  entries: with the table gone the app cannot tell "renamed here" from "new there"
   *  for any path at all. What it wants is for the table not to be droppable - it is
   *  the only record of what this device has seen, and it lives in a five megabyte
   *  store shared with everything else in the app. See `dropped` in mirror.ts. */
  test.fails('does not put the old name back when a rename outran the mirror', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    // Renamed here, and the pass that would have told the account never ran.
    fake.disk.delete(`${ROOT}/Plan.md`)
    types('Notes on the plan.md', '# Notes on the plan\n')

    // A launch whose stored mirror is from before any of it.
    const next = reloaded({ ...mirror, notes: {}, cursor: 0 }, { caches: false })
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Notes on the plan.md`])
    expect(account()).toEqual(['Notes on the plan.md'])
  })

  /** A note made here while the account was out of reach, offered once the account is
   *  back. The account already holds it - the create that answered 409 is the pass
   *  before this one, whose answer was lost - and it is the same words plus whatever
   *  was typed since. */
  test('makes no second copy when a create landed and its answer was lost', async () => {
    const mirror = newMirror('s-one', ROOT)
    types('Plan.md', '# Plan\n')

    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })
})
