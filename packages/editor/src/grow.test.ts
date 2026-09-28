import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { expandSelection, growing, shrinkSelection } from './grow'
import { hiddenFrontMatterGuard } from './live-preview/hidden-front-matter'
import { nibMarkdownExtensions } from './markdown/extensions'

function stateOf(doc: string, caret: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        hiddenFrontMatterGuard,
        growing,
      ],
    }),
  )
}

function press(state: EditorState, command: StateCommand): EditorState {
  let next = state
  command({ state, dispatch: (transaction) => (next = transaction.state) })
  return next
}

/** What each press of Expand selects, in order, until the note is all there is. */
function steps(doc: string, caret: number): string[] {
  const seen: string[] = []
  let state = stateOf(doc, caret)
  for (let count = 0; count < 12; count++) {
    const next = press(state, expandSelection)
    if (next === state) break
    state = next
    seen.push(state.sliceDoc(state.selection.main.from, state.selection.main.to))
  }
  return seen
}

describe('growing the selection', () => {
  test('word, the words between the stars, the stars, the paragraph, the note', () => {
    const doc = 'Some **bold words** here.\n\nNext.'
    expect(steps(doc, doc.indexOf('bold') + 1)).toEqual([
      'bold',
      'bold words',
      '**bold words**',
      'Some **bold words** here.',
      doc,
    ])
  })

  test('a list item, the list, the section, the sections around it', () => {
    const doc = '# One\n\n## Two\n\n- a\n- b\n\n## Three\n'
    expect(steps(doc, doc.indexOf('b'))).toEqual([
      'b',
      '- b',
      '- a\n- b',
      '## Two\n\n- a\n- b',
      doc.trimEnd(),
      doc,
    ])
  })

  test('a heading’s words before the heading', () => {
    const doc = '## Big title\n\ntext'
    expect(steps(doc, doc.indexOf('title')).slice(0, 3)).toEqual([
      'title',
      'Big title',
      '## Big title',
    ])
  })

  test('a link’s words before the link', () => {
    const doc = 'see [the docs](https://a.ch) now'
    expect(steps(doc, doc.indexOf('docs')).slice(0, 3)).toEqual([
      'docs',
      'the docs',
      '[the docs](https://a.ch)',
    ])
  })

  test('never grows into hidden metadata', () => {
    const meta = '---\nicon: x\n---\n'
    const doc = `${meta}words here`
    const last = steps(doc, doc.indexOf('here')).at(-1)
    expect(last).toBe('words here')
  })
})

describe('shrinking it again', () => {
  test('goes back down the steps it came up, one a press', () => {
    const doc = 'Some *very* nice text.'
    let state = stateOf(doc, doc.indexOf('very') + 1)
    const start = state.selection

    const at = (one: EditorState) => one.sliceDoc(one.selection.main.from, one.selection.main.to)
    for (let n = 0; n < 3; n++) state = press(state, expandSelection)
    expect(at(state)).toBe('Some *very* nice text.')

    state = press(state, shrinkSelection)
    expect(at(state)).toBe('*very*')
    state = press(state, shrinkSelection)
    expect(at(state)).toBe('very')
    state = press(state, shrinkSelection)
    expect(state.selection.eq(start)).toBe(true)
    expect(shrinkSelection({ state, dispatch: () => undefined })).toBe(false)
  })

  test('has nothing to go back to once the selection has moved', () => {
    let state = stateOf('one two', 1)
    state = press(state, expandSelection)
    state = state.update({ selection: EditorSelection.cursor(5) }).state

    expect(shrinkSelection({ state, dispatch: () => undefined })).toBe(false)
  })
})
