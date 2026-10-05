import { describe, expect, test } from 'vitest'
import type { Turn } from '../chat/types'
import { answered, byNote, changesOf, changesSince, type Edit, linesOf } from './changes'
import { forkAt, cutForEdit, switchBranch, type Branched } from './branches'
import { fileChangesOf, verbOf } from './files'
import { planFor } from './plan'

function you(id: string, at: number, steered = false): Turn {
  return {
    id,
    role: 'you',
    at,
    parts: [],
    draft: { text: id, attachments: [] },
    ...(steered ? { steered } : {}),
  }
}

function model(id: string, at: number, parts: Turn['parts'] = []): Turn {
  return { id, role: 'model', at, parts, provider: 'p' }
}

function edit(id: string, at: number, path = '/s/a.md', agent = 'nib-p'): Edit {
  return { id, agent, path, at, spots: [{ from: 0, to: 3, removed: 'old', inserted: 'new' }] }
}

const thread = {
  id: 't1',
  provider: 'p',
  turns: [you('m1', 10), model('a1', 11), you('m2', 20), you('s', 25, true), model('a2', 21)],
}

/** Thread t1 answered for provider p from 10 to 30; t2 from 40 on. */
const answering = (provider: string, at: number) =>
  provider === 'p' ? (at >= 10 && at <= 30 ? 't1' : at >= 40 ? 't2' : null) : null

describe('a thread’s changes', () => {
  test('are the edits its provider’s agent made while it was answering', () => {
    const edits = [
      edit('e1', 12),
      edit('e2', 22),
      edit('e3', 45),
      edit('x', 12, '/s/a.md', 'claude-code'),
    ]
    const changes = changesOf(thread, edits, answering, new Set())
    expect(changes.map((one) => one.id)).toEqual(['e1', 'e2'])
  })

  test('take in the helpers it started', () => {
    const edits = [edit('e1', 12), edit('e3', 45)]
    const changes = changesOf({ ...thread, helpers: ['t2'] }, edits, answering, new Set())
    expect(changes.map((one) => one.id)).toEqual(['e1', 'e3'])
  })

  test('each answers the latest message before it, never a steered one', () => {
    expect(answered(thread.turns, 12)).toBe('m1')
    expect(answered(thread.turns, 26)).toBe('m2')
    expect(answered(thread.turns, 5)).toBeNull()
  })

  test('leave out what the reader kept, and count lines as a diff does', () => {
    const changes = changesOf(thread, [edit('e1', 12), edit('e2', 22)], answering, new Set(['e1']))
    expect(changes.map((one) => one.id)).toEqual(['e2'])
    expect(changes[0]).toMatchObject({ added: 1, removed: 1, turn: 'm2' })
    expect(linesOf('a\nb\n')).toBe(2)
    expect(linesOf('')).toBe(0)
  })

  test('group by note, in the order each was first changed', () => {
    const changes = changesOf(
      thread,
      [edit('e1', 12, '/s/b.md'), edit('e2', 13, '/s/a.md'), edit('e3', 14, '/s/b.md')],
      answering,
      new Set(),
    )
    const notes = byNote(changes)
    expect(notes.map((one) => [one.path, one.changes.length, one.added])).toEqual([
      ['/s/b.md', 2, 2],
      ['/s/a.md', 1, 1],
    ])
  })

  test('since a checkpoint are those answering it and every later message', () => {
    const changes = changesOf(thread, [edit('e1', 12), edit('e2', 22)], answering, new Set())
    expect(changesSince(changes, thread.turns, 'm2').map((one) => one.id)).toEqual(['e2'])
    expect(changesSince(changes, thread.turns, 'm1').map((one) => one.id)).toEqual(['e1', 'e2'])
    expect(changesSince(changes, thread.turns, 's')).toEqual([])
  })
})

