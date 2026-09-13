import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  calloutSign,
  clearFormatting,
  closeFence,
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertLink,
  insertMathBlock,
  insertTable,
  insertToc,
  setCalloutSign,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleTask,
  toggleTaskList,
  toggleWrap,
} from './commands'
import { selectWord } from './keymap'
import { parsed } from '../test/parsed'

/** One command over one document, and everything a test might ask about the
 *  result: whether it took the keystroke, what the note became, and where the
 *  caret ended up.
 *
 *  Takes the selection as offsets, because a task list and a footnote are written
 *  with the very brackets the markers below use. */
function apply(
  command: StateCommand,
  doc: string,
  from: number,
  to = from,
): { took: boolean; doc: string; selection: [number, number] } {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )

  let next = state
  const took = command({
    state,
    dispatch: (transaction: Transaction) => (next = transaction.state),
  })

  return {
    took,
    doc: next.doc.toString(),
    selection: [next.selection.main.from, next.selection.main.to],
  }
}

/** A document with the selection written into it: `|` is the caret, `[` and `]`
 *  are the ends of a selection. */
function marks(marked: string): { doc: string; from: number; to: number } {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[[\]|]/g, '')

  if (caret >= 0) return { doc, from: caret, to: caret }
  return { doc, from: marked.indexOf('['), to: marked.indexOf(']') - 1 }
}

/** Runs a command against a marked document and returns the resulting text. */
function run(command: StateCommand, marked: string): string {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).doc
}

/** A state with the caret at an offset, for the two things here that read a state
 *  rather than command one. */
function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )
}

/** A command over a document with the caret at an offset. The marked-document
 *  helpers above cannot be used on a callout: they strip the very brackets a callout
 *  is written with. */
function at(command: StateCommand, doc: string, offset: number): string {
  return apply(command, doc, offset).doc
}

/** Whether the command took the keystroke at all, which is how one that gives way
 *  can share a key with another. */
function took(command: StateCommand, marked: string): boolean {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).took
}

/** Same, but reports the selection so caret placement can be checked. */
function runSelection(command: StateCommand, marked: string): [number, number] {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).selection
}

describe('inline wrapping', () => {
  const strong = toggleWrap('**')

  test('wraps a selection', () => {
    expect(run(strong, 'a [word] b')).toBe('a **word** b')
  })

  test('unwraps when the markers are outside the selection', () => {
    expect(run(strong, 'a **[word]** b')).toBe('a word b')
  })

  test('unwraps when the markers are inside the selection', () => {
    expect(run(strong, 'a [**word**] b')).toBe('a word b')
  })

  test('inserts empty markers at a caret', () => {
    expect(run(strong, 'a |b')).toBe('a ****b')
  })

  test('handles asymmetric markers', () => {
    expect(run(toggleWrap('<u>', '</u>'), '[x]')).toBe('<u>x</u>')
  })
})

describe('headings', () => {
  test('applies a level', () => {
    expect(run(setHeading(2), '|Title')).toBe('## Title')
  })

  test('replaces an existing level', () => {
    expect(run(setHeading(3), '# |Title')).toBe('### Title')
  })

  test('level zero returns to a paragraph', () => {
    expect(run(setHeading(0), '### |Title')).toBe('Title')
  })

  test('raises and lowers the level', () => {
    expect(run(shiftHeading(1), '## |Title')).toBe('### Title')
    expect(run(shiftHeading(-1), '## |Title')).toBe('# Title')
  })

  test('never goes past the ends of the scale', () => {
    expect(run(shiftHeading(1), '###### |Title')).toBe('###### Title')
    expect(run(shiftHeading(-1), '|Title')).toBe('Title')
  })
})

describe('line prefixes', () => {
  test('quotes and unquotes', () => {
    expect(run(toggleQuote, '|text')).toBe('> text')
    expect(run(toggleQuote, '> |text')).toBe('text')
  })

  test('toggles a bullet list', () => {
    expect(run(toggleBulletList, '|item')).toBe('- item')
    expect(run(toggleBulletList, '- |item')).toBe('item')
  })

  test('numbers an ordered list across lines', () => {
    expect(run(toggleOrderedList, '[one\ntwo\nthree]')).toBe('1. one\n2. two\n3. three')
  })

  test('converts a bullet list to an ordered one', () => {
    expect(run(toggleOrderedList, '[- one\n- two]')).toBe('1. - one\n2. - two')
  })
})

describe('blocks', () => {
  test('inserts a code fence with the caret inside', () => {
    expect(run(insertCodeFence, '|')).toBe('```\n\n```')
    expect(runSelection(insertCodeFence, '|')).toEqual([3, 3])
  })

  test('inserts a math block', () => {
    expect(run(insertMathBlock, '|')).toBe('$$\n\n$$')
  })

  test('inserts a table with a header and divider', () => {
    expect(run(insertTable(1, 2), '|')).toBe(
      '| Column 1 | Column 2 |\n| --- | --- |\n|     |     |',
    )
  })

  test('starts a block on its own line', () => {
    expect(run(insertCodeFence, 'text|')).toBe('text\n```\n\n```')
  })
})

