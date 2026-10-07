import { beforeEach, describe, expect, test, vi } from 'vitest'

/** One space moved between a disk and an account that both live in memory, driven
 *  a pass at a time. What this file is about is the one decision a pass has to
 *  make - both sides changed, now what - and how the answer changes for a note
 *  that is open in a room.
 *
 *  The loop around it, and the pairing of folders with spaces, are tested next
 *  door in sync.test.ts against the whole store. Here `pull` and `push` are called
 *  directly, because which notes are in rooms is something they are handed. */

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
    /** When the account says it was last written, in milliseconds. */
    updatedAt?: number
  }

  const disk = new Map<string, string>()
  const remote = new Map<string, Remote>()
  const calls: string[] = []
  /** Every note whose body the pass asked the account for, in the order it did. */
  const fetched: string[] = []
  /** The version history, as the platforms keep it: every note's earlier words,
   *  oldest first, under the note they are versions of. What the sheet lists and
   *  what Restore puts back; see recovery.svelte.ts. */
  const history = new Map<string, string[]>()
  /** When each file here was last written, as the crate stamps it; a file with
   *  none was written at the dawn of time. */
  const modified = new Map<string, number>()
  /** Files that are there and will not read: another encoding, or a lock. */
  const unreadable = new Set<string>()
  /** What the account answers a delete with, where it does not simply take it. */
  const refusing: { delete: Error | null } = { delete: null }
  /** This device's trash, by the id each thing put in it was given: where it was and
   *  what it said. See src-tauri/src/trash.rs. */
  const trash = new Map<string, { path: string; content: string }>()
  let seq = 0

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      // Rejected rather than thrown, the way the platform shim answers: a pass
      // catches the promise, and a file that is not there is the ordinary case
      // of a note arriving from another machine.
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      if (unreadable.has(path)) {
        return Promise.reject(new Error(`stream did not contain valid UTF-8: ${path}`))
      }
      return Promise.resolve(held as T)
    }

    // The shape the crate answers, not a bare time; see `file_stamp` in notes.rs.
    if (command === 'file_stamp') {
      const held = disk.get(path)
      if (held === undefined) return Promise.resolve(null as T)
      return Promise.resolve({ modified: modified.get(path) ?? 0, len: held.length } as T)
    }

    if (command === 'write_note') {
      calls.push(`write ${path}`)
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'snapshot_note') {
      const content = text(args.content)
      const kept = history.get(path) ?? []
      // Both platforms drop a version that repeats the one before it, and neither
      // keeps one of a note that says nothing; see src-tauri/src/history.rs and
      // web/commands.ts.
      if (content.trim() && kept.at(-1) !== content) history.set(path, [...kept, content])
      return Promise.resolve(undefined as T)
    }

    if (command === 'delete_note') {
      calls.push(`delete ${path}`)
      disk.delete(path)
      return Promise.resolve(undefined as T)
    }

    if (command === 'trash_item') {
      calls.push(`trash ${path}`)
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error('nothing is there'))

      const id = `t-${trash.size}`
      trash.set(id, { path, content: held })
      disk.delete(path)
      return Promise.resolve({ id } as T)
    }

    if (command === 'restore_trash') {
      const held = trash.get(text(args.id))
      if (!held) return Promise.reject(new Error('nothing to restore'))

      trash.delete(text(args.id))
      disk.set(held.path, held.content)
      return Promise.resolve(held.path as T)
    }

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

      const tree: Entry = {
        name: root,
        path: root,
        is_dir: true,
        modified: 0,
        created: 0,
        children,
      }
      return Promise.resolve(tree as T)
    }

    throw new Error(`no such command: ${command}`)
  }

  /** The account’s own hash, worked out the way the service works it out, so a
   *  pass comparing hashes is comparing real ones. */
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
      updatedAt: note.updatedAt ?? 0,
      deleted: note.deleted,
      size: note.content.length,
      hash: await hashOf(note.content),
    }
  }

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
      // Kept apart from `calls`, which is what the writes are counted in: the
      // order bodies are asked for in is its own question.
      fetched.push(note.path)
      return { note: await present(note), content: note.content }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      _baseVersion = 0,
    ) => {
      calls.push(`writeNote ${path}`)
      const note = remote.get(id)
      if (!note) throw new Error('no such note')

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      calls.push(`createNote ${path}`)

      // A space holds one live note per path, so the service answers 409 with the
      // note that is already there rather than making a second one; see
      // services/sync/src/notes.ts. That is a pairing, not a failure.
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
      return { note: await present(note) }
    },
    deleteNote: (_token: string, id: string) => {
      calls.push(`deleteNote ${id}`)
      if (refusing.delete) return Promise.reject(refusing.delete)
      const note = remote.get(id)
      if (note) Object.assign(note, { deleted: true, seq: ++seq })
      return Promise.resolve({ ok: true as const })
    },
    saveSpaceFiles: () => Promise.resolve({ files: [], missing: [] as string[] }),
  }

  /** A note the account holds, and what its next version will be called. */
  function addRemote(path: string, content: string): string {
    const note: Remote = { id: `n-${path}`, path, content, version: 1, seq: ++seq, deleted: false }
    remote.set(note.id, note)
    return note.id
  }

  /** Another device's delete, as the account keeps it: a tombstone in the changes. */
  function deleteRemote(id: string) {
    const note = remote.get(id)
    if (note) Object.assign(note, { deleted: true, version: note.version + 1, seq: ++seq })
  }

  function editRemote(id: string, content: string, updatedAt = 0) {
    const note = remote.get(id)
    if (note) Object.assign(note, { content, version: note.version + 1, seq: ++seq, updatedAt })
  }

  function reset() {
    disk.clear()
    remote.clear()
    history.clear()
    modified.clear()
    unreadable.clear()
    trash.clear()
    refusing.delete = null
    calls.length = 0
    fetched.length = 0
    seq = 0
  }

  return {
    addRemote,
    api,
    calls,
    deleteRemote,
    disk,
    editRemote,
    fetched,
    history,
    invoke,
    modified,
    refusing,
    remote,
    reset,
    trash,
    unreadable,
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

const { newMirror, within } = await import('./mirror')
const { movedHere, pull, push } = await import('./pass')
type Clash = import('./conflicts').Clash

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

/** A space paired with the account, with one note that both sides agree about and
 *  a mirror that has already seen it. */
async function paired(path: string, content: string) {
  const id = fake.addRemote(path, content)
  fake.disk.set(`${ROOT}/${path}`, content)

  const mirror = newMirror('s-one', ROOT)
  await pull(mirror, 'token', NOBODY)
  fake.calls.length = 0

  return { mirror, id }
}

/** Whether a conflict copy was written anywhere on the disk. */
function conflicts(): string[] {
  return [...fake.disk.keys()].filter((path) => path.includes('from another device'))
}

/** A rename keeps the note's identity on the account.
 *
 *  A note is a row up there with an id, and everything that outlives one sitting
 *  hangs off that id: the version history, the room every device in the note joins,
 *  what a published link points at. A rename changes the name of a file; it is not a
 *  note ending and another beginning.
 *
 *  Nothing used to tell the account, and the next pass read the move off the folder
 *  instead - the new name a note it had never seen, the old one a path with no file.
 *  That is a create and a delete: a fresh uuid, the history severed, the open room
 *  named after an id nothing answers to, and - where the filesystem does not care
 *  about case - a rename that only changed case going up as a brand new note. The
 *  pass reading it off the folder is still what happens when nobody could be told,
 *  which is the last test here. */
describe('a note renamed on this machine', () => {
  const HERE = '# One' + String.fromCharCode(10)

  /** The rename, as the workspace does it: the file leaves one name and arrives
   *  under another, and the account is told which note that was. */
  function renameOnDisk(from: string, to: string) {
    const held = fake.disk.get(`${ROOT}/${from}`) ?? ''
    fake.disk.delete(`${ROOT}/${from}`)
    fake.disk.set(`${ROOT}/${to}`, held)
  }

  test('keeps its id, and the account holds one note at the new name', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    expect(await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)).toBe(true)

    // One request, and it is the note being renamed rather than a new one.
    expect(fake.calls).toEqual(['writeNote Two.md'])
    expect(fake.remote.get(id)?.path).toBe('Two.md')
    expect(fake.remote.get(id)?.deleted).toBe(false)
    expect(mirror.notes['Two.md']?.id).toBe(id)
    expect(mirror.notes['One.md']).toBeUndefined()
  })

  test('and the pass that follows has nothing left to do about it', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()].sort()).toEqual([`${ROOT}/Two.md`])
    expect([...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.id)).toEqual([
      id,
    ])
  })

  /** Where the filesystem does not care about case - Windows, and a Mac unless
   *  somebody asked otherwise - `One.md` and `one.md` are one file. The account
   *  does care, so a create and a delete over that pair is two rows over one file,
   *  and which of them wins the next pass is a coin toss. */
  test('and a rename that only changes case is the same note, not another one', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'one.md')

    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/one.md`)

    expect(fake.calls).toEqual(['writeNote one.md'])
    expect([...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.id)).toEqual([
      id,
    ])
    expect(mirror.notes['one.md']?.id).toBe(id)
  })

  /** A note somebody is reading is the note they rename, and a note somebody is
   *  reading is the note a room is carrying: the room writes it up keystroke by
   *  keystroke, so the version the last pass wrote down is behind by the time the
   *  name changes. The room names the note by its id and never says where it lives,
   *  so this is the only thing that can move it - and what it moves is what the room
   *  wrote. */
  test('and follows a room that moved past this machine while the name changed', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    // The room settled twice since the last pass, so the version the mirror holds is
    // not the one the account is on.
    const THEIRS = '# One, and a sentence somebody typed' + String.fromCharCode(10)
    fake.editRemote(id, THEIRS)
    const stale = fake.api.writeNote
    fake.api.writeNote = async (token, noteId, path, content, base) => {
      if (base !== fake.remote.get(noteId)?.version) throw new ApiError(409, 'a version behind', {})
      return stale(token, noteId, path, content, base)
    }

    try {
      expect(await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)).toBe(true)
    } finally {
      fake.api.writeNote = stale
    }

    expect(fake.remote.get(id)?.path).toBe('Two.md')
    // The room's words, at the new name: nothing it wrote was rolled back to the
    // file this machine happened to hold.
    expect(fake.remote.get(id)?.content).toBe(THEIRS)
    expect(mirror.notes['Two.md']?.id).toBe(id)
  })

  /** A folder is the same move said once per note under it. */
  test('and a folder carries every note under it', async () => {
    const { mirror } = await paired('Kept/One.md', HERE)
    fake.addRemote('Keptish.md', '# elsewhere' + String.fromCharCode(10))
    fake.disk.set(`${ROOT}/Keptish.md`, '# elsewhere' + String.fromCharCode(10))
    await pull(mirror, 'token', NOBODY)
    fake.calls.length = 0

    renameOnDisk('Kept/One.md', 'Shelved/One.md')
    await movedHere(mirror, 'token', `${ROOT}/Kept`, `${ROOT}/Shelved`)

    expect(fake.calls).toEqual(['writeNote Shelved/One.md'])
    expect(mirror.notes['Shelved/One.md']?.id).toBe('n-Kept/One.md')
    // A name that merely starts with the folder's is not under it.
    expect(mirror.notes['Keptish.md']?.id).toBe('n-Keptish.md')
  })

  /** And the account that could not be told: signed out, or a request that never
   *  landed. The mirror is left exactly as it was and the pass reads the move off
   *  the folder the way it always has - the new name a note it has never seen, the
   *  old one a path with no file. The identity is lost, which is what makes telling
   *  the account worth doing, but nothing else is. */
  test('while a rename nobody could be told about is still read off the folder', async () => {
    const { mirror } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toContain('createNote Two.md')
    expect(fake.calls).toContain('deleteNote n-One.md')

    const alive = [...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.path)
    expect(alive).toEqual(['Two.md'])
  })

  /** And with the pass in the order the loop runs it. The account’s own listing still
   *  carries the old note - the cursor is behind it until a pass moves it on - so the
   *  pull sees a note whose file is not here, which is exactly what a rename looks
   *  like from that side. */
  test('and is not brought back by the pull that runs before that push', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    // The account a version ahead of the entry, which is what a note that was open
    // in a room looks like - the room wrote it up there, keystroke by keystroke - and
    // is what makes the pull look at the note again rather than skip it by version.
    fake.editRemote(id, HERE)
    mirror.cursor = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect([...fake.disk.keys()].sort()).toEqual([`${ROOT}/Two.md`])

    const alive = [...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.path)
    expect(alive).toEqual(['Two.md'])
  })
})

describe('a note both sides changed', () => {
  test('keeps the other copy beside ours when there is no room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(conflicts()[0] ?? '')).toBe('base\nwritten there\n')
    // Ours stays where it was, and is sent up as the newer version next.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('writes no second copy for a note that is in a room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten here\nwritten there\n')

    await pull(mirror, 'token', new Set([id]))

    expect(conflicts()).toEqual([])
    // The room settled the two before either became a file, so what comes down is
    // simply what the note now says.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\nwritten there\n')
  })

  test('leaves a note in a room to the room rather than sending the file', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')

    expect(await push(mirror, 'token', new Set([id]))).toBe(false)
    expect(fake.calls).toEqual([])
    // And the account’s copy is untouched: the room is what writes it.
    expect(fake.remote.get(id)?.content).toBe('base\n')
  })

  test('sends the file for a note that is in no room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('writeNote note.md')
    expect(fake.remote.get(id)?.content).toBe('base\nwritten here\n')
  })
})

/** The same disagreement, when somebody chose to be asked about it. Nothing is
 *  touched until they answer: not the file here, not the copy up there, and no copy
 *  beside either. `both` is the block above and `newest` is further down. See
 *  sync/conflicts.ts. */
describe('a note both sides changed, when somebody chose to be asked', () => {
  async function disagreeing() {
    const both = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(both.id, 'base\nwritten there\n')
    fake.calls.length = 0
    return both
  }

  test('asking leaves both copies where they are and says which note', async () => {
    const { mirror, id } = await disagreeing()
    const clashes: Clash[] = []

    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: (one) => clashes.push(one) })

    expect(clashes).toEqual([
      {
        path: `${ROOT}/note.md`,
        id,
        version: 2,
        theirs: 'base\nwritten there\n',
        at: expect.any(Number) as number,
      },
    ])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
    expect(conflicts()).toEqual([])
    expect(fake.calls).toEqual([])
    // The version is seen, so the pass stops asking; the empty hash is no body the two
    // sides agree on, which a room joining the note reads as "ask again".
    expect(mirror.notes['note.md']).toEqual({ id, version: 2, hash: '' })
  })

  test('and a push while the question waits sends nothing over the other copy', async () => {
    const { mirror, id } = await disagreeing()
    await pull(mirror, 'token', NOBODY, { rule: 'ask' })

    expect(await push(mirror, 'token', NOBODY, { held: new Set([`${ROOT}/note.md`]) })).toBe(false)
    expect(fake.calls).toEqual([])
    expect(fake.remote.get(id)?.content).toBe('base\nwritten there\n')
  })
})

describe('a canvas both sides drew on', () => {
  /** Two planes with one stroke each, as files. */
  const plane = (id: string) =>
    `{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [{ "id": "${id}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],\n\t\t"at": { "${id}": 1000 }\n\t}\n}\n`

  test('is merged rather than copied when it is in no room', async () => {
    const { mirror, id } = await paired('Board.canvas', plane('base'))

    fake.disk.set(`${ROOT}/Board.canvas`, plane('here'))
    fake.editRemote(id, plane('there'))

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const held = fake.disk.get(`${ROOT}/Board.canvas`) ?? ''
    expect(held).toContain('"here"')
    expect(held).toContain('"there"')
  })

  test('is left to its room, the same as a note', async () => {
    const { mirror, id } = await paired('Board.canvas', plane('base'))
    fake.disk.set(`${ROOT}/Board.canvas`, plane('here'))

    // Every stroke was already carried by the room, so sending the file would be a
    // second writer for one plane.
    expect(await push(mirror, 'token', new Set([id]))).toBe(false)
    expect(fake.calls).toEqual([])
    expect(fake.remote.get(id)?.content).toBe(plane('base'))
  })
})

describe('a note only one side changed', () => {
  test('comes down whether or not it is in a room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.editRemote(id, 'base\nfrom elsewhere\n')

    await pull(mirror, 'token', new Set([id]))

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nfrom elsewhere\n')
    expect(conflicts()).toEqual([])
  })

  test('is still created on the account when it is new here', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/fresh.md`, 'new words\n')

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('createNote fresh.md')
  })
})

/** A page note is JSON Canvas with pages among its nodes, and it travels the way
 *  a canvas travels: up as a note, merged rather than copied, and down onto every
 *  other machine. The server's list of endings left `.pages` out, so a page note
 *  was refused on every pass and stayed on the one device that wrote it; see
 *  NOTE_PATH in services/sync/src/notes.ts. This is that road, from this side. */
describe('a page note', () => {
  const paper = (id: string) =>
    `{
	"nodes": [{ "id": "p1", "type": "page", "x": 0, "y": 0, "width": 794, "height": 1123 }],
	"edges": [],
	"nib": {
		"version": 1,
		"ink": [{ "id": "${id}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],
		"at": { "${id}": 1000 }
	}
}
`

  test('goes up to the account when it is new here', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/Journal.pages`, paper('here'))

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('createNote Journal.pages')
  })

  test('and comes down onto a machine that has never seen it', async () => {
    fake.addRemote('Journal.pages', paper('elsewhere'))
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Journal.pages`)).toBe(paper('elsewhere'))
  })

  /** The same merge a canvas gets, because it is the same file: two devices that
   *  drew on one page keep both hands rather than one winning. */
  test('is merged rather than copied when both sides drew on it', async () => {
    const { mirror, id } = await paired('Journal.pages', paper('base'))

    fake.disk.set(`${ROOT}/Journal.pages`, paper('here'))
    fake.editRemote(id, paper('there'))

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const held = fake.disk.get(`${ROOT}/Journal.pages`) ?? ''
    expect(held).toContain('"here"')
    expect(held).toContain('"there"')
  })
})

describe('a path the account named', () => {
  test('is not written outside the folder the space is', async () => {
    fake.addRemote('../../escape.md', 'somebody else wrote this\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    // Nothing on the disk, and nothing tracked: a note that cannot be placed
    // inside the space is not a note to place.
    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()]).toEqual([])
  })

  test('is not written outside it with the other separator either', async () => {
    fake.addRemote('..\\..\\escape.md', 'somebody else wrote this\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()]).toEqual([])
  })

  test('is still written when it names a folder inside the space', async () => {
    fake.addRemote('deep/one.md', 'ours\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/deep/one.md`)).toBe('ours\n')
  })
})

