import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The disk, as far as this test is concerned: what each file says and what its
 *  stamp is. The store reads notes and stamps through the platform shim, so the
 *  shim is stood in for before anything is imported. */
const disk = new Map<string, { text: string; modified: number }>()

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  // The watcher only ever runs on a desktop, and this is one.
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const file = disk.get(pathOf(args))

    if (command === 'read_note') {
      if (!file) throw new Error(`no such file: ${pathOf(args)}`)
      return Promise.resolve(file.text)
    }

    if (command === 'file_stamp') {
      return Promise.resolve(file ? { modified: file.modified, len: file.text.length } : null)
    }

    return Promise.resolve(undefined)
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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded once, at module scope; the workspace reaches half the app. */
const { workspace } = await import('./workspace.svelte')
const { watch } = await import('./watch.svelte')
const { sync } = await import('./sync.svelte')

const PATH = 'C:/Users/me/elsewhere/Plan.md'

/** The file as another program has just left it. */
function written(text: string, modified: number) {
  disk.set(PATH, { text, modified })
}

/** The note the app is showing, whatever pane it is in. */
function open() {
  const found = workspace.openNotes.find((one) => one.path === PATH)
  if (!found) throw new Error('the file is not open')
  return found.note
}

beforeEach(async () => {
  // On the clock from here on, so that a debounce this test's editing schedules -
  // the session persist a note's `edited` sets going - lands on a clock the
  // afterEach can drop rather than a real timer that wakes two tests later and
  // writes over what it finds. Installed before the note is opened below, which is
  // itself one of the things that schedules that write. See afterEach.
  vi.useFakeTimers({ shouldAdvanceTime: true })

  for (const tab of [...workspace.tabs]) workspace.close(tab.id)
  disk.clear()
  sync.status = 'off'
  sync.lastError = null

  written('one\n', 1000)
  await workspace.open(PATH)
  // The first look is what the file looks like rather than news about it.
  await watch.look()
})

afterEach(() => {
  // Drop whatever this test left on the clock before the next one runs; dropping
  // is not firing, so a stale write never happens. Real again on the way out.
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
})

describe('a file that changes under a note nobody has edited', () => {
  test('quietly becomes what is on the disk', async () => {
    written('one\ntwo\n', 2000)
    await watch.look()

    expect(open().text).toBe('one\ntwo\n')
    expect(open().dirty).toBe(false)
    expect([...watch.clashing]).toEqual([])
  })

  test('is not reported as anything', async () => {
    written('one\ntwo\n', 2000)
    await watch.look()

    expect(sync.status).toBe('off')
  })

  test('is looked at once, not on every pass afterwards', async () => {
    written('one\ntwo\n', 2000)
    await watch.look()
    await watch.look()

    expect(open().text).toBe('one\ntwo\n')
  })
})

describe('a file that changes under a note with unsaved words in it', () => {
  /** The rule: the editor's words are the ones somebody is looking at, and nothing
   *  the disk says is worth taking them away. */
  test('keeps every word the editor holds', async () => {
    const note = open()
    note.replace('mine\n')
    expect(note.dirty).toBe(true)

    written('theirs\n', 2000)
    await watch.look()

    expect(open().text).toBe('mine\n')
    expect(open().dirty).toBe(true)
  })

  test('says so on the light in the corner', async () => {
    open().replace('mine\n')
    written('theirs\n', 2000)
    await watch.look()

    expect(sync.status).toBe('error')
    expect(sync.lastError).toContain('Plan.md')
    expect([...watch.clashing]).toEqual([PATH])
  })

  test('settles once the note is saved, and reloads nothing over the top of it', async () => {
    open().replace('mine\n')
    written('theirs\n', 2000)
    await watch.look()

    // Saved: the file is what the editor holds, and the clash is over.
    written('mine\n', 3000)
    open().replace('mine\n', false)
    await watch.look()

    expect([...watch.clashing]).toEqual([])
    expect(open().text).toBe('mine\n')
  })
})

describe('what is not watched', () => {
  test('a note the app itself keeps, because nothing else writes it', async () => {
    workspace.spaces.push({ id: 'one', name: 'Notes', root: 'C:/Spaces/Notes' })
    const inside = 'C:/Spaces/Notes/Kept.md'
    disk.set(inside, { text: 'a\n', modified: 1000 })

    await workspace.open(inside)
    await watch.look()
    disk.set(inside, { text: 'changed by somebody\n', modified: 2000 })
    await watch.look()

    const note = workspace.openNotes.find((one) => one.path === inside)?.note
    expect(note?.text).toBe('a\n')

    workspace.spaces.length = 0
  })

  test('a file that has gone: the note is the only copy of it left', async () => {
    disk.delete(PATH)
    await watch.look()

    expect(open().text).toBe('one\n')
    expect([...watch.clashing]).toEqual([])
  })
})
