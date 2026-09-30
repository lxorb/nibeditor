import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EditorState } from '@nib/editor'

/** Writing across a space without opening it, driven by a stand-in store.
 *
 *  The four obligations are what this is about: the version about to be replaced is
 *  kept, the file is written, the index hears what it says now, and a pane that
 *  happens to be showing the note is handed the words that changed rather than the
 *  whole note. Plus the two callers that are only these in a different order - a
 *  task ticked from a row of search results, and a tag renamed everywhere. */

const sent: { command: string; path: string; content: string }[] = []
const told: string[] = []

/** What is on this disk, for the reads that do not go through an open document. */
const disk = new Map<string, string>()

/** A command held open until the test lets it go, so a keystroke can land inside
 *  the round trip it is. */
let holding: { command: string; until: Promise<void> } | null = null

vi.mock('../tauri', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })
    if (holding?.command === command) await holding.until

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) throw new Error('no such note')
      return held
    }

    if (command === 'write_note') disk.set(path, content)
    return ''
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void told.push(`saved ${path}`),
    spaceTags: [{ path: 'work', count: 2 }],
    scanning: false,
    scanned: () => Promise.resolve(),
  },
}))

vi.mock('../sync.svelte', () => ({ sync: { nudge: () => void told.push('nudged') } }))

const { loadTags, noteText, replaceInNotes, retagNotes, toggleTaskAt, writeNoteText } =
  await import('./note-text')
const { FileActions } = await import('./undo.svelte')
const { undoLastFileAction } = await import('./undoing')
type PutsBack = import('./undoing').PutsBack
const { NoteDoc } = await import('./documents.svelte')
type HoldsNotes = import('./note-text').HoldsNotes

const SPACE = '/space'

/** A store with the given notes on its disk and, optionally, one of them open in a
 *  pane - which is the case the edits are for. */
function space(notes: Record<string, string>, openAt?: string) {
  disk.clear()
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)

  const edits: string[] = []
  const open = openAt ? [openNote(openAt, notes[openAt] ?? '')] : []
  for (const note of open) {
    // What the pane was handed: the words the edits left, each time.
    const edited = note.edited.bind(note)
    note.edited = (changes, after) => {
      edits.push(after)
      edited(changes, after)
    }
  }

  const ws = {
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    notes: Object.keys(notes).map((path) => ({ path })),
    documents: open,
    documentAt: (path: string) => open.find((one) => one.path === path) ?? null,
    undone: new FileActions(),
    tags: [],
    flushed: 0,
    flush() {
      this.flushed += 1
    },
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }

  return { ws: ws as unknown as HoldsNotes & { flushed: number }, edits }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  holding = null
})

describe('a replacement across the space', () => {
  test('keeps what was there, writes what is, and says so once', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'before' })

    await replaceInNotes(ws, [
      {
        path: `${SPACE}/a.md`,
        before: 'before',
        after: 'after',
        edits: [{ from: 0, to: 6, insert: 'after' }],
        back: [{ from: 0, to: 5, insert: 'before' }],
      },
    ])

    expect(sent).toEqual([
      { command: 'snapshot_note', path: `${SPACE}/a.md`, content: 'before' },
      { command: 'write_note', path: `${SPACE}/a.md`, content: 'after' },
    ])
    expect(told).toEqual([`saved ${SPACE}/a.md`, 'nudged'])
    expect(ws.undone.stack).toEqual([
      {
        kind: 'replace',
        notes: [
          {
            path: `${SPACE}/a.md`,
            content: 'before',
            after: 'after',
            edits: [{ from: 0, to: 5, insert: 'before' }],
          },
        ],
      },
    ])
  })

  test('hands an open note the words that changed rather than the whole note', async () => {
    const { ws, edits } = space({ [`${SPACE}/a.md`]: 'before' }, `${SPACE}/a.md`)

    await replaceInNotes(ws, [
      {
        path: `${SPACE}/a.md`,
        before: 'before',
        after: 'after',
        edits: [{ from: 0, to: 6, insert: 'after' }],
        back: [{ from: 0, to: 5, insert: 'before' }],
      },
    ])

    expect(edits).toEqual(['after'])
  })

  test('and however many notes it touched, it is one thing to undo', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'x', [`${SPACE}/b.md`]: 'x' })

    await replaceInNotes(
      ws,
      ['a', 'b'].map((name) => ({
        path: `${SPACE}/${name}.md`,
        before: 'x',
        after: 'y',
        edits: [{ from: 0, to: 1, insert: 'y' }],
        back: [{ from: 0, to: 1, insert: 'x' }],
      })),
    )

    expect(ws.undone.stack).toHaveLength(1)
  })

  test('and nothing at all where there is nothing to change', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'x' })
    await replaceInNotes(ws, [])

    expect(sent).toEqual([])
    expect(ws.undone.stack).toEqual([])
  })
})

