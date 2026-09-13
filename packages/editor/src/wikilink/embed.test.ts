import { EditorState } from '@codemirror/state'
import { parseWikilink } from '@nib/markdown/links'
import { describe, expect, test } from 'vitest'
import type { LinkSpan } from './at'
import { EmbedFileWidget, embedWidget } from './embed'
import { type NoteIndex, noteIndex } from './notes'

/** What `![[paper.pdf#page=3]]` and `![[Board.canvas]]` ask the app to draw.
 *
 *  The drawing itself is the app's - pdf.js and the canvas painter both are - and
 *  it reaches the card through the index, so what the editor owns is the question
 *  rather than the answer: which file, which page of it, and whether the space
 *  holds it at all. That is what is asserted here, because it is the whole of the
 *  editor's side of this and because the drawn surface is DOM, which this
 *  package's tests have no window to build one in. */

function link(inner: string): LinkSpan {
  const parsed = parseWikilink(inner, true)
  if (!parsed) throw new Error(`${inner} is not a link`)

  return { ...parsed, kind: 'wikilink', from: 0, to: 0 }
}

const SPACE: NoteIndex = {
  notes: [],
  files: ['reading/paper.pdf', 'Board.canvas'],
  path: 'Note.md',
  read: () => Promise.resolve(null),
  drawFile: () => () => undefined,
}

function card(inner: string): EmbedFileWidget {
  const state = EditorState.create({ extensions: [noteIndex.of(SPACE)] })
  const widget = embedWidget(state, link(inner))
  if (!(widget instanceof EmbedFileWidget)) throw new Error(`${inner} is not a file`)

  return widget
}

describe('an embedded paper', () => {
  test('asks for the page the link named, drawn where it stands', () => {
    expect(card('paper.pdf#page=3').drawing()).toEqual({
      kind: 'pdf',
      path: 'reading/paper.pdf',
      page: 3,
    })
  })

  test('whose link names no page asks for none, and is drawn at its first', () => {
    // Which page that is belongs to whatever asks pdf.js for one, so the ask says
    // what the link said and no more.
    expect(card('paper.pdf').drawing()).toEqual({
      kind: 'pdf',
      path: 'reading/paper.pdf',
      page: null,
    })
  })

  test('the space has not got stays the card, with nothing to draw', () => {
    expect(card('missing.pdf').drawing()).toBe(null)
  })
})

describe('an embedded plane', () => {
  test('asks to be drawn whole, since a plane has no page', () => {
    expect(card('Board.canvas').drawing()).toEqual({
      kind: 'canvas',
      path: 'Board.canvas',
      page: null,
    })
  })
})
