import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { editNote, PATIENCE, undoAgent, writeNote } from './edit'
import { SHOWN_FOR } from './presence'
import { DocError } from './problem'
import { revOf } from './rev'
import { deskWith } from './test-desk'
import { touchedBy } from './touched'

/** An agent editing notes while somebody writes in them. Every test has its own
 *  agent, because what an agent did is kept for the session. */
let made = 0
function anAgent(name = 'Claude Code') {
  made++
  return { id: `agent-${String(made)}`, name }
}

/** What an edit is refused with. */
async function refusal(pending: Promise<unknown>): Promise<string> {
  try {
    await pending
  } catch (error) {
    if (error instanceof DocError) return error.code
    throw error
  }
  return 'applied'
}

describe('an edit to an open note', () => {
  test('lands in the live words as one change, the reader’s caret carried with them', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'alpha beta gamma' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.select(16, 16)

    const answer = await editNote(desk, anAgent(), { path: 'plan.md' }, [
      { at: { quote: 'alpha' }, replace: 'ALPHA ONE' },
    ])

    expect(pane.text).toBe('ALPHA ONE beta gamma')
    // Four characters more in front of it, and nothing else about it moved.
    expect(pane.caret).toBe(20)
    expect(answer).toEqual({ path: 'plan.md', rev: revOf(pane.text), edits: 1, lines: [0] })
    // Unsaved until the note writes itself, like anything typed.
    expect(pane.note.dirty).toBe(true)
  })

  test('is one Ctrl+Z of its own, apart from what the reader typed either side', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'one' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')

    pane.type(3, ' two')
    await editNote(desk, anAgent(), { path: 'plan.md' }, [
      { at: { start: true }, insert_before: 'AGENT' },
    ])
    pane.type(pane.text.length, ' three')

    pane.undo()
    expect(pane.text).toBe('AGENT\n\none two')
    pane.undo()
    expect(pane.text).toBe('one two')
  })

  test('is refused when the words changed since the agent read them, if it asked', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'one' }, ['plan.md'])
    const read = revOf('one')
    panes['plan.md']?.type(3, '!')

    expect(
      await refusal(
        editNote(
          desk,
          anAgent(),
          { path: 'plan.md' },
          [{ at: { end: true }, insert_after: 'x' }],
          read,
        ),
      ),
    ).toBe('rev_changed')
  })

  test('uses the reader’s selection in the note in front of them', async () => {
    const { desk, panes, inFront } = deskWith({ 'plan.md': 'make this better' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.select(5, 9)
    inFront(pane)

    await editNote(desk, anAgent(), { path: 'plan.md' }, [
      { at: { selection: true }, replace: 'THAT' },
    ])

    expect(pane.text).toBe('make THAT better')
  })

  test('keeps the version before the agent’s first edit, once, and says whose', async () => {
    const { desk, kept } = deskWith({ 'plan.md': 'before' }, ['plan.md'])
    const agent = anAgent()

    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { end: true }, insert_after: ' one' }])
    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { end: true }, insert_after: ' two' }])

    expect(kept).toEqual([{ path: '/space/plan.md', content: 'before', source: 'Claude Code' }])
  })

  test('shows the agent’s caret where it wrote, gone after a few seconds', async () => {
    vi.useFakeTimers()
    try {
      const { desk, panes } = deskWith({ 'plan.md': 'one two' }, ['plan.md'])
      const pane = panes['plan.md']
      if (!pane) throw new Error('open')

      await editNote(desk, anAgent('Codex'), { path: 'plan.md' }, [
        { at: { quote: 'one' }, replace: 'uno' },
      ])
      expect(pane.agents.map((one) => [one.name, one.head])).toEqual([['Codex', 3]])

      pane.type(0, '>> ')
      expect(pane.agents[0]?.head).toBe(6)

      vi.advanceTimersByTime(SHOWN_FOR + 10)
      expect(pane.agents).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Where the reader has been writing in the last two seconds, an edit waits for them
 *  to pause; see docs/agent-native.md 8.3. */
describe('the reader’s typing wins', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('an edit where they are writing waits for them to pause, then lands on what they wrote', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'the plan is simple' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.type(12, 'very ')

    let done = false
    const editing = editNote(desk, anAgent(), { path: 'plan.md' }, [
      { at: { quote: 'simple' }, replace: 'late' },
    ]).then(() => (done = true))

    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toBe(false)
    expect(pane.text).toBe('the plan is very simple')

    await vi.advanceTimersByTimeAsync(1500)
    await editing
    expect(pane.text).toBe('the plan is very late')
  })

  test('and says so when what it was for is gone once they pause', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'the plan is simple' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.type(12, 'very ')

    const editing = refusal(
      editNote(desk, anAgent(), { path: 'plan.md' }, [
        { at: { quote: 'simple' }, replace: 'late' },
      ]),
    )
    await vi.advanceTimersByTimeAsync(500)
    pane.erase(12, 23)
    pane.type(12, 'done')
    await vi.advanceTimersByTimeAsync(3000)

    expect(await editing).toBe('reader_edited_here')
    expect(pane.text).toBe('the plan is done')
  })

  test('an edit somewhere else lands at once', async () => {
    const { desk, panes } = deskWith({ 'plan.md': '# Plan\n\nwriting here' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.type(pane.text.length, ' now')

    await editNote(desk, anAgent(), { path: 'plan.md' }, [
      { at: { quote: 'Plan' }, replace: 'Plans' },
    ])

    expect(pane.text).toBe('# Plans\n\nwriting here now')
  })

  test('an agent’s next edit waits its turn behind one that is waiting', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'a b' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.type(1, 'a')
    const agent = anAgent()

    const first = editNote(desk, agent, { path: 'plan.md' }, [
      { at: { quote: 'aa' }, replace: 'A' },
    ])
    const second = editNote(desk, agent, { path: 'plan.md' }, [
      { at: { quote: 'b' }, replace: 'B' },
    ])
    await vi.advanceTimersByTimeAsync(10)
    expect(pane.text).toBe('aa b')

    await vi.advanceTimersByTimeAsync(2500)
    await Promise.all([first, second])
    expect(pane.text).toBe('A B')
  })

  test('and gives up, saying so, when they never pause', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'word' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.type(4, '!')

    const editing = refusal(
      editNote(desk, anAgent(), { path: 'plan.md' }, [
        { at: { quote: 'word' }, insert_after: '?' },
      ]),
    )
    for (let at = 0; at < PATIENCE / 500 + 4; at++) {
      pane.type(4, '!')
      await vi.advanceTimersByTimeAsync(500)
    }

    expect(await editing).toBe('reader_typing')
  })
})

