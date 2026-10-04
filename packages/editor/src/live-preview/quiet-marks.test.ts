import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@nib/markdown/eager'
import { buildDecorations } from './decorate'
import { quietMarks } from './reveal'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

/** What the reader cannot see with the caret at `cursor`, the marks kept quiet or not. */
function concealed(doc: string, cursor: number, quiet: boolean): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        quietMarks.of(quiet),
      ],
    }),
  )
  const out: string[] = []
  buildDecorations(state).atomic.between(0, doc.length, (from, to) => {
    out.push(doc.slice(from, to))
  })
  return out
}

describe('quiet marks', () => {
  test('bold keeps its stars hidden with the caret inside it', () => {
    const doc = 'a **bold** b'
    expect(concealed(doc, 5, false)).toEqual([])
    expect(concealed(doc, 5, true)).toEqual(['**', '**'])
  })

  test('a heading keeps its # hidden on its own line', () => {
    const doc = '# Title'
    expect(concealed(doc, 4, false)).toEqual([])
    expect(concealed(doc, 4, true)).toEqual(['# '])
  })

  test('inline code hides its backticks, a fence does not', () => {
    expect(concealed('a `x` b', 3, true)).toEqual(['`', '`'])
    const fence = '```js\nx\n```'
    expect(concealed(fence, 7, true)).toEqual([])
  })

  test('a link still opens its target under the caret', () => {
    const doc = '[label](https://example.com)'
    expect(concealed(doc, 3, true)).toEqual([])
  })
})
