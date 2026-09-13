import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import {
  blockTargets,
  deleteBlocks,
  duplicateBlocks,
  indentBlocks,
  moveBlocks,
  outdentBlocks,
  turnBlocksInto,
} from './commands'
import { shaped, wordsOf } from './shape'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

/** What a selection across several blocks can be told to do.
 *
 *  Emil asked for bulk actions, and what the menu had was two: duplicate and
 *  delete. Everything a reader would want to do to one block they want to do to
 *  four - turn them into a list, indent them, move them, link to them - and a menu
 *  that stopped at two was a menu saying a selection across blocks is a lesser kind
 *  of selection.
 *
 *  No DOM here: every one of these reads the document and dispatches, which is all
 *  of a view they touch. */

const NOTE = [
  'First words.',
  '',
  'Second words.',
  '',
  'Third words.',
  '',
  '```js',
  'code()',
  '```',
  '',
  'Last words.',
  '',
].join('\n')

/** A view that is a state and somewhere to put a transaction. `focus` is called by
 *  every one of these and does nothing anywhere without a screen. */
function viewOf(doc: string, from: number, to = from) {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )

  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => undefined,
  } as unknown as EditorView

  return { view, said: () => view.state.doc.toString() }
}

/** A view whose selection lies across the first three paragraphs, and the position
 *  the press landed at - inside that selection, which is what makes the rest of
 *  them act on all three. */
function overThree(doc = NOTE) {
  const from = doc.indexOf('First')
  const to = doc.indexOf('Third words.') + 'Third words.'.length
  return { ...viewOf(doc, from, to), at: doc.indexOf('Second') }
}

describe('a line as the words in it', () => {
  test('has whatever markdown put in front of them taken off', () => {
    expect(wordsOf('# A heading').words).toBe('A heading')
    expect(wordsOf('- an item').words).toBe('an item')
    expect(wordsOf('3) numbered').words).toBe('numbered')
    expect(wordsOf('- [x] done').words).toBe('done')
    expect(wordsOf('> quoted').words).toBe('quoted')
    expect(wordsOf('> - [ ] a quoted task').words).toBe('a quoted task')
  })

  test('and keeps the indentation they sat behind', () => {
    expect(wordsOf('    - nested').indent).toBe('    ')
    expect(wordsOf('plain').indent).toBe('')
  })

  test('so one shape becomes another without reading what it was', () => {
    expect(shaped('# A heading', 'bullet')).toBe('- A heading')
    expect(shaped('  - [ ] a task', 'quote')).toBe('  > a task')
    expect(shaped('> quoted', 'heading2')).toBe('## quoted')
    expect(shaped('- an item', 'paragraph')).toBe('an item')
    expect(shaped('an item', 'numbered', 4)).toBe('4. an item')
  })

  test('and a line with no words in it is left exactly as it was', () => {
    expect(shaped('', 'bullet')).toBe('')
    expect(shaped('   ', 'bullet')).toBe('   ')
  })
})

describe('turning several blocks into something else', () => {
  test('makes every one of them a bullet', () => {
    const { view, said, at } = overThree()
    expect(turnBlocksInto(view, at, 'bullet')).toBe(true)

    expect(said()).toContain('- First words.\n\n- Second words.\n\n- Third words.')
    expect(said()).toContain('Last words.')
  })

  test('numbers them from one, across the whole run', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'numbered')

    expect(said().startsWith('1. First words.\n\n2. Second words.\n\n3. Third words.')).toBe(true)
  })

  test('gives each of them a box', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'task')

    expect(said()).toContain('- [ ] First words.')
    expect(said()).toContain('- [ ] Third words.')
  })

  test('quotes them', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'quote')

    expect(said()).toContain('> First words.')
  })

  test('and turns them back into plain words again', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'bullet')
    turnBlocksInto(view, at, 'paragraph')

    expect(said().startsWith('First words.\n\nSecond words.\n\nThird words.')).toBe(true)
  })

  /** Sets rather than toggles: asking for bullets twice leaves bullets, where the
   *  key the keyboard has would have taken them off again. */
  test('asked for twice, leaves them as they are', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'bullet')
    const once = said()
    turnBlocksInto(view, at, 'bullet')

    expect(said()).toBe(once)
  })

  test('puts the hashes on a heading at the level asked for', () => {
    const { view, said, at } = overThree()
    turnBlocksInto(view, at, 'heading3')

    expect(said()).toContain('### First words.')
    expect(said()).toContain('### Third words.')
  })

  /** A heading is one line in markdown, so the rest of a block that becomes one is
   *  the words under it. */
  test('and a block of several lines keeps its first line as the heading', () => {
    const doc = 'One line\nand another\n'
    const { view, said } = viewOf(doc, 0, doc.length - 1)
    turnBlocksInto(view, 2, 'heading1')

    expect(said()).toBe('# One line\nand another\n')
  })

  test('leaves a code block alone, and the prose either side of it alone too', () => {
    const doc = NOTE
    const { view, said } = viewOf(doc, 0, doc.length)
    turnBlocksInto(view, doc.indexOf('Second'), 'bullet')

    expect(said()).toContain('```js\ncode()\n```')
    expect(said()).toContain('- First words.')
    expect(said()).toContain('- Last words.')
  })
})