describe('an edit to a closed note', () => {
  test('goes in through the write every closed note takes, keeping the version once', async () => {
    const { desk, written, fileOf } = deskWith({ 'log.md': '- [ ] one\n' })
    const agent = anAgent()

    await editNote(desk, agent, { path: 'log' }, [{ at: { task: 'one' }, replace: '- [x] one' }])
    await editNote(desk, agent, { path: 'log.md' }, [
      { at: { task: 'one' }, insert_after: '- [ ] two' },
    ])

    expect(fileOf('log.md')).toBe('- [x] one\n- [ ] two\n')
    expect(written.map((one) => one.keeping)).toEqual([
      { snapshot: true, source: 'Claude Code' },
      { snapshot: false, source: 'Claude Code' },
    ])
  })

  test('is resolved against the words with one line ending, whatever the file has', async () => {
    const { desk, fileOf } = deskWith({ 'crlf.md': '# Title\r\n\r\nline one\r\nline two\r\n' })

    const answer = await editNote(desk, anAgent(), { path: 'crlf.md' }, [
      { at: { quote: 'one\r\nline' }, replace: 'one\nand' },
    ])

    expect(fileOf('crlf.md')).toBe('# Title\n\nline one\nand two\n')
    expect(answer.lines).toEqual([2])
  })

  test('refuses what is not a note in the space', async () => {
    const { desk } = deskWith({ 'a.md': '' })
    const agent = anAgent()
    const edit = [{ at: { end: true }, insert_after: 'x' }]

    expect(await refusal(editNote(desk, agent, { path: '../outside.md' }, edit))).toBe(
      'no_such_note',
    )
    expect(await refusal(editNote(desk, agent, { path: 'board.canvas' }, edit))).toBe('not_a_note')
    expect(await refusal(editNote(desk, agent, { path: 'missing.md' }, edit))).toBe('no_such_note')
    expect(await refusal(editNote(desk, agent, { path: 'a.md', space: 'Elsewhere' }, edit))).toBe(
      'no_such_space',
    )
  })
})

describe('the whole of a note, written', () => {
  test('goes in as the one span it differs by, so the reader’s caret stays', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'the plan for monday, then lunch' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    pane.select(31, 31)

    await writeNote(desk, anAgent(), { path: 'plan.md' }, 'the plan for tuesday, then lunch')

    expect(pane.text).toBe('the plan for tuesday, then lunch')
    expect(pane.caret).toBe(32)
  })
})

/** "Undo the agent's edits" takes back everything one agent did to one note, mapped
 *  through what the reader did since, so every word of theirs stays (8.5). */