describe('links', () => {
  test('wraps the selection and parks the caret in the target', () => {
    expect(run(insertLink, '[label]')).toBe('[label]()')
  })

  test('leaves the caret between the parentheses', () => {
    const [from] = runSelection(insertLink, 'x|')
    expect(from).toBe('x[]('.length)
  })
})

describe('clear formatting', () => {
  test('removes inline markers from the selection', () => {
    expect(run(clearFormatting, '[**a** *b* ~~c~~ ==d== `e`]')).toBe('a b c d e')
  })

  test('leaves text outside the selection alone', () => {
    expect(run(clearFormatting, '**keep** [**drop**]')).toBe('**keep** drop')
  })
})

describe('select word', () => {
  test('grows the selection to the word under the caret', () => {
    expect(runSelection(selectWord, 'one tw|o three')).toEqual([4, 7])
  })

  test('collapses on punctuation', () => {
    expect(runSelection(selectWord, 'one |- two')).toEqual([4, 4])
  })
})

describe('pressing Enter after a code fence', () => {
  /** Whether the command took the key, and what the document became. */
  function press(marked: string): { took: boolean; doc: string } {
    const caret = marked.indexOf('|')
    const doc = marked.replace(/\|/g, '')
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(caret),
        extensions: [markdown({ base: markdownLanguage })],
      }),
    )

    let next = state
    const took = closeFence({
      state,
      dispatch: (transaction: Transaction) => (next = transaction.state),
    })
    return { took, doc: next.doc.toString() }
  }

  test('closes the fence and puts the caret inside it', () => {
    expect(press('```|')).toEqual({ took: true, doc: '```\n\n```' })
    expect(runSelection(closeFence, '```|')).toEqual([4, 4])
  })

  test('keeps the language', () => {
    expect(press('```ts|').doc).toBe('```ts\n\n```')
  })

  test('keeps what follows outside the block', () => {
    expect(press('```|\nmore text').doc).toBe('```\n\n```\nmore text')
  })

  test('closes tildes with tildes, and as many of them', () => {
    expect(press('~~~~|').doc).toBe('~~~~\n\n~~~~')
  })

  test('leaves a fence that is already closed alone', () => {
    expect(press('```|\ncode\n```').took).toBe(false)
  })

  test('leaves a closing fence alone', () => {
    expect(press('```\ncode\n```|').took).toBe(false)
  })

  test('does nothing away from the end of the line', () => {
    expect(press('``|`').took).toBe(false)
  })

  test('does nothing on an ordinary line', () => {
    expect(press('just words|').took).toBe(false)
  })
})

describe('a task list', () => {
  test('makes plain lines into tasks', () => {
    expect(run(toggleTaskList, '[one\ntwo]')).toBe('- [ ] one\n- [ ] two')
  })

  test('trades a bullet for a box and keeps the indentation', () => {
    expect(run(toggleTaskList, '  - |one')).toBe('  - [ ] one')
  })

  test('trades a number for a box', () => {
    expect(run(toggleTaskList, '1. |one')).toBe('- [ ] one')
  })

  test('takes the tasks off again when every line is one', () => {
    const doc = '- [ ] one\n- [x] two'
    expect(apply(toggleTaskList, doc, 0, doc.length).doc).toBe('one\ntwo')
  })

  test('makes tasks of every line when only some of them are', () => {
    const doc = '- [x] one\ntwo'
    expect(apply(toggleTaskList, doc, 0, doc.length).doc).toBe('- [ ] one\n- [ ] two')
  })
})

describe('ticking the task under the caret', () => {
  test('ticks an empty box', () => {
    expect(apply(toggleTask, '- [ ] wash up', 10).doc).toBe('- [x] wash up')
  })

  test('clears a ticked one', () => {
    expect(apply(toggleTask, '- [x] wash up', 10).doc).toBe('- [ ] wash up')
  })

  test('ticks every task in the selection', () => {
    const doc = '- [ ] one\n- [ ] two'
    expect(apply(toggleTask, doc, 0, doc.length).doc).toBe('- [x] one\n- [x] two')
  })

  /** Which is what lets it share Ctrl+Enter with running a code fence. */
  test('gives way on a line that is not a task', () => {
    expect(took(toggleTask, 'just words|')).toBe(false)
    expect(took(toggleTask, '- a bullet|')).toBe(false)
  })
})