describe('a page of changes that never ends', () => {
  test('is asked for once rather than forever', async () => {
    const asking = fake.api.changes
    let asked = 0

    // A page that says there is more and hands back the cursor it was given.
    // Following it is a pass that never finishes: the light stays on, the loop
    // never sets its next timer, and a first sync never lets anybody in.
    fake.api.changes = (_token: string, _spaceId: string, since: number) => {
      asked += 1
      if (asked > 3) throw new Error('asked forever')
      return Promise.resolve({ notes: [], cursor: since, more: true })
    }

    try {
      expect(await pull(newMirror('s-one', ROOT), 'token', NOBODY)).toBe(false)
      expect(asked).toBe(1)
    } finally {
      fake.api.changes = asking
    }
  })
})

describe('a file inside a space', () => {
  test('is named the way the account names it', () => {
    expect(within('/Notes', '/Notes/deep/one.md')).toBe('deep/one.md')
    expect(within('C:\\Notes', 'C:\\Notes\\deep\\one.md')).toBe('deep/one.md')
    expect(within('/Notes/', '/Notes/one.md')).toBe('one.md')
  })

  test('is nothing at all when it is somewhere else', () => {
    expect(within('/Notes', '/Other/one.md')).toBeNull()
    expect(within('/Notes', '/NotesToo/one.md')).toBeNull()
    expect(within('/Notes', '/Notes')).toBeNull()
  })
})