describe('the rewind plan', () => {
  const tool = (verb: string, args: unknown, text = ''): Turn['parts'][number] => ({
    kind: 'tool',
    id: verb,
    verb,
    args,
    state: 'ok',
    result: { text, images: [], error: false },
  })

  test('offers the notes rows only where something changed since', () => {
    const plain = { turns: [you('m1', 10), model('a1', 11)] }
    expect(planFor(plain, 'm1', [])?.choices).toEqual(['conversation', 'summarize-from'])

    const changes = changesOf(thread, [edit('e2', 22)], answering, new Set())
    expect(planFor(thread, 'm2', changes)?.choices).toEqual([
      'both',
      'conversation',
      'notes',
      'summarize-from',
      'summarize-to',
    ])
    expect(planFor(thread, 's', changes)).toBeNull()
  })

  test('sends a note made since to Recently deleted, and says what stays', () => {
    const turns = [
      you('m1', 10),
      model('a1', 11, [
        tool(
          'mcp__nib__create_note',
          { path: 'Plan', space: 'Work' },
          '{"path":"Plan.md","created":true}',
        ),
        tool('read_note', { path: 'x' }),
        tool('edit_note', { path: 'x' }),
      ]),
    ]
    const plan = planFor({ turns }, 'm1', [])
    expect(plan?.made).toEqual([{ path: 'Plan.md', space: 'Work' }])
    expect(plan?.lasting).toBe(false)
    expect(plan?.choices[0]).toBe('both')

    const clicked = [you('m1', 10), model('a1', 11, [tool('browser_click', { ref: 'e1' })])]
    expect(planFor({ turns: clicked }, 'm1', [])?.lasting).toBe(true)
    expect(verbOf('mcp__nib__edit_note')).toBe('edit_note')
  })

  test('takes a note moved or deleted since back, rather than calling it lasting', () => {
    const turns = [
      you('m1', 10),
      model('a1', 11, [
        tool(
          'mcp__nib__move_file',
          { path: 'Plan', to: 'Old/Plan' },
          '{"from":"Plan.md","to":"Old/Plan.md"}',
        ),
        tool(
          'trash_file',
          { path: 'Herons', space: 'Work' },
          '{"path":"Herons.md","trashed":true}',
        ),
        // A move to where it already was moved nothing.
        tool('move_file', { path: 'A', to: 'A' }, '{"from":"A.md","to":"A.md"}'),
      ]),
    ]
    const plan = planFor({ turns }, 'm1', [])
    expect(plan?.lasting).toBe(false)
    expect(plan?.choices[0]).toBe('both')
    expect(plan?.files).toEqual([
      { id: 'mcp__nib__move_file', kind: 'moved', from: 'Plan.md', path: 'Old/Plan.md' },
      { id: 'trash_file', kind: 'trashed', path: 'Herons.md', space: 'Work' },
    ])
    expect(fileChangesOf(turns, new Set(['trash_file']))).toHaveLength(1)
    expect(
      planFor({ turns }, 'm1', [], new Set(['mcp__nib__move_file', 'trash_file']))?.files,
    ).toEqual([])
  })
})

describe('an edited message', () => {
  test('keeps what followed as a branch the arrows walk', () => {
    const branched: Branched = {
      ...thread,
      space: 's',
      title: '',
      model: 'm',
      effort: 'auto',
      mode: 'agent',
      usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
      created: 0,
      updated: 0,
      turns: [you('m1', 10), model('a1', 11), you('m2', 20), model('a2', 21)],
    }
    const cut = cutForEdit(branched, 'm2')
    expect(cut?.map((one) => one.id)).toEqual(['m2', 'a2'])
    branched.turns.push(you('m2b', 30), model('a2b', 31))
    expect(forkAt(branched, 'm2b')).toEqual({ count: 2, at: 1 })

    expect(switchBranch(branched, 'm2b', -1)).toBe(true)
    expect(branched.turns.map((one) => one.id)).toEqual(['m1', 'a1', 'm2', 'a2'])
    expect(forkAt(branched, 'm2')).toEqual({ count: 2, at: 0 })
    expect(switchBranch(branched, 'm2', -1)).toBe(false)

    expect(switchBranch(branched, 'm2', 1)).toBe(true)
    expect(branched.turns.map((one) => one.id)).toEqual(['m1', 'a1', 'm2b', 'a2b'])
    expect(forkAt(branched, 'm1')).toBeNull()
  })
})
