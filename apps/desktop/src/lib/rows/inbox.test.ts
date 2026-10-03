import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Each space's inbox: `Inbox.md` unless the space says otherwise, following its note
 *  through a rename, and made the first time it is needed and never over one there. */

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

const disk = new Map<string, string>()

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: (command: string, args?: { path?: string }) => {
    const held = disk.get(args?.path ?? '')
    if (command === 'read_note' && held !== undefined) return Promise.resolve(held)
    return Promise.reject(new Error('no such note'))
  },
}))

const { ensureInbox, INBOX, inboxes, inboxOf, setInbox, STORAGE_KEY } = await import('./inbox')

const ROOT = '/spaces/Work'

beforeEach(() => {
  localStorage.clear()
  disk.clear()
})

describe('the inbox of a space', () => {
  test('is Inbox.md at its root until the space says otherwise, which is kept only then', () => {
    expect(inboxOf(ROOT)).toBe(INBOX)

    setInbox(ROOT, 'Capture/Later.md')
    expect(inboxOf(ROOT)).toBe('Capture/Later.md')

    setInbox(ROOT, INBOX)
    expect(inboxOf(ROOT)).toBe(INBOX)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  test('follows its note when it is renamed or its folder moves, and nothing else', () => {
    inboxes.moved?.(`${ROOT}/Inbox.md`, `${ROOT}/Triage.md`, ROOT)
    expect(inboxOf(ROOT)).toBe('Triage.md')

    inboxes.moved?.(`${ROOT}/Other.md`, `${ROOT}/Else.md`, ROOT)
    expect(inboxOf(ROOT)).toBe('Triage.md')

    setInbox(ROOT, 'Capture/Triage.md')
    inboxes.moved?.(`${ROOT}/Capture`, `${ROOT}/Desk`, ROOT)
    expect(inboxOf(ROOT)).toBe('Desk/Triage.md')
  })

  test('goes with its space when the space is renamed, and is forgotten with it', () => {
    setInbox(ROOT, 'Triage.md')
    inboxes.spaceMoved?.(ROOT, '/spaces/Job')
    expect(inboxOf('/spaces/Job')).toBe('Triage.md')
    expect(inboxOf(ROOT)).toBe(INBOX)

    inboxes.forget?.('/spaces/Job')
    expect(inboxOf('/spaces/Job')).toBe(INBOX)
  })

  test('is made the first time it is needed, and never over one that is there', async () => {
    const made: string[] = []
    const make = (path: string) => {
      made.push(path)
      disk.set(path, '')
      return Promise.resolve()
    }

    expect(await ensureInbox(ROOT, make)).toBe(`${ROOT}/Inbox.md`)
    disk.set(`${ROOT}/Inbox.md`, '- [ ] already here\n')
    expect(await ensureInbox(ROOT, make)).toBe(`${ROOT}/Inbox.md`)
    expect(made).toEqual([`${ROOT}/Inbox.md`])
  })
})