/** What the version history holds for one note, oldest first. */
function versions(path: string): string[] {
  return fake.history.get(`${ROOT}/${path}`) ?? []
}

describe('words arriving from the account', () => {
  test('leave the words they replace restorable', async () => {
    const { mirror, id } = await paired('note.md', 'the writing that was here\n')
    fake.editRemote(id, 'what another device says\n')

    await pull(mirror, 'token', NOBODY)

    // The file is what the account says, and what it said before is a version -
    // the same history a save keeps, so the sheet lists it and Restore puts it
    // back. Before this, an overwrite from the account was the one overwrite that
    // left nothing behind on the machine it happened on.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what another device says\n')
    expect(versions('note.md')).toEqual(['the writing that was here\n'])
  })

  test('keep a version of a note this machine had written in', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    // Both sides moved, so the account’s copy lands beside ours - and ours is now
    // one edit further on than the version the pass kept before it.
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('do not land on a conflict copy from earlier the same day', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    // Two conflicts on one note in one day. The copies are named after the day,
    // so the second is written to the name the first is under.
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nthe first thing they said\n')
    await pull(mirror, 'token', NOBODY)

    fake.editRemote(id, 'base\nthe second thing they said\n')
    await pull(mirror, 'token', NOBODY)

    const copy = conflicts()[0] ?? ''
    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(copy)).toBe('base\nthe second thing they said\n')
    // And the one it replaced is still reachable.
    expect(fake.history.get(copy)).toEqual(['base\nthe first thing they said\n'])
  })

  test('keep a version when a canvas is merged into the file', async () => {
    const drawn = (mark: string) =>
      `{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [{ "id": "${mark}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],\n\t\t"at": { "${mark}": 1000 }\n\t}\n}\n`

    const { mirror, id } = await paired('Board.canvas', drawn('base'))
    fake.disk.set(`${ROOT}/Board.canvas`, drawn('here'))
    fake.editRemote(id, drawn('there'))

    await pull(mirror, 'token', NOBODY)

    // A canvas is written over rather than copied beside, so the version is the
    // only way back to the plane as this machine had it.
    expect(versions('Board.canvas')).toEqual([drawn('here')])
  })
})

