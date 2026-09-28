import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { type BlockEdit, copyBlock, cutBlock, moveBlock } from './move'
import { blockAt, blocksIn, type BlockSpan } from './span'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const NOTE = [
  '# One',
  '',
  'First words.',
  '',
  '- item one',
  '  - nested',
  '- item two',
  '',
  '> A quote',
  '> goes on',
  '',
  '```js',
  'code()',
  '```',
  '',
  '# Two',
  '',
  'Second.',
  '',
].join('\n')

function state(doc = NOTE): EditorState {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
}

/** A block as what it is and what it says, which is what a test can read. */
function said(one: EditorState, span: BlockSpan | null): [string, string] | null {
  return span ? [span.kind, one.doc.sliceString(span.from, span.to)] : null
}

function after(one: EditorState, edit: BlockEdit | null): string {
  if (!edit) throw new Error('nothing to apply')
  return one.update({ changes: edit.changes }).state.doc.toString()
}

describe('the blocks a note is made of', () => {
  test('one to a line, outside in', () => {
    const one = state()
    expect(blocksIn(one, 0, one.doc.length).map((span) => span.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'list',
      'quote',
      'code',
      'heading',
      'paragraph',
    ])
  })

  test('a heading is its whole section, the way folding means it', () => {
    const one = state()
    const [heading] = blocksIn(one, 0, 1)
    expect(heading?.kind).toBe('heading')
    expect(one.doc.sliceString(heading?.from ?? 0, heading?.to ?? 0)).toContain('code()')
    expect(one.doc.sliceString(heading?.from ?? 0, heading?.to ?? 0)).not.toContain('# Two')
  })

  test('the block a position is in', () => {
    const one = state()
    const at = (needle: string, into = 2) => said(one, blockAt(one, NOTE.indexOf(needle) + into))

    expect(at('First words')).toEqual(['paragraph', 'First words.'])
    // A nested item answers for itself rather than for the item it sits in.
    expect(at('nested')).toEqual(['list', '  - nested'])
    expect(at('item one')).toEqual(['list', '- item one\n  - nested'])
    expect(at('code()')).toEqual(['code', '```js\ncode()\n```'])
    expect(at('goes on')).toEqual(['quote', '> A quote\n> goes on'])
  })

  test('nothing at all in an empty note', () => {
    expect(blockAt(state(''), 0)).toBeNull()
  })
})

describe('moving a block', () => {
  test('a paragraph keeps the blank line that made it one', () => {
    const one = state()
    const paragraph = blockAt(one, NOTE.indexOf('First words') + 2)!
    const target = blockAt(one, NOTE.indexOf('Second.') + 2)!

    const moved = after(one, moveBlock(one, paragraph, target.from))
    expect(moved).toContain('First words.\n\nSecond.')
    expect(moved.indexOf('First words.')).toBeGreaterThan(moved.indexOf('> A quote'))
  })

  test('a list item stays in the list it moves inside', () => {
    const one = state()
    const second = blockAt(one, NOTE.indexOf('item two') + 2)!
    const first = blockAt(one, NOTE.indexOf('item one') + 2)!

    expect(after(one, moveBlock(one, second, first.from))).toContain(
      '- item two\n- item one\n  - nested\n',
    )
  })

  test('a block is not dropped inside itself', () => {
    const one = state()
    const quote = blockAt(one, NOTE.indexOf('A quote') + 2)!

    expect(moveBlock(one, quote, quote.from)).toBeNull()
    expect(moveBlock(one, quote, quote.to)).toBeNull()
  })

  test('the last block of a note takes its blank line with it', () => {
    const one = state('a\n\nb')
    const last = blockAt(one, 3)!
    expect(after(one, moveBlock(one, last, 0))).toBe('b\n\na')
  })

  test('a block dropped at the end lands after everything', () => {
    const one = state('a\n\nb')
    const first = blockAt(one, 0)!
    expect(after(one, moveBlock(one, first, one.doc.length))).toBe('b\n\na')
  })

  test('the caret goes with the words it was in', () => {
    const one = state()
    const paragraph = blockAt(one, NOTE.indexOf('First words') + 2)!
    const caret = NOTE.indexOf('First words') + 6
    const moved = moveBlock(one, paragraph, one.doc.length, caret)!

    expect(moved.caret).not.toBeNull()
    const at = moved.caret ?? 0
    const next = one.update({ changes: moved.changes }).state
    expect(next.doc.sliceString(at, at + 5)).toBe('words')
  })
})

describe('copying and cutting a block', () => {
  test('a copy lands right under the original', () => {
    const one = state()
    const quote = blockAt(one, NOTE.indexOf('A quote') + 2)!
    const copied = copyBlock(one, quote)

    expect(after(one, copied)).toContain('> A quote\n> goes on\n\n> A quote\n> goes on\n')
    // The caret goes into the copy, which is what a copy is made for.
    const next = one.update({ changes: copied.changes }).state
    expect(next.doc.lineAt(copied.caret ?? 0).text).toBe('> A quote')
  })

  test('a block taken out takes its blank line with it', () => {
    const one = state()
    const paragraph = blockAt(one, NOTE.indexOf('First words') + 2)!

    expect(after(one, cutBlock(one, paragraph))).toBe(NOTE.replace('First words.\n\n', ''))
  })
})
