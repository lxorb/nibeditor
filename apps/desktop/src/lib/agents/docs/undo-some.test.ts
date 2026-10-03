import { describe, expect, test } from 'vitest'
import { located } from './desk'
import { editNote, putBackAt, tracksOf, undoAgent, undoSomeAt } from './edit'
import { deskWith } from './test-desk'

/** Taking back some of an agent's edits and leaving the rest: the review's Undo of
 *  one change, and a rewind. Every test has its own agent: what one did is kept for
 *  the session. */
let made = 0
function anAgent() {
  made++
  return { id: `some-${String(made)}`, name: 'nib · Claude' }
}

/** The ids of the agent's edits of a note, oldest first. */
function idsOf(agent: { id: string }, path: string): string[] {
  return tracksOf(agent.id).get(`/space/${path}`)?.ids ?? []
}

describe('one change taken back among others', () => {
  test('goes, and the reader’s typing and the agent’s later edits elsewhere stay', async () => {
    const { desk, panes } = deskWith({ 'a.md': 'one two three' }, ['a.md'])
    const pane = panes['a.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'one' }, replace: 'ONE' }])
    pane.type(pane.text.length, ' four')
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'three' }, replace: 'THREE' }])
    pane.type(0, '> ')
    expect(pane.text).toBe('> ONE two THREE four')

    const [first] = idsOf(agent, 'a.md')
    const note = located(desk, { path: 'a.md' })
    const went = await undoSomeAt(desk, agent, note, new Set([first ?? '']))

    expect(went).toEqual([first])
    expect(pane.text).toBe('> one two THREE four')
    expect(idsOf(agent, 'a.md')).toHaveLength(1)

    // The rest is still the agent's to take back, the reader's words staying.
    await undoAgent(desk, agent, { path: 'a.md' })
    expect(pane.text).toBe('> one two three four')
  })

  test('takes a later edit that rewrote its words with it', async () => {
    const { desk, panes } = deskWith({ 'a.md': 'alpha' }, ['a.md'])
    const pane = panes['a.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'a.md' }, [
      { at: { quote: 'alpha' }, replace: 'beta gamma' },
    ])
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'gamma' }, replace: 'delta' }])
    expect(pane.text).toBe('beta delta')

    const [first, second] = idsOf(agent, 'a.md')
    const went = await undoSomeAt(
      desk,
      agent,
      located(desk, { path: 'a.md' }),
      new Set([first ?? '']),
    )
    expect(went).toEqual([first, second])
    expect(pane.text).toBe('alpha')
  })

  test('is one Ctrl+Z, which puts it back', async () => {
    const { desk, panes } = deskWith({ 'a.md': 'one two' }, ['a.md'])
    const pane = panes['a.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()

    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'one' }, replace: 'ONE' }])
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'two' }, replace: 'TWO' }])
    const [first] = idsOf(agent, 'a.md')
    await undoSomeAt(desk, agent, located(desk, { path: 'a.md' }), new Set([first ?? '']))
    expect(pane.text).toBe('one TWO')

    pane.undo()
    expect(pane.text).toBe('ONE TWO')
    expect(idsOf(agent, 'a.md')).toHaveLength(2)
  })

  test('in a closed note, through what was written there since', async () => {
    const { desk, panes, close, fileOf, disk } = deskWith({ 'a.md': 'one two' }, ['a.md'])
    const agent = anAgent()
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'one' }, replace: 'ONE' }])
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'two' }, replace: 'TWO' }])
    expect(panes['a.md']?.text).toBe('ONE TWO')
    close('a.md')
    disk.set('/space/a.md', 'ONE TWO three')

    const [, second] = idsOf(agent, 'a.md')
    await undoSomeAt(desk, agent, located(desk, { path: 'a.md' }), new Set([second ?? '']))
    expect(fileOf('a.md')).toBe('ONE two three')
  })

  test('comes back with a Redo, through what was typed since', async () => {
    const { desk, panes } = deskWith({ 'a.md': 'one two' }, ['a.md'])
    const pane = panes['a.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'two' }, replace: 'TWO' }])

    const note = located(desk, { path: 'a.md' })
    await undoSomeAt(desk, agent, note, new Set(idsOf(agent, 'a.md')), 'rewind-1')
    expect(pane.text).toBe('one two')
    pane.type(0, 'zero ')

    const back = await putBackAt(desk, agent, note, 'rewind-1')
    expect(back).toHaveLength(1)
    expect(pane.text).toBe('zero one TWO')
    // Spent: a second Redo has nothing to put back.
    expect(await putBackAt(desk, agent, note, 'rewind-1')).toEqual([])
  })
})

describe('where an agent’s edits are', () => {
  test('is carried through the reader’s typing, and forgotten once taken back', async () => {
    const { desk, panes } = deskWith({ 'a.md': 'one two' }, ['a.md'])
    const pane = panes['a.md']
    if (!pane) throw new Error('open')
    const agent = anAgent()
    await editNote(desk, agent, { path: 'a.md' }, [{ at: { quote: 'two' }, replace: 'TWO' }])

    const track = tracksOf(agent.id).get('/space/a.md')
    const [id] = track?.ids ?? []
    expect(track?.spansOf(id ?? '')).toEqual([{ from: 4, to: 7, removed: 'two', inserted: 'TWO' }])

    pane.type(0, 'ah ')
    expect(track?.spansOf(id ?? '')).toEqual([{ from: 7, to: 10, removed: 'two', inserted: 'TWO' }])

    await undoAgent(desk, agent, { path: 'a.md' })
    expect(track?.spansOf(id ?? '')).toEqual([])
  })
})
