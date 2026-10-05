import { describe, expect, test } from 'vitest'
import type { Part } from '../chat/types'
import { blocksOf, foldOf } from './steps'

const read = (id: string, path: string): Part => ({
  kind: 'tool',
  id,
  verb: 'read_note',
  args: { path },
  state: 'ok',
})
const edit: Part = {
  kind: 'tool',
  id: 'e',
  verb: 'edit_note',
  args: { path: 'Herons.md' },
  state: 'ok',
  change: { path: 'Herons.md', added: 2, removed: 1 },
}
const thought: Part = { kind: 'thinking', text: 'Looking', ms: 1200 }
const words = (text: string): Part => ({ kind: 'text', text })

describe('an answer laid out as Codex lays one out', () => {
  test('words that arrived in pieces are one block', () => {
    expect(blocksOf([words('A heron '), words('waits.')])).toEqual([
      { kind: 'words', text: 'A heron waits.', at: 0 },
    ])
  })

  test('reads that follow one another are one Explored step, and one read stays a row', () => {
    const blocks = blocksOf([thought, read('a', 'Herons.md'), read('b', 'Kestrels.md'), edit])
    expect(blocks.map((one) => one.kind)).toEqual(['row', 'explored', 'row'])
    expect(blocks[1]).toMatchObject({ kind: 'explored', at: 1 })
    expect(blocks[1]?.kind === 'explored' && blocks[1].rows.map((one) => one.id)).toEqual([
      'a',
      'b',
    ])
    expect(blocksOf([read('a', 'Herons.md'), edit]).map((one) => one.kind)).toEqual(['row', 'row'])
  })

  test('a read that asks the reader keeps its own row, where its question is', () => {
    const asking: Part = { kind: 'tool', id: 'b', verb: 'read_note', args: {}, state: 'asking' }
    expect(blocksOf([read('a', 'A.md'), asking]).map((one) => one.kind)).toEqual(['row', 'row'])
  })

  test('once done, the steps before the last words fold, and the words stay out', () => {
    const blocks = blocksOf([
      { kind: 'notice', code: 'model', text: 'Fake Large' },
      thought,
      words('Looking at the note.'),
      edit,
      words('Done: two verbs.'),
      { kind: 'notice', code: 'stopped', text: '' },
    ])
    const { before, work, after } = foldOf(blocks, false)
    expect(before.map((one) => one.kind)).toEqual(['notice'])
    expect(work.map((one) => one.kind)).toEqual(['row', 'words', 'row'])
    expect(after.map((one) => one.kind)).toEqual(['words', 'notice'])
  })

  test('nothing folds while it runs, without a call, or with no words after the steps', () => {
    const steps = blocksOf([thought, edit, words('Done.')])
    expect(foldOf(steps, true).work).toEqual([])
    expect(foldOf(blocksOf([words('Just words.')]), false).work).toEqual([])
    expect(foldOf(blocksOf([thought, words('Thought, then said.')]), false).work).toEqual([])
    expect(foldOf(blocksOf([words('First.'), edit]), false).work).toEqual([])
  })
})