describe('a note the mirror has no entry for', () => {
  /** A space the account holds, and a folder here that already has the notes in
   *  it, with nothing written down about the two. What a phone whose storage was
   *  truncated wakes up to, and what pairing a folder with a space of the same
   *  name looks like on the first pass. */
  function unrecorded(path: string, here: string, there: string) {
    const id = fake.addRemote(path, there)
    fake.disk.set(`${ROOT}/${path}`, here)
    return { mirror: newMirror('s-one', ROOT), id }
  }

  test('is a conflict rather than an overwrite when the two differ', async () => {
    const { mirror } = unrecorded('note.md', 'what I wrote here\n', 'what the account holds\n')

    await pull(mirror, 'token', NOBODY)

    // Nothing recorded is not the same as nothing written here. Before this, the
    // account’s copy simply landed on top and the writing was gone from the one
    // machine that had it.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what I wrote here\n')
    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(conflicts()[0] ?? '')).toBe('what the account holds\n')
  })

  test('and its own words go up as the newer version', async () => {
    const { mirror, id } = unrecorded('note.md', 'what I wrote here\n', 'what the account holds\n')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)?.content).toBe('what I wrote here\n')
  })

  test('is recorded and left alone when the two already agree', async () => {
    const { mirror } = unrecorded('note.md', 'the same words\n', 'the same words\n')

    await pull(mirror, 'token', NOBODY)

    // A mirror that lost its entries mends itself: the note is found agreeing
    // rather than judged, so there is no copy, and no write either.
    expect(conflicts()).toEqual([])
    expect(fake.calls).toEqual([])
    expect(versions('note.md')).toEqual([])

    // And it is tracked from here on, so the next pass has something to compare.
    expect(await push(mirror, 'token', NOBODY)).toBe(false)
  })

  test('is not a conflict for a file written with Windows line endings', async () => {
    const { mirror } = unrecorded('note.md', 'one\r\ntwo\r\n', 'one\ntwo\n')

    await pull(mirror, 'token', NOBODY)

    // The app keeps whatever line ending a file already had, so its bytes never
    // hash to what the account holds however exactly the two agree. A copy beside
    // every note in the folder is not what that means.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('one\r\ntwo\r\n')
  })

  test('is simply replaced when what is here is the untouched welcome note', async () => {
    const { WELCOME, WELCOME_NAME } = await import('../welcome')
    const { mirror } = unrecorded(WELCOME_NAME, WELCOME, '# the account’s own read me\n')

    await pull(mirror, 'token', NOBODY)

    // The seed the app wrote is nobody's writing, so it is not worth a copy.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/${WELCOME_NAME}`)).toBe('# the account’s own read me\n')
  })

  test('is left to the room when the note is open in one', async () => {
    const { mirror, id } = unrecorded('note.md', 'what I wrote here\n', 'what the room settled\n')

    await pull(mirror, 'token', new Set([id]))

    // The room settled the two character by character before either of them was
    // ever a file, so what comes down is simply what the note now says.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what the room settled\n')
    // And the words it replaced are still a version.
    expect(versions('note.md')).toEqual(['what I wrote here\n'])
  })
})

