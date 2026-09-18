import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { blockDecorations, propertiesMode } from './blocks'
import { edgeBeside } from './stepping'
import { dragFreeze } from './dragging'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

/** Where an up or a down press lands when the line it aims at is a block that
 *  draws itself.
 *
 *  The key itself is caret-blocks.py, which is the only place the question can
 *  actually be asked: whether a press steps over a block is a fact about lines
 *  that were never drawn, and nothing here draws anything. What is here is the
 *  arithmetic underneath - which line a press aims at, and what is on it. */

function state(doc: string, cursor = 0, mode?: 'hidden') {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
        ...(mode ? [propertiesMode.of(mode)] : []),
      ],
    }),
  )
}

/** The caret moved to `to`, which is not the same as a state made with it there:
 *  a state is created with nothing revealed, however it is created, so that a note
 *  whose first thing is a formula opens drawn rather than as markdown. Only a
 *  transaction that moves the caret reveals anything; see `chosen` in blocks.ts. */
function moved(doc: string, to: number) {
  return parsed(state(doc).update({ selection: EditorSelection.cursor(to) }).state)
}

const FORMULA = 'above\n\n$$\nE = mc^2\n$$\n\nbelow\n'
const at = (doc: string, text: string) => doc.indexOf(text)

describe('a press onto a block that draws itself', () => {
  test('stops at the top of it on the way down', () => {
    const doc = FORMULA
    // The blank line over the block, which is the line a reader coming down the
    // note stands on before the press that would step over it.
    const blank = at(doc, '\n\n$$') + 1
    expect(edgeBeside(state(doc, blank), blank, true)).toBe(at(doc, '$$'))
  })

  test('and at the bottom of it on the way up', () => {
    const doc = FORMULA
    const blank = at(doc, '$$\n\nbelow') + 3
    expect(edgeBeside(state(doc, blank), blank, false)).toBe(at(doc, '$$\n\nbelow') + 2)
  })

  test('one line at a time, so a line clear of the block is an ordinary press', () => {
    const doc = FORMULA
    // `above` and `below` each have a blank line between them and the formula,
    // and a press off one of those lines has nothing in its way.
    expect(edgeBeside(state(doc, 0), 0, true)).toBe(null)
    expect(edgeBeside(state(doc, at(doc, 'below')), at(doc, 'below'), false)).toBe(null)
  })

  test('nothing where the line it aims at is ordinary text', () => {
    const doc = 'one\ntwo\nthree\n'
    expect(edgeBeside(state(doc, 0), 0, true)).toBe(null)
    expect(edgeBeside(state(doc, 5), 5, false)).toBe(null)
  })

  test('nothing off either end of the note', () => {
    const doc = FORMULA
    expect(edgeBeside(state(doc, 0), 0, false)).toBe(null)
    expect(edgeBeside(state(doc, doc.length), doc.length, true)).toBe(null)
  })

  test('nothing for the block the caret is already in, which is showing its source', () => {
    const doc = FORMULA
    const inside = at(doc, 'E = mc')
    // The formula is text while the caret is in it, so the lines either side of
    // that one are its own `$$` and there is no widget anywhere to stop at: the
    // presses that walk out of a block are the library's ordinary ones.
    expect(edgeBeside(moved(doc, inside), inside, false)).toBe(null)
    expect(edgeBeside(moved(doc, inside), inside, true)).toBe(null)
  })

  const META = '---\ntitle: One\n---\n\nwords\n'

  test('nothing for metadata somebody asked to hide, which has no source to open', () => {
    const blank = at(META, '\nwords')
    expect(edgeBeside(state(META, blank, 'hidden'), blank, false)).toBe(null)
  })

  test('but the metadata itself opens like any other block', () => {
    const blank = at(META, '\nwords')
    // The end of the closing `---`, which is where the metadata's own lines end.
    expect(edgeBeside(state(META, blank), blank, false)).toBe(at(META, '\n\nwords'))
  })
})