describe("a note's words as they stand", () => {
  test('are what is on screen when it is open, unwritten and all', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'on disk' }, `${SPACE}/a.md`)
    disk.set(`${SPACE}/a.md`, 'on disk')

    // The document says what the pane holds, which is what a replacement must not
    // write over.
    expect(await noteText(ws, `${SPACE}/a.md`)).toBe('on disk')
    expect(ws.flushed).toBe(1)
    expect(sent).toEqual([])
  })

  test('are read off the disk otherwise', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'on disk' })
    expect(await noteText(ws, `${SPACE}/a.md`)).toBe('on disk')
    expect(sent.map((one) => one.command)).toEqual(['read_note'])
  })

  test('and nothing at all for a note that is not there', async () => {
    const { ws } = space({})
    expect(await noteText(ws, `${SPACE}/gone.md`)).toBeNull()
  })
})

describe('a task ticked from a row', () => {
  const NOTE = `${SPACE}/todo.md`

  test('reads the line again rather than trusting the row', async () => {
    const { ws } = space({ [NOTE]: '# to do\n\n- [ ] wash up\n- [x] done\n' })

    expect(await toggleTaskAt(ws, NOTE, 2)).toBe(true)
    expect(disk.get(NOTE)).toBe('# to do\n\n- [x] wash up\n- [x] done\n')
  })

  test('and clears one that is ticked', async () => {
    const { ws } = space({ [NOTE]: '- [x] done\n' })

    expect(await toggleTaskAt(ws, NOTE, 0)).toBe(true)
    expect(disk.get(NOTE)).toBe('- [ ] done\n')
  })

  test('and says no where the line the row named holds no box now', async () => {
    const { ws } = space({ [NOTE]: '# to do\n\njust words\n' })

    expect(await toggleTaskAt(ws, NOTE, 2)).toBe(false)
    expect(sent.every((one) => one.command === 'read_note')).toBe(true)
  })

  test('and says no for a line the note does not have', async () => {
    const { ws } = space({ [NOTE]: '- [ ] one\n' })
    expect(await toggleTaskAt(ws, NOTE, 40)).toBe(false)
  })
})

/** Which notes a rename touches and what each becomes is tag-edits.test.ts's. What is
 *  here is the rest of it: a note open in a pane is read as it stands rather than as it
 *  was saved, a note with no such tag is not written at all, and the whole rename is
 *  one thing to undo. */
describe('a tag renamed everywhere', () => {
  test('rewrites every note that wears it, and only those, as one thing to undo', async () => {
    const { ws } = space({
      [`${SPACE}/a.md`]: 'Plan #work\n',
      [`${SPACE}/b.md`]: 'Nothing tagged\n',
      [`${SPACE}/c.md`]: 'Also #work/q3\n',
    })

    expect(await retagNotes(ws, 'work', 'job')).toBe(2)

    expect(disk.get(`${SPACE}/a.md`)).toBe('Plan #job\n')
    expect(disk.get(`${SPACE}/b.md`)).toBe('Nothing tagged\n')
    expect(disk.get(`${SPACE}/c.md`)).toBe('Also #job/q3\n')
    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.path)).toEqual([
      `${SPACE}/a.md`,
      `${SPACE}/c.md`,
    ])
    expect(ws.undone.stack).toHaveLength(1)
    expect(ws.undone.last?.kind).toBe('replace')
  })

  test('reads an open note as it stands on screen, not as it was saved', async () => {
    const { ws, edits } = space({ [`${SPACE}/a.md`]: 'Typed #work\n' }, `${SPACE}/a.md`)
    // Saved before the typing; the pane holds what the rename has to work on.
    disk.set(`${SPACE}/a.md`, 'Saved\n')

    expect(await retagNotes(ws, 'work', null)).toBe(1)
    expect(edits).toEqual(['Typed\n'])
  })
})