describe('a first pass, with somebody waiting on it', () => {
  /** A space this machine has nothing of, the way a fresh sign-in finds one. */
  function untouched(...names: string[]) {
    for (const name of names) fake.addRemote(name, `# ${name}\n`)
    return newMirror('s-one', ROOT)
  }

  test('reads out every name before it asks for a single body', async () => {
    const said: string[][] = []
    const fetchedWhen: number[] = []
    const mirror = untouched('one.md', 'Work/two.md', 'three.md')

    await pull(mirror, 'token', NOBODY, {
      listed: (paths) => said.push(paths),
      wrote: () => fetchedWhen.push(said.length),
    })

    // One listing, with all three in it, and nothing had landed by then.
    expect(said).toEqual([[`${ROOT}/one.md`, `${ROOT}/Work/two.md`, `${ROOT}/three.md`]])
    expect(fetchedWhen).toEqual([1, 1, 1])
  })

  test('leaves out a name that could not be placed in the folder', async () => {
    const said: string[][] = []
    fake.addRemote('../escape.md', 'nope\n')
    const mirror = untouched('one.md')

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    // The same names the pass would write, and a name that climbs out of the space
    // is not one of them; see `placeable`.
    expect(said).toEqual([[`${ROOT}/one.md`]])
  })

  test('leaves out a name the account has deleted', async () => {
    const said: string[][] = []
    const id = fake.addRemote('gone.md', 'was here\n')
    await fake.api.deleteNote('token', id)
    const mirror = untouched('one.md')

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    expect(said.flat()).not.toContain(`${ROOT}/gone.md`)
  })

  test('says which path each body landed at', async () => {
    const landed: string[] = []
    const mirror = untouched('one.md', 'Work/two.md')

    await pull(mirror, 'token', NOBODY, { wrote: (path) => landed.push(path) })

    expect(landed.sort()).toEqual([`${ROOT}/Work/two.md`, `${ROOT}/one.md`])
  })

  test('fetches the note on screen first, whatever order the page came in', async () => {
    const mirror = untouched('one.md', 'two.md', 'open.md', 'four.md')

    await pull(mirror, 'token', NOBODY, { wanted: new Set(['open.md']) })

    expect(fake.fetched[0]).toBe('open.md')
    // And every other note still comes down, in the order the account sent them.
    expect(fake.fetched).toEqual(['open.md', 'one.md', 'two.md', 'four.md'])
  })

  test('brings down the same words whichever end it starts from', async () => {
    const wanted = untouched('one.md', 'two.md', 'three.md')
    await pull(wanted, 'token', NOBODY, { wanted: new Set(['three.md']) })
    const both = new Map(fake.disk)

    fake.disk.clear()
    const plain = newMirror('s-two', ROOT)
    await pull(plain, 'token', NOBODY)

    expect([...fake.disk.entries()].sort()).toEqual([...both.entries()].sort())
  })

  test('a page that names nothing says so once and nothing else', async () => {
    const said: string[][] = []
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    expect(said).toEqual([[]])
  })
})

