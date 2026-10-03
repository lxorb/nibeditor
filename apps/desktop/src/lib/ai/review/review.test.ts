import { EditorState, reviewMarks, reviewMarksOf, type TransactionSpec } from '@nib/editor'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Thread, Turn } from '../chat/types'

/** The review over real notes: a stand-in desk with documents really open in it
 *  (lib/agents/docs/test-desk.ts), the agent's real steps, and the workspace and the
 *  sends standing in for the app around them. */

const fake = vi.hoisted(() => ({
  desk: null as unknown as ReturnType<typeof import('../../agents/docs/test-desk').deskWith>,
  documents: [] as NoteDoc[],
  removed: [] as string[],
}))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    get documents() {
      return fake.documents
    },
    spaces: [{ id: 's1', name: 'Space', root: '/space' }],
    noteText: (path: string) => fake.desk.desk.noteText(path),
    remove: (path: string) => {
      fake.removed.push(path)
      fake.desk.disk.delete(path)
      return Promise.resolve()
    },
    open: () => Promise.resolve(),
    loadTree: () => Promise.resolve(),
    goto: null,
  },
}))

vi.mock('../../agents/docs', async () => {
  const edit = await import('../../agents/docs/edit')
  const { located } = await import('../../agents/docs/desk')
  const at = (path: string) =>
    located(fake.desk.desk, { path: path.slice('/space/'.length), space: 's1' })
  return {
    onTracks: edit.onTracks,
    trackedAgents: edit.trackedAgents,
    tracksOf: edit.tracksOf,
    undoSomeIn: (
      agent: { id: string; name: string },
      path: string,
      ids: ReadonlySet<string>,
      token?: string,
    ) => edit.undoSomeAt(fake.desk.desk, agent, at(path), ids, token),
    putBackIn: (agent: { id: string; name: string }, path: string, token: string) =>
      edit.putBackAt(fake.desk.desk, agent, at(path), token),
  }
})

vi.mock('../chat/sends', () => ({
  answeringAt: (provider: string) => (provider.startsWith('p') ? `t-${provider}` : null),
  onSend: () => () => undefined,
}))

// An agent's caret, and the mark on the tabs showing the note: no tabs here.
vi.mock('../../agents/docs/presence', () => ({ showAgent: () => undefined }))

vi.mock('./summary', () => ({ summarized: () => Promise.resolve('summary') }))

vi.mock('../../workspace/write-file', () => ({
  writeFile: (path: string, words: string) => {
    fake.desk.disk.set(path, words)
    return Promise.resolve()
  },
}))

const { deskWith } = await import('../../agents/docs/test-desk')
const { editNote } = await import('../../agents/docs/edit')
const { review } = await import('./review.svelte')

/** A view of a note with the review's marks in it. */
class Viewer {
  state: EditorState
  constructor(note: NoteDoc) {
    this.state = EditorState.create({ doc: note.live.text, extensions: [reviewMarks()] })
    note.live.join(this)
  }
  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
  }
}

let made = 0
let clock = 1_000

/** A provider of its own for every test: what an agent did is kept for the session. */
function aThread(): Thread & { provider: string } {
  made++
  const provider = `p${String(made)}`
  return {
    id: `t-${provider}`,
    space: 's1',
    title: '',
    provider,
    model: 'm',
    effort: 'auto',
    mode: 'agent',
    turns: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
    created: 0,
    updated: 0,
  }
}

/** The reader sends a message, which the agent answers by editing. */
async function message(
  thread: Thread,
  words: string,
  edits: { path: string; at: unknown; replace: string }[],
  parts: Turn['parts'] = [],
) {
  clock += 1000
  const turn: Turn = {
    id: words,
    role: 'you',
    at: clock,
    parts: [],
    draft: { text: words, attachments: [] },
  }
  thread.turns.push(turn)
  clock += 10
  for (const one of edits) {
    await editNote(
      fake.desk.desk,
      { id: `nib-${thread.provider}`, name: 'nib' },
      { path: one.path },
      [{ at: one.at, replace: one.replace }],
    )
  }
  thread.turns.push({
    id: `${words}-answer`,
    role: 'model',
    at: clock,
    parts,
    provider: thread.provider,
  })
}

