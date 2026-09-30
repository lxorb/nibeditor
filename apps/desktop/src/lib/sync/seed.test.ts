import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WELCOME, WELCOME_NAME } from '../welcome'

/** The welcome note, and the three rules that keep it out of somebody's account.
 *
 *  Emil: "on the plugin every time I open it it creates and syncs the default note
 *  onto my account. This is so annoying." A packed plugin's storage is empty on
 *  every launch, so the shim read every launch as a first visit, wrote the note, and
 *  a pass offered it to the account - putting it back each time he deleted it.
 *
 *  Any one of the three fixes it, and all three are here because each is a different
 *  way of being wrong about the same thing: the plugin never seeds, a device is
 *  seeded once, and an untouched seed never travels. This file is the third, and the
 *  pairing that goes with it; the first two are next door in web/commands.test.ts. */

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
  const calls: string[] = []
  let seq = 0

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      return Promise.resolve(held as T)
    }

    if (command === 'write_note') {
      calls.push(`write ${path}`)
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
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

  const api = {
    changes: () => Promise.resolve({ notes: [], cursor: 0, more: false }),
    readNote: async (_token: string, id: string) => {
      const note = remote.get(id)
      if (!note) throw new Error('no such note')
      return { note: await present(note), content: note.content }
    },
    writeNote: async (_token: string, id: string, path: string, content: string) => {
      calls.push(`writeNote ${path}`)
      const note = remote.get(id)
      if (!note) throw new Error('no such note')

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      calls.push(`createNote ${path}`)

      const taken = [...remote.values()].find((one) => one.path === path && !one.deleted)
      if (taken) {
        const { ApiError } = await import('../api')
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
    deleteNote: () => Promise.resolve({ ok: true as const }),
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
    calls.length = 0
    seq = 0
  }

  return { addRemote, api, calls, disk, invoke, remote, reset }
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: fake.api,
}))

const { newMirror } = await import('./mirror')
const { push } = await import('./pass')

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

/** Every path the account holds a live note at. */
function held(): string[] {
  return [...fake.remote.values()]
    .filter((one) => !one.deleted)
    .map((one) => one.path)
    .sort()
}

describe('the welcome note, on its way to an account', () => {
  test('is never created there while it is untouched', async () => {
    fake.disk.set(`${ROOT}/${WELCOME_NAME}`, WELCOME)
    const mirror = newMirror('s-one', ROOT)

    const moved = await push(mirror, 'token', NOBODY)

    expect(held()).toEqual([])
    expect(fake.calls).toEqual([])
    expect(moved).toBe(false)
  })

  test('and not on the next pass either, however many launches there are', async () => {
    fake.disk.set(`${ROOT}/${WELCOME_NAME}`, WELCOME)
    const mirror = newMirror('s-one', ROOT)

    for (let at = 0; at < 5; at++) await push(mirror, 'token', NOBODY)

    expect(held()).toEqual([])
  })

  test('but goes up like any other note once somebody has written in it', async () => {
    fake.disk.set(`${ROOT}/${WELCOME_NAME}`, `${WELCOME}\nA line of my own.\n`)
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)

    expect(held()).toEqual([WELCOME_NAME])
  })

  test('and a note that only happens to be called that is nobody’s business', async () => {
    fake.disk.set(`${ROOT}/${WELCOME_NAME}`, '# My own read me\n')
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)

    expect(held()).toEqual([WELCOME_NAME])
  })
})

/** The account holds one live note per path and says so with a 409. Before this it
 *  threw and took the whole pass with it, and the pass came round again to throw
 *  again. */
describe('a path the account already holds', () => {
  test('is paired rather than made twice, and nothing is sent', async () => {
    fake.addRemote('plan.md', 'The plan.\n')
    fake.disk.set(`${ROOT}/plan.md`, 'The plan.\n')
    const mirror = newMirror('s-one', ROOT)

    const moved = await push(mirror, 'token', NOBODY)

    expect(held()).toEqual(['plan.md'])
    // Tried once, refused, and recorded as the note it is. Nothing was written.
    expect(fake.calls).toEqual(['createNote plan.md'])
    expect(mirror.notes['plan.md']?.id).toBe('n-plan.md')
    expect(moved).toBe(false)
  })

  test('and the next pass has nothing left to try', async () => {
    fake.addRemote('plan.md', 'The plan.\n')
    fake.disk.set(`${ROOT}/plan.md`, 'The plan.\n')
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)
    fake.calls.length = 0
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })

  test('keeps both when the two say different things', async () => {
    fake.addRemote('plan.md', 'Their plan.\n')
    fake.disk.set(`${ROOT}/plan.md`, 'My plan.\n')
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)

    // Theirs beside ours on the disk, and ours is what the account now holds:
    // neither is dropped, which is the rule this file has always kept.
    const copies = [...fake.disk.keys()].filter((one) => one.includes('from another device'))
    expect(copies).toHaveLength(1)
    expect(fake.disk.get(copies[0] ?? '')).toBe('Their plan.\n')
    expect([...fake.remote.values()][0]?.content).toBe('My plan.\n')
  })
})