describe('the newest copy standing', () => {
  /** The rule that lets the later of two copies stand. The file's stamp is an
   *  object with a time in it, and it used to be compared with the account's time
   *  as though it were a number - which it never is, so the copy here won every
   *  conflict, however much later the other one had been written. */
  const newest = { rule: 'newest' as const }

  test('is the account’s copy when that was written after the file here', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.modified.set(`${ROOT}/note.md`, 1_000)
    fake.editRemote(id, 'base\nwritten there, later\n', 2_000)

    await pull(mirror, 'token', NOBODY, newest)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten there, later\n')
    // And the words that lost are a version, as the rule promises.
    expect(versions('note.md')).toEqual(['base\nwritten here\n'])
    expect(conflicts()).toEqual([])
  })

  test('and the file here when that was written after the account’s', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here, later\n')
    fake.modified.set(`${ROOT}/note.md`, 2_000)
    fake.editRemote(id, 'base\nwritten there\n', 1_000)

    await pull(mirror, 'token', NOBODY, newest)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here, later\n')
    expect(conflicts()).toEqual([])
  })
})

describe('a file that is there but will not read', () => {
  test('is not written over by the account’s copy of the same name', async () => {
    fake.addRemote('note.md', 'what the account holds\n')
    fake.disk.set(`${ROOT}/note.md`, 'written in some other encoding\n')
    fake.unreadable.add(`${ROOT}/note.md`)

    await pull(newMirror('s-one', ROOT), 'token', NOBODY)

    // Nothing could be read, so no version could be kept: writing over it would
    // have been the end of the only copy.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('written in some other encoding\n')
    expect(fake.calls).toEqual([])
  })

  test('is left out of a push rather than ending it for every note after it', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/a.md`, 'will not read\n')
    fake.unreadable.add(`${ROOT}/a.md`)
    fake.disk.set(`${ROOT}/b.md`, 'the note after it\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual(['createNote b.md'])
  })
})

describe('a delete the account did not take', () => {
  test('is asked again next pass rather than coming back from the account', async () => {
    const { mirror, id } = await paired('note.md', 'the words\n')
    fake.disk.delete(`${ROOT}/note.md`)

    fake.refusing.delete = new TypeError('Failed to fetch')
    await push(mirror, 'token', NOBODY)

    // The connection dropped, so the account still holds the note - and the pull
    // that runs before the next push must not read that as a note to bring down.
    fake.refusing.delete = null
    await pull(mirror, 'token', NOBODY)
    expect(fake.disk.has(`${ROOT}/note.md`)).toBe(false)

    await push(mirror, 'token', NOBODY)
    expect(fake.remote.get(id)?.deleted).toBe(true)
  })

  test('while one the account answered is done with', async () => {
    const { mirror } = await paired('note.md', 'the words\n')
    fake.disk.delete(`${ROOT}/note.md`)
    fake.refusing.delete = new ApiError(404, 'no such note')

    await push(mirror, 'token', NOBODY)
    fake.calls.length = 0
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })
})

/** Another device deleted a note this one holds. Words typed here since the last pass
 *  are words that device never saw, so the edit beats the delete and goes back up; a
 *  note nobody wrote in here goes to this device's trash, never off the disk. */
describe('a note deleted on another device', () => {
  const live = () =>
    [...fake.remote.values()].filter((one) => !one.deleted).map((one) => [one.path, one.content])

  test('is kept when it was written in here since, and goes back up', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.disk.set(`${ROOT}/Plan.md`, '# Plan\ntyped offline\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)
    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\ntyped offline\n')

    await push(mirror, 'token', NOBODY)
    expect(fake.calls).toEqual(['createNote Plan.md'])
    expect(live()).toEqual([['Plan.md', '# Plan\ntyped offline\n']])
  })

  test('goes to this device’s trash when nothing was written here, with a version', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(fake.calls).toEqual([`trash ${ROOT}/Plan.md`])
    expect(fake.history.get(`${ROOT}/Plan.md`)).toEqual(['# Plan\n'])
    expect(live()).toEqual([])
  })

  test('and comes back from the trash, and up to the account with it', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.deleteRemote(id)
    await pull(mirror, 'token', NOBODY)

    const [held] = fake.trash.keys()
    await fake.invoke('restore_trash', { id: held })
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\n')
    expect(live()).toEqual([['Plan.md', '# Plan\n']])
  })

  test('in a folder deleted there keeps the one note written in here', async () => {
    const kept = fake.addRemote('Work/Kept.md', '# Kept\n')
    const left = fake.addRemote('Work/Left.md', '# Left\n')
    fake.disk.set(`${ROOT}/Work/Kept.md`, '# Kept\n')
    fake.disk.set(`${ROOT}/Work/Left.md`, '# Left\n')
    const mirror = newMirror('s-one', ROOT)
    await pull(mirror, 'token', NOBODY)

    fake.disk.set(`${ROOT}/Work/Kept.md`, '# Kept\nand more\n')
    fake.deleteRemote(kept)
    fake.deleteRemote(left)
    fake.calls.length = 0
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Work/Kept.md`)).toBe('# Kept\nand more\n')
    expect(fake.disk.has(`${ROOT}/Work/Left.md`)).toBe(false)
    expect(fake.calls).toEqual([`trash ${ROOT}/Work/Left.md`, 'createNote Work/Kept.md'])
  })

  test('is kept when the file here will not read, since nobody can say it is unchanged', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.unreadable.add(`${ROOT}/Plan.md`)
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\n')
    expect(fake.calls).toEqual([])
  })

  /** A room carries every keystroke up as it is typed, so the account - and its
   *  Recently deleted - already holds what the file says, however far the file has
   *  moved from the last pass. */
  test('goes to the trash when its room already carried the writing up', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.disk.set(`${ROOT}/Plan.md`, '# Plan\ntyped in the room\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', new Set([id]))

    expect(fake.disk.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(fake.calls).toEqual([`trash ${ROOT}/Plan.md`])
  })

  /** A delete names a note, not a path. The name can belong to another note by the
   *  time the delete arrives - one made there since, that a create here was paired
   *  with - and that note's file is not the deleted one's to take. */
  test('leaves alone a file another note holds under that name by now', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.remote.set('n-earlier', {
      id: 'n-earlier',
      path: 'Plan.md',
      content: '# An earlier plan\n',
      version: 2,
      seq: 50,
      deleted: true,
    })

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\n')
    expect(mirror.notes['Plan.md']?.id).toBe(id)
    expect(fake.calls).toEqual([])
  })
})