describe("the space's tags", () => {
  test('come off the index', async () => {
    const { ws } = space({})
    await loadTags(ws)

    expect(ws.tags).toEqual([{ path: 'work', count: 2 }])
  })
})

/** The editor in a hover card hands back the whole note it was given, because that is
 *  what an editor holds. What reaches the file is the one span that changed, so a pane
 *  showing the same note keeps every caret in it. See preview-card.ts and hover.ts in
 *  @nib/editor. */
describe('a note written from a hover card', () => {
  test('goes in as the one span it changed by, not as the note again', async () => {
    const { ws, edits } = space({ [`${SPACE}/a.md`]: 'the plan for monday' }, `${SPACE}/a.md`)

    await writeNoteText(ws, `${SPACE}/a.md`, 'the plan for monday', 'the plan for tuesday')

    expect(sent).toEqual([
      { command: 'snapshot_note', path: `${SPACE}/a.md`, content: 'the plan for monday' },
      { command: 'write_note', path: `${SPACE}/a.md`, content: 'the plan for tuesday' },
    ])
    expect(edits).toEqual(['the plan for tuesday'])
    expect(ws.undone.stack).toEqual([
      {
        kind: 'replace',
        notes: [
          {
            path: `${SPACE}/a.md`,
            content: 'the plan for monday',
            after: 'the plan for tuesday',
            // `mon` became `tues`, and nothing either side of it moved.
            edits: [{ from: 13, to: 17, insert: 'mon' }],
          },
        ],
      },
    ])
  })

  test('and is one thing to undo, which puts the words back', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'one\ntwo\n' })

    await writeNoteText(ws, `${SPACE}/a.md`, 'one\ntwo\n', 'one\ntwo\nthree\n')

    const undo = ws.undone.stack[0]
    expect(undo?.kind).toBe('replace')
    expect(told).toEqual([`saved ${SPACE}/a.md`, 'nudged'])
  })

  test('writes nothing at all where nothing was typed', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'unchanged' })

    await writeNoteText(ws, `${SPACE}/a.md`, 'unchanged', 'unchanged')

    expect(sent).toEqual([])
    expect(ws.undone.stack).toEqual([])
  })
})

/** A note open in a pane, as the real document it is. */
function openNote(path: string, words: string) {
  return new NoteDoc(
    { kind: 'note', path, name: path.split('/').at(-1) ?? path, text: words, dirty: false },
    () => undefined,
  )
}

/** A note open in a pane, with a pane on it that can be typed in: the words, the
 *  live text every view shares, and the dirty mark. */
function typedIn(path: string, words: string) {
  const { ws } = space({ [path]: words })
  const note = openNote(path, words)

  const view = {
    state: EditorState.create({ doc: note.live.text }),
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      view.state = view.state.update(spec).state
    },
  }
  note.live.join(view)

  const held = ws as unknown as { documents: unknown[]; documentAt: (at: string) => unknown }
  held.documents = [note]
  held.documentAt = (at: string) => (at === path ? note : null)

  /** A keystroke, the way the editor hands one over: applied in the view, then
   *  given to the document. See the update listener in editor.ts. */
  const type = (at: number, insert: string) => {
    const made = view.state.update({ changes: { from: at, insert } })
    view.state = made.state
    note.live.local(made.changes, made.state.selection, view)
  }

  const live = () => note.live.text.toString()
  return { ws, note, type, live }
}

/** Holds a command open, and answers what lets it go. */
function hold(command: string): () => void {
  // In an object, so the compiler sees the promise's executor fill it in.
  const held = { release: () => undefined as unknown }
  const until = new Promise<void>((resolve) => (held.release = resolve))
  holding = { command, until }
  return () => void held.release()
}

