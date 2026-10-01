import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Writing what is open down, driven by a stand-in store.
 *
 *  The workspace's own tests take the rules the long way round, through tabs and
 *  files; see workspace.test.ts. What is here is the machinery on its own clock:
 *  the pause, the ceiling on it, a draft that stays a tab until it is given a place,
 *  one file operation at a time per document, the version a sitting's first write
 *  keeps, and a write the disk refuses. */

const sent: { command: string; path: string; content: string }[] = []

/** A write held open, so a test can do something while it is in the air. */
let holding: Promise<void> | null = null

/** Paths the disk refuses a write to, and how many more times it will. */
const refusing = new Map<string, number>()

vi.mock('../tauri', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: typeof args?.path === 'string' ? args.path : '',
      content: typeof args?.content === 'string' ? args.content : '',
    })
    if (command === 'write_note' && holding) await holding

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

const light = { status: 'off', lastError: null as string | null }
vi.mock('../sync.svelte', () => ({
  sync: Object.assign(light, { nudge: () => undefined, wrote: () => undefined }),
}))

const { Saving } = await import('./saving.svelte')
const { settleUp } = await import('../parting')
const { NoteDoc, Tab, UNTITLED } = await import('./documents.svelte')
type Writes = import('./saving.svelte').Writes
type Doc = import('./documents.svelte').NoteDoc
type Entry = import('../workspace.svelte').Entry

const SPACE = '/space'

/** One row of a listing, as the disk hands it over. */
function row(path: string): Entry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

/** The space's listing, holding whatever paths are named. What says whether a note
 *  still has a file: a delete takes the row out of it before it touches the disk. */
function listing(paths: readonly string[]): Entry {
  return { ...row(SPACE), is_dir: true, children: paths.map(row) }
}

const written = (path?: string) =>
  sent.filter((one) => one.command === 'write_note' && (path === undefined || one.path === path))

const versions = () => sent.filter((one) => one.command === 'snapshot_note')

/** Every store a test made, so what one left waiting is written before the next
 *  begins: the window going writes every store there is, and a note one test left
 *  on its clock would otherwise land in the next test's list of writes. */
const stores: InstanceType<typeof Saving>[] = []

/** What a test document starts as, where it is not a note saying `# a`. */
interface Starting {
  text?: string
  kind?: 'note' | 'canvas'
}

/** A store with one document open in it: a note at `path`, or a draft with none. */
function open(path: string | null, { text = '# a', kind = 'note' }: Starting = {}) {
  let tree = listing(path?.startsWith(`${SPACE}/`) ? [path] : [])
  const came: { path: string; key: string | undefined }[] = []

  const ws: Writes & { persisted: number; lists: number } = {
    tabs: [],
    documents: [],
    active: null,
    previewTabId: null,
    get tree() {
      return tree
    },
    persisted: 0,
    lists: 0,
    keep: () => undefined,
    scheduleSession: () => undefined,
    loadTree() {
      this.lists += 1
      return Promise.resolve()
    },
    persist() {
      this.persisted += 1
    },
    // What the listing and every open document hold, the one asking left out.
    freeName: (folder: string, name: string, except?: string) => {
      const taken = new Set([
        ...tree.children.map((one) => one.path),
        ...ws.documents.flatMap((one) => (one.path === null ? [] : [one.path])),
      ])
      if (except !== undefined) taken.delete(except)

      const dot = name.lastIndexOf('.')
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${name.slice(0, dot)} ${n}${name.slice(dot)}`
        if (!taken.has(`${folder}/${candidate}`)) return candidate
      }
    },
    born: () => undefined,
    touched: () => undefined,
    fileCame(path: string, _kind: 'file' | 'folder', key?: string) {
      came.push({ path, key })
      return Promise.resolve()
    },
  }

  const saving = new Saving(ws)
  stores.push(saving)
  const note: Doc = new NoteDoc(
    { kind, path, name: path?.slice(path.lastIndexOf('/') + 1) ?? UNTITLED, text, dirty: false },
    (one) => saving.edited(one),
  )
  const tab = new Tab(note, 'p1')

  ws.tabs.push(tab)
  ws.documents.push(note)
  Object.defineProperty(ws, 'active', { get: () => tab })

  /** The note deleted, as the store deletes one: the row leaves the listing and
   *  the tab it was open in is closed, both before the file itself goes. */
  const deleted = () => {
    tree = listing([])
    ws.tabs.length = 0
    ws.documents.length = 0
  }

  /** The tab closed, which is the ordinary way a document stops being shown. */
  const closed = () => {
    ws.tabs.length = 0
    ws.documents.length = 0
    saving.closed(note)
  }

  /** A second note open beside the first. */
  const beside = (other: string, words = '# b') => {
    tree = listing([...(path ? [path] : []), other])
    const second: Doc = new NoteDoc(
      {
        kind: 'note',
        path: other,
        name: other.slice(other.lastIndexOf('/') + 1),
        text: words,
        dirty: false,
      },
      (one) => saving.edited(one),
    )
    ws.tabs.push(new Tab(second, 'p2'))
    ws.documents.push(second)
    return second
  }

  /** Types into the note the way the editor does: through the live text. */
  const type = (words: string) => {
    note.live.replace(words, true)
  }

  return { saving, note, tab, ws, deleted, closed, beside, type, came }
}

beforeEach(() => {
  sent.length = 0
  holding = null
  refusing.clear()
  light.status = 'off'
  light.lastError = null
  vi.useRealTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  holding = null
  refusing.clear()
  await Promise.all(stores.map((one) => one.settled()))
})

describe('what the pause after the typing writes', () => {
  test('is every note typed in since the last one, once each, well inside a second', async () => {
    vi.useFakeTimers()
    const { note } = open(`${SPACE}/a.md`)

    note.replace('# a again')
    note.replace('# a once more')
    expect(written()).toEqual([])

    await vi.advanceTimersByTimeAsync(400)
    expect(written()).toEqual([
      { command: 'write_note', path: `${SPACE}/a.md`, content: '# a once more' },
    ])
  })

  /** Somebody typing without a pause is written all the same: the pause is put off
   *  by every keystroke, but never past its ceiling. */
  test('and never waits more than two seconds while the typing never stops', async () => {
    vi.useFakeTimers()
    const { note } = open(`${SPACE}/a.md`)

    for (let at = 0; at < 10; at++) {
      note.replace(`# a ${String(at)}`)
      await vi.advanceTimersByTimeAsync(250)
    }

    expect(written().length).toBeGreaterThanOrEqual(1)
  })

  test('and keeps no version of its own: only the words as the sitting began', async () => {
    vi.useFakeTimers()
    const { note } = open(`${SPACE}/a.md`, { text: '# this morning' })

    note.replace('# a')
    await vi.advanceTimersByTimeAsync(400)
    note.replace('# a b')
    await vi.advanceTimersByTimeAsync(400)

    expect(versions()).toEqual([
      { command: 'snapshot_note', path: `${SPACE}/a.md`, content: '# this morning' },
    ])
    expect(written()).toHaveLength(2)
  })
})