/** A web note is a browser tab written down, and two devices browsing one site write
 *  it seconds apart. Emil, 2026-10-03: *"Still getting a lot of name-clash files for
 *  web notes."* So a web note is never kept twice, under any rule: the newer copy
 *  stands and what only the older one said comes across. See web-tab/settle.ts. */
describe('a web note both sides changed', () => {
  const site = (url: string, extra = '') =>
    `[InternetShortcut]\r\nURL=${url}\r\nTitle=Docs\r\nNib-Added=2026-09-01T00:00:00.000Z\r\n${extra}`
  const BASE = site('https://docs.dev/')
  const HOME = 'Nib-Home=https://docs.dev/\r\n'

  for (const rule of ['both', 'ask', 'newest'] as const) {
    test(`settles into one file with no copy and nothing held, under ${rule}`, async () => {
      const { mirror, id } = await paired('Docs.url', BASE)
      fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/a', HOME))
      fake.modified.set(`${ROOT}/Docs.url`, 1_000)
      fake.editRemote(
        id,
        site('https://docs.dev/b', `${HOME}Nib-Icon=data:image/png;base64,AA\r\n`),
        2_000,
      )
      const clashes: Clash[] = []

      await pull(mirror, 'token', NOBODY, { rule, clashed: (one) => clashes.push(one) })

      expect(conflicts()).toEqual([])
      expect(clashes).toEqual([])
      // The account's copy was written last, so the reading is where it got to.
      const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
      expect(settled).toContain('URL=https://docs.dev/b')
      expect(settled).toContain('Nib-Icon=data:image/png;base64,AA')
      expect(versions('Docs.url')).toEqual([site('https://docs.dev/a', HOME)])
    })
  }

  test('keeps what only the older copy said, and the newer reading', async () => {
    const { mirror, id } = await paired('Docs.url', BASE)
    fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/a', `${HOME}Nib-Icon=data:mine\r\n`))
    fake.modified.set(`${ROOT}/Docs.url`, 3_000)
    fake.editRemote(id, site('https://docs.dev/b', HOME), 2_000)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
    expect(settled).toContain('URL=https://docs.dev/a')
    expect(settled).toContain('Nib-Icon=data:mine')
    expect(conflicts()).toEqual([])
    expect(fake.remote.get(id)?.content).toBe(settled)
  })

  test('made on two devices at one name is one note, not a copy', async () => {
    const id = fake.addRemote('Docs.url', site('https://docs.dev/there'))
    fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/here', 'Nib-Icon=data:here\r\n'))
    const mirror = newMirror('s-one', ROOT)

    // The create is refused with the note already there, which pairs the two.
    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
    expect(settled).toContain('URL=https://docs.dev/here')
    expect(fake.remote.get(id)?.content).toBe(settled)
  })
})