describe('indenting several blocks', () => {
  test('takes every one of them a step in, and a step back out', () => {
    const { view, said, at } = overThree()
    expect(indentBlocks(view, at)).toBe(true)

    const indented = said()
    expect(indented).toMatch(/^ +First words\./)
    expect(indented).toMatch(/\n +Third words\./)

    expect(outdentBlocks(view, at)).toBe(true)
    expect(said().startsWith('First words.')).toBe(true)
  })
})

describe('moving several blocks', () => {
  test('steps the whole run over the block below it, in one piece', () => {
    const doc = 'a\n\nb\n\nc\n\nd\n'
    const { view, said } = viewOf(doc, doc.indexOf('a'), doc.indexOf('b') + 1)

    expect(moveBlocks(view, doc.indexOf('a'), 1)).toBe(true)
    expect(said()).toBe('c\n\na\n\nb\n\nd\n')
  })

  test('and over the block above it', () => {
    const doc = 'a\n\nb\n\nc\n\nd\n\ne\n'
    const { view, said } = viewOf(doc, doc.indexOf('c'), doc.indexOf('d') + 1)

    expect(moveBlocks(view, doc.indexOf('c'), -1)).toBe(true)
    expect(said()).toBe('a\n\nc\n\nd\n\nb\n\ne\n')
  })

  test('and does nothing at all at the end it is already at', () => {
    const doc = 'a\n\nb\n'
    const { view, said } = viewOf(doc, 0, doc.indexOf('b') + 1)

    expect(moveBlocks(view, 0, -1)).toBe(false)
    expect(said()).toBe(doc)
  })
})

describe('a link to several blocks', () => {
  test('is one target each, in document order, every block gaining a name', () => {
    const { view, said, at } = overThree()
    const targets = blockTargets(view, at)

    expect(targets.length).toBe(3)
    for (const target of targets) expect(target).toMatch(/^#\^[a-z0-9]+$/)
    // Each name is written into the note, at the end of its own block.
    for (const target of targets) expect(said()).toContain(` ${target.slice(1)}`)
    // Three different names, and the note still says what it said.
    expect(new Set(targets).size).toBe(3)
    expect(said()).toContain('First words. ')
    expect(said()).toContain('Third words. ')
  })

  test('names a heading by its words rather than writing one in', () => {
    const doc = '# One\n\nwords\n'
    const { view, said } = viewOf(doc, 0, 0)

    expect(blockTargets(view, 0)).toEqual(['#One'])
    expect(said()).toBe(doc)
  })
})

describe('the two that were already there', () => {
  test('still duplicate and still delete every block the selection covers', () => {
    const duplicated = overThree()
    expect(duplicateBlocks(duplicated.view, duplicated.at)).toBe(true)
    expect(duplicated.said().match(/Second words\./g)?.length).toBe(2)

    const deleted = overThree()
    expect(deleteBlocks(deleted.view, deleted.at)).toBe(true)
    expect(deleted.said()).not.toContain('Second words.')
    expect(deleted.said()).toContain('Last words.')
  })
})
