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

vi.mock('../tauri', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: typeof args?.path === 'string' ? args.path : '',
      content: typeof args?.content === 'string' ? args.content : '',
    })
    if (command === 'write_note' && holding) await holding
    return ''
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
}))

vi.mock('../link-index.svelte', () => ({
  links: { noteSaved: () => undefined },
}))

vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

const { Saving } = await import('./saving.svelte')
const { NoteDoc, Tab } = await import('./documents.svelte')
type Writes = import('./saving.svelte').Writes
type Doc = import('./documents.svelte').NoteDoc

const SPACE = '/space'

/** A store with one document open in it. `kept` is the workspace's own answer to
 *  "is saving this anybody's job", which is the whole of what the two rules turn
 *  on. */
function open(path: string | null, { kept = true, text = '# a' } = {}) {
  const ws: Writes & { kept: string[] } = {
    tabs: [],
    documents: [],
    active: null,
    previewTabId: null,
    spaces: [{ id: 's', name: 'Space', root: SPACE }],
    activeSpaceId: 's',
    tree: null,
    kept: [],
    keep(id) {
      this.kept.push(id)
    },
    scheduleSession: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
    keepWeb: () => Promise.resolve(),
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

  return { saving, note, tab, ws }
}

beforeEach(() => {
  sent.length = 0
  holding = null
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