const settle = (ms = 0) => new Promise((done) => setTimeout(done, ms))

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a rewind', () => {
  test('across three notes takes back what came after, and Redo puts it back', async () => {
    fake.desk = deskWith({ 'a.md': 'one', 'b.md': 'two', 'c.md': 'three' }, [
      'a.md',
      'b.md',
      'c.md',
    ])
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    const panel = { send: vi.fn(), text: '', touched: vi.fn() }

    await message(thread, 'first', [{ path: 'a.md', at: { quote: 'one' }, replace: 'ONE' }])
    await message(thread, 'second', [
      { path: 'a.md', at: { start: true }, replace: '' },
      { path: 'b.md', at: { quote: 'two' }, replace: 'TWO' },
      { path: 'c.md', at: { quote: 'three' }, replace: 'THREE' },
    ])
    fake.desk.panes['b.md']?.type(0, '> ')
    expect(review.notes(thread).map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])

    await review.rewind(thread, 'second', 'both', panel)
    expect(fake.desk.panes['a.md']?.text).toBe('ONE')
    expect(fake.desk.panes['b.md']?.text).toBe('> two')
    expect(fake.desk.panes['c.md']?.text).toBe('three')
    expect(thread.turns.map((one) => one.id)).toEqual(['first', 'first-answer'])
    expect(panel.text).toBe('second')
    expect(panel.touched).toHaveBeenCalledWith(thread)

    await review.putBack(thread, panel)
    expect(fake.desk.panes['b.md']?.text).toBe('> TWO')
    expect(fake.desk.panes['c.md']?.text).toBe('THREE')
    expect(thread.turns).toHaveLength(4)
  })

  test('sends a note the thread made since to Recently deleted', async () => {
    fake.desk = deskWith({ 'Made.md': 'new words' })
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      [
        {
          kind: 'tool',
          id: 'c1',
          verb: 'create_note',
          args: { path: 'Made' },
          state: 'ok',
          result: { text: '{"path":"Made.md","created":true}', images: [], error: false },
        },
      ],
    )

    expect(review.plan(thread, 'make')?.choices).toContain('notes')
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual(['/space/Made.md'])

    await review.putBack(thread, null)
    expect(fake.desk.fileOf('Made.md')).toBe('new words')
  })
})

describe('a change', () => {
  test('kept leaves the list, and its mark fades out of the note', async () => {
    fake.desk = deskWith({ 'k.md': 'one two' }, ['k.md'])
    const note = fake.desk.panes['k.md']?.note
    if (!note) throw new Error('open')
    fake.documents = [note]
    const viewer = new Viewer(note)
    const thread = aThread()

    await message(thread, 'go', [{ path: 'k.md', at: { quote: 'two' }, replace: 'TWO' }])
    await settle()
    expect(reviewMarksOf(viewer.state)).toEqual([
      { id: expect.any(String) as string, from: 4, to: 7, removed: 'two' },
    ])

    review.keep(review.changes(thread))
    expect(review.changes(thread)).toEqual([])
    await settle(250)
    expect(reviewMarksOf(viewer.state)).toEqual([])
  })

  test('undone goes, with a later edit that rewrote its words', async () => {
    fake.desk = deskWith({ 'u.md': 'alpha omega' }, ['u.md'])
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    await message(thread, 'one', [{ path: 'u.md', at: { quote: 'alpha' }, replace: 'beta gamma' }])
    await message(thread, 'two', [
      { path: 'u.md', at: { quote: 'gamma' }, replace: 'delta' },
      { path: 'u.md', at: { quote: 'omega' }, replace: 'OMEGA' },
    ])

    const [first] = review.changes(thread)
    if (!first) throw new Error('changed')
    expect(await review.undo([first])).toBe(1)
    expect(fake.desk.panes['u.md']?.text).toBe('alpha OMEGA')
    expect(review.said).toBe('and 1 after it')
    expect(review.changes(thread)).toHaveLength(1)
  })
})