/** The reader goes on typing while a replacement is on its way to the note. The
 *  replacement was worked out against the words as they were read, and it lands on
 *  the words as they are: measured against the first, applied to the second, a
 *  keystroke in between used to shift every edit after it and was then written
 *  over by a text that never had it. See docs/agent-native.md 8.2. */
describe('a replacement while the reader types', () => {
  const NOTE = `${SPACE}/plan.md`

  test('keeps a keystroke typed while the version was being kept', async () => {
    const { ws, note, type, live } = typedIn(NOTE, 'the plan for monday')
    const before = await noteText(ws, NOTE)
    if (before === null) throw new Error('the note is open')

    const release = hold('snapshot_note')
    const writing = writeNoteText(ws, NOTE, before, 'the plan for tuesday')
    type(0, 'Re: ')
    release()
    await writing

    expect(live()).toBe('Re: the plan for tuesday')
    note.flush()
    expect(note.text).toBe('Re: the plan for tuesday')
    // The keystroke is on the disk, or the note still says it has to be written.
    expect(disk.get(NOTE) === live() || note.dirty).toBe(true)
  })

  test('keeps a keystroke typed between the read and the write', async () => {
    const { ws, note, type, live } = typedIn(NOTE, 'the plan for monday')
    const before = await noteText(ws, NOTE)
    if (before === null) throw new Error('the note is open')

    type(0, 'Re: ')
    await writeNoteText(ws, NOTE, before, 'the plan for tuesday')

    expect(live()).toBe('Re: the plan for tuesday')
    note.flush()
    expect(note.text).toBe('Re: the plan for tuesday')
    expect(disk.get(NOTE) === live() || note.dirty).toBe(true)
    // And taking the replacement back puts back what the reader had, keystroke
    // and all, rather than the words as they were read.
    expect(ws.undone.stack).toEqual([
      {
        kind: 'replace',
        notes: [
          {
            path: NOTE,
            content: 'Re: the plan for monday',
            after: 'Re: the plan for tuesday',
            edits: [{ from: 17, to: 21, insert: 'mon' }],
          },
        ],
      },
    ])
  })

  test('keeps a keystroke typed in one note while another is being written', async () => {
    const { ws, type, live } = typedIn(NOTE, '- [ ] call #work')
    disk.set(`${SPACE}/other.md`, 'also #work')
    const notes = ws as unknown as { notes: { path: string }[] }
    notes.notes = [{ path: `${SPACE}/other.md` }, { path: NOTE }]

    const release = hold('snapshot_note')
    const renaming = retagNotes(ws, 'work', 'job')
    // The rename has read both notes and is keeping the first one's version.
    await new Promise((resolve) => setTimeout(resolve, 0))
    type(6, 'now ')
    release()
    await renaming

    expect(disk.get(`${SPACE}/other.md`)).toBe('also #job')
    expect(live()).toBe('- [ ] now call #job')
  })
})

/** And the other way round: a replacement taken back after the reader went on
 *  typing. What the undo held was the words as they were before the replacement,
 *  and it put those back whole - over whatever had been typed since. The edits that
 *  take the replacement back are carried onto the words as they are now instead, the
 *  way the replacement's own were; see `putWordsBack` in workspace/undoing.ts. */
describe('a replacement taken back while the reader types', () => {
  const NOTE = `${SPACE}/plan.md`

  test('keeps what was typed after it, in an open note', async () => {
    const { ws, note, type, live } = typedIn(NOTE, 'the plan for monday')
    await writeNoteText(ws, NOTE, 'the plan for monday', 'the plan for tuesday')
    type(0, 'Re: ')

    await undoLastFileAction(ws as unknown as PutsBack)

    expect(live()).toBe('Re: the plan for monday')
    note.flush()
    expect(note.text).toBe('Re: the plan for monday')
    expect(disk.get(NOTE) === live() || note.dirty).toBe(true)
  })

  test('and in a note that was closed again after the typing was written', async () => {
    const { ws } = space({ [NOTE]: 'the plan for monday' })
    await writeNoteText(ws, NOTE, 'the plan for monday', 'the plan for tuesday')
    disk.set(NOTE, 'Re: the plan for tuesday')

    await undoLastFileAction(ws as unknown as PutsBack)

    expect(disk.get(NOTE)).toBe('Re: the plan for monday')
  })
})
