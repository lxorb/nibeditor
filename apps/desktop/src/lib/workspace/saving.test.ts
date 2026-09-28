import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Writing what is open down, driven by a stand-in store.
 *
 *  The workspace's own tests take the two rules the long way round - a note in a
 *  space writes itself, a file from the computer waits to be asked; see
 *  workspace.test.ts. What is here is the dot's own life, which those cannot watch
 *  without a clock: it comes on for a write, turns to a tick when the file is down,
 *  and goes by itself a moment later. And the one refusal that matters - a
 *  document that moved on to another note while its write was in the air. */

const sent: { command: string; path: string; content: string }[] = []

/** A write held open, so a test can move the document on mid-flight. */
let holding: Promise<void> | null = null

/** Which command `holding` holds open: the write itself, or the snapshot before it. */
let held = 'write_note'

/** Paths the disk refuses a write to, and how many more times it will. */
const refusing = new Map<string, number>()

vi.mock('../tauri', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: typeof args?.path === 'string' ? args.path : '',
      content: typeof args?.content === 'string' ? args.content : '',
    })
    if (command === held && holding) await holding

    const path = typeof args?.path === 'string' ? args.path : ''
    const left = refusing.get(path) ?? 0
    if (command === 'write_note' && left > 0) {
      refusing.set(path, left - 1)
      throw new Error(`could not write ${path}: the disk is full`)
    }
    return ''
  },
  isNative: false,
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
}))

vi.mock('../link-index.svelte', () => ({
  links: { noteSaved: () => undefined },
}))

vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

const { Saving } = await import('./saving.svelte')
const { settleUp } = await import('../parting')
const { NoteDoc, Tab } = await import('./documents.svelte')
type Writes = import('./saving.svelte').Writes
type Doc = import('./documents.svelte').NoteDoc

const SPACE = '/space'

/** One row of a listing, as the disk hands it over. */
function row(path: string, children: Entry[] = []): Entry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: children.length > 0,
    modified: 0,
    created: 0,
    children,
  }
}

/** The space's listing, holding whatever paths are named. What the store's own
 *  `tree` is, and what says whether a note still has a file: a delete takes the
 *  row out of it before it touches the disk. */
function listing(paths: readonly string[]): Entry {
  return row(
    SPACE,
    paths.map((one) => row(one)),
  )
}

type Entry = import('../workspace.svelte').Entry

/** A store with one document open in it. `kept` is the workspace's own answer to
 *  "is saving this anybody's job", which is the whole of what the two rules turn
 *  on. */
function open(path: string | null, { kept = true, text = '# a' } = {}) {
  let tree = listing(path?.startsWith(`${SPACE}/`) ? [path] : [])

  const ws: Writes & { kept: string[]; persisted: number } = {
    tabs: [],
    documents: [],
    active: null,
    previewTabId: null,
    spaces: [{ id: 's', name: 'Space', root: SPACE }],
    activeSpaceId: 's',
    get tree() {
      return tree
    },
    kept: [],
    persisted: 0,
    keep(id) {
      this.kept.push(id)
    },
    scheduleSession: () => undefined,
    loadTree: () => Promise.resolve(),
    persist() {
      this.persisted += 1
    },
    keepWeb: () => Promise.resolve(),
    // Nothing is in the way in these tests, so the wanted name is the free one.
    freeName: (_folder: string, name: string) => name,
  }

  const saving = new Saving(ws)
  const note: Doc = new NoteDoc(
    { kind: 'note', path, name: 'a.md', text, dirty: false },
    (one) => saving.edited(one),
    () => kept,
  )
  const tab = new Tab(note, 'p1')

  ws.tabs.push(tab)
  ws.documents.push(note)
  Object.defineProperty(ws, 'active', { get: () => tab })

  /** The note deleted, as the store deletes one: the row leaves the listing and
   *  the tab it was open in is closed, both before the file itself goes. See
   *  `remove` in workspace.svelte.ts. */
  const deleted = () => {
    tree = listing([])
    ws.tabs.length = 0
    ws.documents.length = 0
  }

  /** The tab closed on a note that is still there, which is the ordinary way a
   *  document stops being shown. */
  const closed = () => {
    ws.tabs.length = 0
    ws.documents.length = 0
  }

  /** A second note open beside the first, in the same space and the same store. */
  const beside = (other: string, words = '# b') => {
    tree = listing([...(path ? [path] : []), other])
    const second: Doc = new NoteDoc(
      { kind: 'note', path: other, name: nameOfPath(other), text: words, dirty: false },
      (one) => saving.edited(one),
      () => kept,
    )
    ws.tabs.push(new Tab(second, 'p2'))
    ws.documents.push(second)
    return second
  }

  return { saving, note, tab, ws, deleted, closed, beside }
}