describe('taking an agent’s edits back', () => {
  test('keeps every character the reader typed in between, even inside what it wrote', async () => {
    vi.useFakeTimers()
    const { desk, panes } = deskWith({ 'plan.md': 'Intro.\n\nBody text here.\n' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()
    const edit = (edits: unknown) => editNote(desk, agent, { path: 'plan.md' }, edits)

    await edit([{ at: { quote: 'Intro.' }, insert_after: ' Agent adds this.' }])
    pane.type(0, 'Reader: ')
    await edit([{ at: { quote: 'Body' }, replace: 'Main' }])
    // The reader writes inside the agent's own words.
    pane.type(pane.text.indexOf('adds') + 5, 'kindly ')
    // Right where the reader is writing, so it waits for them to pause first.
    const waiting = edit([
      { at: { quote: 'adds kindly this' }, replace: 'adds kindly this, and more' },
    ])
    await vi.advanceTimersByTimeAsync(2500)
    await waiting
    vi.useRealTimers()
    pane.type(pane.text.length, 'P.S.')

    expect(await undoAgent(desk, agent, { path: 'plan.md' })).toEqual({ undone: 3 })
    expect(pane.text).toBe('Reader: Intro.kindly \n\nBody text here.\nP.S.')
    expect(touchedBy('/space/plan.md').filter((one) => one.id === agent.id)).toEqual([])
  })

  test('two edits of the same words come back out without a trace', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'one two three' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { quote: 'two' }, replace: 'abc' }])
    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { quote: 'b' }, replace: 'XYZ' }])
    expect(pane.text).toBe('one aXYZc three')

    await undoAgent(desk, agent, { path: 'plan.md' })
    expect(pane.text).toBe('one two three')
  })

  test('is one Ctrl+Z, which puts them all back', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'a' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { end: true }, insert_after: 'b' }])
    await editNote(desk, agent, { path: 'plan.md' }, [{ at: { end: true }, insert_after: 'c' }])
    await undoAgent(desk, agent, { path: 'plan.md' })
    expect(pane.text).toBe('a')

    pane.undo()
    expect(pane.text).toBe('a\n\nb\n\nc')
    // And they are the agent's to take back again.
    await undoAgent(desk, agent, { path: 'plan.md' })
    expect(pane.text).toBe('a')
  })

  test('leaves alone what the reader already took back with Ctrl+Z', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'base' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'plan.md' }, [
      { at: { quote: 'base' }, insert_before: 'one ' },
    ])
    await editNote(desk, agent, { path: 'plan.md' }, [
      { at: { quote: 'base' }, insert_after: ' two' },
    ])
    pane.undo()
    expect(pane.text).toBe('one base')

    expect(await undoAgent(desk, agent, { path: 'plan.md' })).toEqual({ undone: 1 })
    expect(pane.text).toBe('base')
  })

  test('only this agent’s, never another’s', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'x' }, ['plan.md'])
    const pane = panes['plan.md']
    if (!pane) throw new Error('open')
    const one = anAgent('One')
    const other = anAgent('Other')

    await editNote(desk, one, { path: 'plan.md' }, [{ at: { quote: 'x' }, insert_before: '1' }])
    await editNote(desk, other, { path: 'plan.md' }, [{ at: { quote: 'x' }, insert_after: '2' }])
    const mine = (agent: { id: string }) => agent.id === one.id || agent.id === other.id
    expect(
      touchedBy('/space/plan.md')
        .filter(mine)
        .map((agent) => agent.name),
    ).toEqual(['One', 'Other'])

    await undoAgent(desk, one, { path: 'plan.md' })
    expect(pane.text).toBe('x2')
  })

  test('in a closed note, through what was written there since', async () => {
    const { desk, disk, fileOf } = deskWith({ 'log.md': 'first\n' })
    const agent = anAgent()

    await editNote(desk, agent, { path: 'log.md' }, [
      { at: { end: true }, insert_after: 'agent line' },
    ])
    // Something else writes the note meanwhile.
    disk.set('/space/log.md', `top\n${fileOf('log.md') ?? ''}`)

    expect(await undoAgent(desk, agent, { path: 'log.md' })).toEqual({ undone: 1 })
    expect(fileOf('log.md')).toBe('top\nfirst\n')
  })

  test('in a note closed and opened again since', async () => {
    const { desk, panes, open, close } = deskWith({ 'plan.md': 'words' }, ['plan.md'])
    const agent = anAgent()

    await editNote(desk, agent, { path: 'plan.md' }, [
      { at: { quote: 'words' }, insert_after: ' more' },
    ])
    panes['plan.md']?.type(0, 'my ')
    close('plan.md')
    const again = open('plan.md')
    again.type(again.text.length, '!')

    await undoAgent(desk, agent, { path: 'plan.md' })
    expect(again.text).toBe('my words!')
  })
})