/** The copies earlier passes made of web notes, folded back into them. One that is
 *  the same note goes - into this device's trash, and off the account - and one that
 *  points somewhere else is a note of its own and is never touched. See web-copies.ts. */
describe('a web note’s old copies', () => {
  const site = (url: string, extra = '') =>
    `[InternetShortcut]\r\nURL=${url}\r\nTitle=Docs\r\nNib-Added=2026-09-01T00:00:00.000Z\r\n${extra}`
  const COPY = 'Docs (from another device 2026-10-01).url'

  test('are folded into the note when they point where it points', async () => {
    const { mirror } = await paired('Docs.url', site('https://docs.dev/'))
    const copy = fake.addRemote(COPY, site('https://docs.dev/', 'Nib-Icon=data:theirs\r\n'))
    await pull(mirror, 'token', NOBODY)
    const second = `${ROOT}/Docs (from another device 2026-10-01) 2.url`
    fake.disk.set(second, site('https://docs.dev/'))

    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/Docs.url`)).toContain('Nib-Icon=data:theirs')
    // To the trash, never for good, and off the account so other devices lose it too.
    expect([...fake.trash.values()].map((one) => one.path).sort()).toEqual(
      [`${ROOT}/${COPY}`, second].sort(),
    )
    expect(fake.remote.get(copy)?.deleted).toBe(true)
  })

  test('stay when they point somewhere else, or when the note has gone', async () => {
    const { mirror } = await paired('Docs.url', site('https://docs.dev/'))
    fake.disk.set(`${ROOT}/${COPY}`, site('https://elsewhere.dev/'))
    fake.disk.set(`${ROOT}/Gone (from another device 2026-10-01).url`, site('https://gone.dev/'))

    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(2)
    expect(fake.trash.size).toBe(0)
  })
})

/** A copy another sync tool made beside a note is never carried, either way, and
 *  never deleted from a disk: Proton Drive syncing the same folder once wrote seven
 *  `(# Name clash … #)` copies of one note and this pass spread them to every device.
 *  See @nib/sync-core/foreign. */
describe('another sync tool’s copy', () => {
  const CLASH = 'Plan (# Name clash 2026-10-05 a1b2c3C #).md'

  /** A mirror from before nib knew better: it tracks the copy as a note. */
  async function tracking() {
    const id = fake.addRemote(CLASH, 'theirs\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')
    const mirror = newMirror('s-one', ROOT)
    mirror.notes[CLASH] = { id, version: 1, hash: await sha(CLASH, 'theirs\n') }
    return { mirror, id }
  }

  async function sha(_path: string, content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  test('is never sent to the account', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')
    fake.disk.set(`${ROOT}/Kept (conflicted copy 2026-10-05 093612)/inside.md`, 'x\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })

  test('while the note beside it goes up as ever', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/Plan.md`, 'mine\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual(['createNote Plan.md'])
  })

  test('is not written onto a disk that does not have it', async () => {
    fake.addRemote(CLASH, 'theirs\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.has(`${ROOT}/${CLASH}`)).toBe(false)
    expect(mirror.notes[CLASH]).toBeUndefined()
  })

  test('one the account has from before is neither sent nor deleted there', async () => {
    const { mirror } = await tracking()
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs, edited\n')
    await push(mirror, 'token', NOBODY)
    fake.disk.delete(`${ROOT}/${CLASH}`)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })

  test('stays on this disk when the account lets go of it', async () => {
    const { mirror, id } = await tracking()
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
    expect(fake.trash.size).toBe(0)
    expect(mirror.notes[CLASH]).toBeUndefined()
  })

  test('is not written over by the account either', async () => {
    const { mirror, id } = await tracking()
    fake.editRemote(id, 'from elsewhere\n')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
  })

  test('is not what a note becomes when the tool puts it aside under that name', async () => {
    const { mirror } = await paired('Plan.md', 'mine\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'mine\n')
    fake.disk.delete(`${ROOT}/Plan.md`)

    expect(await movedHere(mirror, 'token', `${ROOT}/Plan.md`, `${ROOT}/${CLASH}`)).toBe(false)
    expect(fake.calls).toEqual([])
    expect(Object.keys(mirror.notes)).toEqual(['Plan.md'])
  })
})