const nameOfPath = (path: string) => path.slice(path.lastIndexOf('/') + 1)

beforeEach(() => {
  sent.length = 0
  holding = null
  held = 'write_note'
  refusing.clear()
  vi.useRealTimers()
})

describe('the dot beside a name', () => {
  test('comes on for a write and turns to a tick when the file is down', async () => {
    vi.useFakeTimers()
    const { saving, tab } = open('/elsewhere/a.md', { kept: false })

    const writing = saving.save(tab)
    expect(saving.of(tab)).toBe('saving')

    await writing
    expect(saving.of(tab)).toBe('saved')
  })

  test('and the tick goes by itself a moment later', async () => {
    vi.useFakeTimers()
    const { saving, tab } = open('/elsewhere/a.md', { kept: false })

    await saving.save(tab)
    expect(saving.of(tab)).toBe('saved')

    await vi.advanceTimersByTimeAsync(1400)
    expect(saving.of(tab)).toBeUndefined()
  })

  test('and a note that keeps itself never wears one at all', async () => {
    const { saving, tab } = open(`${SPACE}/a.md`)

    await saving.save(tab)
    expect(saving.of(tab)).toBeUndefined()
    expect(sent.map((one) => one.command)).toEqual(['snapshot_note', 'write_note'])
  })
})

describe('a write whose document has moved on', () => {
  test('is refused rather than landing on the note that is there now', async () => {
    // A file from the computer, so the dot is in play and can say what happened.
    const { saving, note, tab } = open('/elsewhere/a.md', { kept: false })
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    let letGo = () => {
      // Replaced the moment the promise below hands over its resolver.
    }
    holding = new Promise<void>((go) => {
      letGo = () => go()
    })

    const writing = saving.save(tab)
    expect(saving.of(tab)).toBe('saving')

    // The one tab that previews a note takes another note on rather than being
    // swapped for another document; see NoteDoc.arrivals.
    note.adopt({ path: '/elsewhere/b.md', name: 'b.md', text: '# b' })
    letGo()
    await writing

    // Not 'saved': the words reached the snapshot, and telling the document they
    // are its file would be telling the wrong note.
    expect(saving.of(tab)).toBeUndefined()
    expect(said).toHaveBeenCalledOnce()
    expect(note.path).toBe('/elsewhere/b.md')
    said.mockRestore()
  })
})

describe('what the pause after the typing writes', () => {
  test('is every note typed in since the last one, once each', async () => {
    vi.useFakeTimers()
    const { note } = open(`${SPACE}/a.md`)

    note.replace('# a again')
    note.replace('# a once more')
    expect(sent).toEqual([])

    await vi.advanceTimersByTimeAsync(1200)
    expect(sent.filter((one) => one.command === 'write_note')).toHaveLength(1)
  })

  test('and nothing at all for a note the reader is looking after themselves', async () => {
    vi.useFakeTimers()
    const { note } = open('/elsewhere/a.md', { kept: false })

    note.replace('# typed')
    await vi.advanceTimersByTimeAsync(5000)

    expect(sent).toEqual([])
  })
})

describe('the window going while the typing is still warm', () => {
  /** A note is written a second or so after the last keystroke, and a window closing
   *  runs no teardown: the pause never came, so the sentence somebody typed and then
   *  closed the window on was on no disk and in no session either. See `part` in
   *  saving.svelte.ts and parting.ts. */
  const PATH = `${SPACE}/parting.md`
  const written = () => sent.filter((one) => one.command === 'write_note' && one.path === PATH)

  test('writes the note that was waiting for the typing to stop', async () => {
    vi.useFakeTimers()
    const { note } = open(PATH)

    note.replace('# a\n\nthe last sentence')
    expect(written()).toEqual([])

    settleUp()
    await vi.advanceTimersByTimeAsync(0)

    expect(written()).toEqual([
      { command: 'write_note', path: PATH, content: '# a\n\nthe last sentence' },
    ])
  })

  /** And the session with it, synchronously, because the write above is a round trip
   *  a page being torn down may never come back from: whichever of the two landed,
   *  the words are there to come back to. */
  test('and puts the same words in the session, which storage takes at once', () => {
    const { note, ws } = open(PATH)

    note.replace('# a\n\nthe last sentence')
    const was = ws.persisted
    settleUp()

    expect(ws.persisted).toBe(was + 1)
  })

  /** The session goes down whether or not anything was typed: a tab opened or
   *  brought forward in the last half second is what it holds, and that is written
   *  after a pause too. A file is only written where there was something to write. */
  test('and writes the session even where nothing was typed', async () => {
    vi.useFakeTimers()
    const { ws } = open(PATH)

    const was = ws.persisted
    settleUp()
    await vi.advanceTimersByTimeAsync(0)

    expect(ws.persisted).toBe(was + 1)
    expect(written()).toEqual([])
  })
})