describe('a draft', () => {
  /** A new tab is a tab and nothing else until somebody gives it a place: its words
   *  are the session's to keep, the way VS Code's hot exit keeps an untitled editor. */
  test('stays a tab however much is written in it', async () => {
    vi.useFakeTimers()
    const { note, type, saving } = open(null, { text: '' })

    type('# Plan for Monday\n\nwords')
    await vi.advanceTimersByTimeAsync(2500)
    await saving.settled()

    expect(note.path).toBeNull()
    expect(written()).toEqual([])
  })

  test('given a place, is a file there at once, under the name it is given', async () => {
    const { note, type, saving, came } = open(null, { text: '' })
    type('# Plan')

    const landed = await saving.place(note, `${SPACE}/Work`, 'Monday.md')

    expect(landed).toBe(`${SPACE}/Work/Monday.md`)
    expect(note.path).toBe(landed)
    expect(note.dirty).toBe(false)
    expect(written()).toEqual([{ command: 'write_note', path: landed, content: '# Plan' }])
    // The one file operation a new file owes, naming the document that is it.
    expect(came).toEqual([{ path: landed, key: note.key }])
  })

  test('steps aside from a name the folder already has', async () => {
    const { note, saving, beside } = open(null, { text: 'x' })
    beside(`${SPACE}/Plan.md`)

    expect(await saving.place(note, SPACE, 'Plan.md')).toBe(`${SPACE}/Plan 2.md`)
  })

  test('a plane is written as it stands, drawn on or not', async () => {
    const { note, saving } = open(null, { text: '{"nodes":[]}', kind: 'canvas' })

    await saving.place(note, SPACE, 'Board.canvas')

    expect(written()).toEqual([
      { command: 'write_note', path: `${SPACE}/Board.canvas`, content: '{"nodes":[]}' },
    ])
  })

  test('given a place twice is written once', async () => {
    const { note, saving } = open(null, { text: 'x' })

    await saving.place(note, SPACE, 'A.md')
    expect(await saving.place(note, SPACE, 'B.md')).toBeNull()
    expect(written()).toHaveLength(1)
  })

  test('says nothing of white space: a blank draft stays a tab', async () => {
    const { note, type, saving } = open(null, { text: '' })

    type('   \n\n')
    await saving.settled()

    expect(note.path).toBeNull()
    expect(written()).toEqual([])
  })

  test('closed leaves nothing behind on the disk', async () => {
    const { type, closed, saving } = open(null, { text: '' })

    type('words')
    closed()
    await saving.settled()

    expect(written()).toEqual([])
  })

  test('two given places together never land on one file', async () => {
    const { note, saving, ws } = open(null, { text: 'P' })
    const other = new NoteDoc(
      { kind: 'note', path: null, name: UNTITLED, text: 'P', dirty: false },
      (one) => saving.edited(one),
    )
    ws.tabs.push(new Tab(other, 'p2'))
    ws.documents.push(other)

    await Promise.all([saving.place(note, SPACE, 'P.md'), saving.place(other, SPACE, 'P.md')])

    expect(new Set([note.path, other.path]).size).toBe(2)
  })
})

