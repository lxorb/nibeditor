import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { hiddenFrontMatterGuard } from './live-preview/hidden-front-matter'
import { nibMarkdownExtensions } from './markdown/extensions'
import { deleteLine, insertLineAbove, joinLines, reverseLines, sortLines } from './lines'

/** A note with the selection written into it - `|` is the caret, `«` and `»` are
 *  the ends of a selection - and what a command makes of it, written the same way.
 *  With the guard that keeps hidden metadata whole, so every test is also a test
 *  that none of these reaches into it. */
function run(command: StateCommand, marked: string): { took: boolean; note: string } {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[|«»]/g, '')
  const selection =
    caret >= 0
      ? EditorSelection.cursor(caret)
      : EditorSelection.range(marked.indexOf('«'), marked.indexOf('»') - 1)

  let state = parsed(
    EditorState.create({
      doc,
      selection,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        hiddenFrontMatterGuard,
      ],
    }),
  )

  const took = command({ state, dispatch: (transaction) => (state = transaction.state) })
  const { from, to } = state.selection.main
  const text = state.doc.toString()
  const note =
    from === to
      ? text.slice(0, from) + '|' + text.slice(from)
      : text.slice(0, from) + '«' + text.slice(from, to) + '»' + text.slice(to)

  return { took, note }
}

const note = (command: StateCommand, marked: string) => run(command, marked).note

const META = '---\nicon: list-checks\n---\n'

describe('sorting and reversing lines', () => {
  test('sorts the selected lines and leaves them selected', () => {
    expect(note(sortLines, '«pear\napple\nfig»')).toBe('«apple\nfig\npear»')
  })

  test('sorts the list the caret is in when nothing is selected', () => {
    expect(note(sortLines, 'Shopping\n\n- pear|\n- apple\n- fig\n\nAfter')).toBe(
      'Shopping\n\n«- apple\n- fig\n- pear»\n\nAfter',
    )
  })

  test('reads past markers and boxes, case, and counts numbers as numbers', () => {
    expect(note(sortLines, '«- [x] item 10\n- [ ] Item 2\n- item 1»')).toBe(
      '«- item 1\n- [ ] Item 2\n- [x] item 10»',
    )
  })

  test('leaves the line the selection ends in front of alone', () => {
    expect(note(sortLines, '«b\na\n»c')).toBe('«a\nb»\nc')
  })

  test('reverses the lines', () => {
    expect(note(reverseLines, '«one\ntwo\nthree»')).toBe('«three\ntwo\none»')
  })

  test('gives way on a line with nothing to sort it against', () => {
    expect(run(sortLines, 'alone|').took).toBe(false)
  })

  test('stops at hidden metadata rather than sorting its fences in', () => {
    expect(note(sortLines, `${META}b|\na`)).toBe(`${META}«a\nb»`)
  })
})

describe('joining lines', () => {
  test('pulls the next line up with one space, the caret at the seam', () => {
    expect(note(joinLines, 'one|\n   two')).toBe('one| two')
  })

  test('takes the list marker, box and quote marks off the line that comes up', () => {
    expect(note(joinLines, '- one|\n- [ ] two')).toBe('- one| two')
    expect(note(joinLines, '> one|\n> two')).toBe('> one| two')
  })

  test('joins every selected line onto the first', () => {
    expect(note(joinLines, '«a\nb\nc»')).toBe('«a b c»')
  })

  test('adds no space onto an empty line or before one', () => {
    expect(note(joinLines, 'one|\n\ntwo')).toBe('one|\ntwo')
    expect(note(joinLines, '|\ntwo')).toBe('|two')
  })

  test('gives way on the last line', () => {
    expect(run(joinLines, 'first\nlast|').took).toBe(false)
  })
})

describe('a line above', () => {
  test('opens an empty line above, indented like the caret’s', () => {
    expect(note(insertLineAbove, 'one\n  two|')).toBe('one\n  |\n  two')
  })

  test('opens it under hidden metadata rather than inside it', () => {
    expect(note(insertLineAbove, `${META}# Title|`)).toBe(`${META}|\n# Title`)
  })
})

describe('deleting a line', () => {
  test('deletes the caret’s line and keeps its column', () => {
    expect(note(deleteLine, 'one\ntw|o\nthree')).toBe('one\nth|ree')
  })

  test('deletes the first line that shows and leaves hidden metadata whole', () => {
    expect(note(deleteLine, `${META}# Tit|le\nwords`)).toBe(`${META}words|`)
  })

  test('empties the only line that shows rather than eating the fence', () => {
    expect(run(deleteLine, `${META}words|`).note.startsWith(META)).toBe(true)
  })
})