describe('a note deleted while the typing was still warm', () => {
  /** A note is written a second or so after the last keystroke, so deleting one
   *  straight after typing in it leaves a write in the air with nowhere to go. It
   *  used to land: the row came back into the file list about a second after it was
   *  deleted, with the words in it, and where the delete took the folder around it
   *  the folder came back too. See `gone` in saving.svelte.ts. */
  test('is not written back to the disk by the write that was waiting', async () => {
    vi.useFakeTimers()
    const { note, deleted } = open(`${SPACE}/a.md`)

    note.replace('# a\n\nthe last thing typed')
    deleted()

    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  /** The other half of the same moment, and the reason the listing is asked about
   *  rather than the tab alone: closing a tab on a note that is still there has to
   *  write what was typed just before it was shut. */
  test('while a tab closed on a note that is still there is written as it always was', async () => {
    vi.useFakeTimers()
    const { note, closed } = open(`${SPACE}/a.md`)

    note.replace('# a\n\nthe last thing typed')
    closed()

    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: `${SPACE}/a.md`, content: '# a\n\nthe last thing typed' },
    ])
  })
})

describe('what is worth keeping a version of', () => {
  test('is every open note with a file, written or not', () => {
    const { saving, note } = open(`${SPACE}/a.md`)
    expect(saving.worthKeeping).toEqual([
      { key: note.key, path: `${SPACE}/a.md`, text: '# a', revision: note.revision },
    ])
  })

  test('and never a note that has no file yet', () => {
    const { saving } = open(null)
    expect(saving.worthKeeping).toEqual([])
  })
})

describe('a write the disk refuses', () => {
  /** A full disk, a file a virus scanner is holding, a folder gone read-only. The
   *  pause used to throw out of the queue: the note was never tried again unless
   *  somebody typed in it, and every note behind it in the queue went unwritten. */
  const A = `${SPACE}/a.md`
  const B = `${SPACE}/b.md`
  const written = (path: string) =>
    sent.filter((one) => one.command === 'write_note' && one.path === path)

  test('is tried again a moment later without another keystroke', async () => {
    vi.useFakeTimers()
    const { note } = open(A)
    refusing.set(A, 1)

    note.replace('# a\n\nthe last sentence')
    await vi.advanceTimersByTimeAsync(1200)
    expect(written(A)).toHaveLength(1)
    expect(note.dirty).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(written(A)).toHaveLength(2)
    expect(note.dirty).toBe(false)
  })

  test('and does not keep the notes waiting behind it from going down', async () => {
    vi.useFakeTimers()
    const { note, beside } = open(A)
    const other = beside(B)
    refusing.set(A, 1)

    note.replace('# a typed')
    other.replace('# b typed')
    await vi.advanceTimersByTimeAsync(1200)

    expect(written(B)).toEqual([{ command: 'write_note', path: B, content: '# b typed' }])
    expect(other.dirty).toBe(false)
  })
})

describe('a note renamed while its write was in the air', () => {
  /** A write is two round trips, the snapshot and then the file, and a rename can
   *  land between them. The words used to go to the name read at the start: the
   *  old file came back beside the renamed one, and the document went back to the
   *  old name with them. */
  test('is written under its new name, and keeps it', async () => {
    const { saving, note, tab } = open(`${SPACE}/a.md`)
    held = 'snapshot_note'

    let letGo = () => {
      // Replaced the moment the promise below hands over its resolver.
    }
    holding = new Promise<void>((go) => {
      letGo = () => go()
    })

    const writing = saving.save(tab)
    // What `rename` in workspace.svelte.ts does to an open note once the file moved.
    note.path = `${SPACE}/b.md`
    letGo()
    await writing

    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.path)).toEqual([
      `${SPACE}/b.md`,
    ])
    expect(note.path).toBe(`${SPACE}/b.md`)
  })
})