describe('the blocks a menu row inserts', () => {
  test('a callout is the alert the renderer draws, ready to be written in', () => {
    expect(run(insertCallout, '|')).toBe('> [!NOTE]\n> ')
    expect(runSelection(insertCallout, '|')).toEqual([12, 12])
  })

  test('a table of contents is a line of its own', () => {
    expect(run(insertToc, 'words\n|')).toBe('words\n[toc]\n')
  })

  test('front matter goes to the very top, whatever the caret was doing', () => {
    expect(run(insertFrontMatter, '# Head\n\nwords|')).toBe('---\ntitle: \n---\n\n# Head\n\nwords')
    expect(runSelection(insertFrontMatter, 'words|')).toEqual([11, 11])
  })

  test('front matter that is there already gets the caret rather than a second block', () => {
    const note = '---\ntitle: Hi\n---\n\nwords|'
    expect(run(insertFrontMatter, note)).toBe('---\ntitle: Hi\n---\n\nwords')
    expect(runSelection(insertFrontMatter, note)).toEqual([13, 13])
  })

  test('a comment wraps what is selected, and unwraps it again', () => {
    expect(run(insertComment, 'a [word] b')).toBe('a <!-- word --> b')
    expect(run(insertComment, 'a [<!-- word -->] b')).toBe('a word b')
  })

  test('a comment with nothing selected leaves the caret inside it', () => {
    expect(run(insertComment, 'a |b')).toBe('a <!--  -->b')
    expect(runSelection(insertComment, 'a |b')).toEqual([7, 7])
  })
})

describe('a footnote', () => {
  test('marks the caret and puts its definition at the end of the note', () => {
    expect(run(insertFootnote, 'a claim|\n')).toBe('a claim[^1]\n\n[^1]: ')
  })

  test('leaves the caret in the definition, ready to write it', () => {
    expect(runSelection(insertFootnote, 'a claim|\n')).toEqual([19, 19])
  })

  test('takes the next number the note is not already using', () => {
    expect(apply(insertFootnote, 'one[^1] two\n\n[^1]: first\n', 11).doc).toBe(
      'one[^1] two[^2]\n\n[^1]: first\n\n[^2]: ',
    )
  })

  test('in an empty note is a mark and the definition under it', () => {
    expect(apply(insertFootnote, '', 0).doc).toBe('[^1]\n\n[^1]: ')
  })

  test('goes under the last of the words rather than under the blank lines', () => {
    expect(apply(insertFootnote, 'a claim\n\n\n', 7).doc).toBe('a claim[^1]\n\n[^1]: ')
  })

  test('never replaces what is selected: a footnote is added to it', () => {
    expect(apply(insertFootnote, 'a claim here\n', 2, 7).doc).toBe('a claim[^1] here\n\n[^1]: ')
  })
})

/** The fold sign on a callout, written rather than typed by hand.
 *
 *  `insertCallout` writes no sign and should not: most callouts are not folded, and a
 *  sign in every one of them would be punctuation nobody asked for. So the two rows in
 *  the menu put one there - `+` for a callout that may be folded, which is what
 *  Obsidian reads, and `-` for one that opens shut, which nib reads on the way in. See
 *  callouts.ts in @nib/markdown. */
describe('a callout is asked to fold', () => {
  const CALLOUT = '> [!note] Mind the gap\n> and the step.\n'

  test('says nothing about folding until it is asked', () => {
    expect(calloutSign(stateOf(CALLOUT, 4))).toBe('')
    expect(run(insertCallout, '|')).toBe('> [!NOTE]\n> ')
  })

  test('and nothing at all where the caret is not in one', () => {
    expect(calloutSign(stateOf('Plain words.\n', 3))).toBeNull()
    expect(calloutSign(stateOf('> A plain quote\n', 5))).toBeNull()
    expect(took(setCalloutSign('-'), 'Plain |words.')).toBe(false)
  })

  test('takes the sign after the brackets, where Obsidian writes it', () => {
    expect(at(setCalloutSign('+'), CALLOUT, 4)).toBe('> [!note]+ Mind the gap\n> and the step.\n')
    expect(at(setCalloutSign('-'), CALLOUT, 4)).toBe('> [!note]- Mind the gap\n> and the step.\n')
  })

  test('from a caret anywhere in the callout, not only on its first line', () => {
    expect(at(setCalloutSign('-'), CALLOUT, CALLOUT.indexOf('step'))).toBe(
      '> [!note]- Mind the gap\n> and the step.\n',
    )
  })

  test('asked for the sign it already has, takes it off again', () => {
    const folded = '> [!note]- Mind the gap\n'
    expect(at(setCalloutSign('-'), folded, 4)).toBe('> [!note] Mind the gap\n')
    expect(calloutSign(stateOf(folded, 4))).toBe('-')
  })

  test('and asked for the other one, trades it', () => {
    expect(at(setCalloutSign('+'), '> [!note]- Mind the gap\n', 4)).toBe(
      '> [!note]+ Mind the gap\n',
    )
    expect(calloutSign(stateOf('> [!note]+ Mind the gap\n', 4))).toBe('+')
  })

  test('leaves a callout with no title of its own a callout with no title', () => {
    expect(at(setCalloutSign('-'), '> [!tip]\n> Below it.\n', 4)).toBe('> [!tip]-\n> Below it.\n')
  })
})