describe('the window going while the typing is still warm', () => {
  const PATH = `${SPACE}/parting.md`

  test('writes the note that was waiting for the typing to stop', async () => {
    vi.useFakeTimers()
    const { note } = open(PATH)

    note.replace('# a\n\nthe last sentence')
    expect(written(PATH)).toEqual([])

    settleUp()
    await vi.advanceTimersByTimeAsync(0)

    expect(written(PATH)).toEqual([
      { command: 'write_note', path: PATH, content: '# a\n\nthe last sentence' },
    ])
  })

  /** And the session with it, synchronously, because the write above is a round trip
   *  a page being torn down may never come back from. */
  test('and puts the same words in the session, which storage takes at once', () => {
    const { note, ws } = open(PATH)

    note.replace('# a\n\nthe last sentence')
    const was = ws.persisted
    settleUp()

    expect(ws.persisted).toBe(was + 1)
  })

  test('and says it is writing until the write has landed', async () => {
    const { note, saving } = open(PATH)

    note.replace('# a\n\nthe last sentence')
    expect(saving.writing).toBe(true)

    await saving.settled()
    expect(saving.writing).toBe(false)
  })
})

describe('Ctrl+S', () => {
  test('writes what is waiting now, keeps the note in front as a version, and asks nothing', async () => {
    const PATH = `${SPACE}/pressed.md`
    const { note, saving } = open(PATH)

    note.replace('# a\n\ntyped')
    await saving.writeNow()

    expect(written(PATH)).toEqual([{ command: 'write_note', path: PATH, content: '# a\n\ntyped' }])
    expect(versions().at(-1)).toEqual({
      command: 'snapshot_note',
      path: PATH,
      content: '# a\n\ntyped',
    })
  })

  test('and on a blank new tab does nothing at all', async () => {
    const { saving, note, ws } = open(null, { text: '' })

    await saving.writeNow()
    expect(note.path).toBeNull()
    expect(ws.lists).toBe(0)
  })
})

describe('a note deleted while the typing was still warm', () => {
  test('is not written back to the disk by the write that was waiting', async () => {
    vi.useFakeTimers()
    const { note, deleted } = open(`${SPACE}/a.md`)

    note.replace('# a\n\nthe last thing typed')
    deleted()

    await vi.advanceTimersByTimeAsync(5000)
    expect(written()).toEqual([])
  })

  test('while a tab closed on a note that is still there is written at once', async () => {
    const { note, closed, saving } = open(`${SPACE}/a.md`)

    note.replace('# a\n\nthe last thing typed')
    closed()
    await saving.settled()

    expect(written()).toEqual([
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
  const A = `${SPACE}/a.md`
  const B = `${SPACE}/b.md`

  test('is tried again a moment later without another keystroke', async () => {
    vi.useFakeTimers()
    const { note } = open(A)
    refusing.set(A, 1)

    note.replace('# a\n\nthe last sentence')
    await vi.advanceTimersByTimeAsync(400)
    expect(written(A)).toHaveLength(1)
    expect(note.dirty).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(written(A)).toHaveLength(2)
    expect(note.dirty).toBe(false)
  })

  test('and does not keep the notes waiting beside it from going down', async () => {
    vi.useFakeTimers()
    const { note, beside } = open(A)
    const other = beside(B)
    refusing.set(A, 1)

    note.replace('# a typed')
    other.replace('# b typed')
    await vi.advanceTimersByTimeAsync(400)

    expect(written(B)).toEqual([{ command: 'write_note', path: B, content: '# b typed' }])
    expect(other.dirty).toBe(false)
  })

  /** A file that will not be written until somebody does something about it is on
   *  the light, with its name: the words stay in the note and the tries go on. */
  test('and the third refusal in a row is on the light', async () => {
    vi.useFakeTimers()
    const { note } = open(A)
    refusing.set(A, 10)

    note.replace('# a typed')
    await vi.advanceTimersByTimeAsync(400 + 2000 + 4000)

    expect(light.status).toBe('error')
    expect(light.lastError).toContain('a')
    expect(note.dirty).toBe(true)
  })
})

describe('a note renamed while its write was in the air', () => {
  /** A write and a rename are two round trips, and a rename landing inside a write
   *  used to move the file out from under it: the write then put the old name back
   *  beside the new one. One at a time per document, whoever asked. */
  test('is renamed only once the write has landed', async () => {
    const { saving, note } = open(`${SPACE}/a.md`)
    const order: string[] = []

    let letGo = () => {
      // Replaced the moment the promise below hands over its resolver.
    }
    holding = new Promise<void>((go) => {
      letGo = () => go()
    })

    note.replace('# a typed')
    const writing = saving.write(note)
    const renaming = saving.holding(note, () => {
      order.push(`rename after ${String(written().length)} write`)
      note.path = `${SPACE}/b.md`
      return Promise.resolve()
    })

    await Promise.resolve()
    expect(order).toEqual([])

    letGo()
    await Promise.all([writing, renaming])

    expect(order).toEqual(['rename after 1 write'])
    expect(written().map((one) => one.path)).toEqual([`${SPACE}/a.md`])
    expect(note.path).toBe(`${SPACE}/b.md`)
  })
})
