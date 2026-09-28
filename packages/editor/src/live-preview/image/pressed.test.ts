import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { imageResolver } from '../../images'
import { nibMarkdownExtensions } from '../../markdown/extensions'
import { parsed } from '../../../test/parsed'
import { deletePicture, pictureAt, pictureUrl } from './pressed'

function state(doc: string, readOnly = false) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        imageResolver.of((src) => `asset://space/${src}`),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  )
}

describe('the picture a press landed on', () => {
  test.each([
    ['a ![a cat](shots/cat.png "t") b', 'shots/cat.png', 'a cat'],
    ['a <img src="cat.png" alt="a cat" style="zoom:50%"> b', 'cat.png', 'a cat'],
    ['a ![[cat.png|a cat]] b', 'cat.png', 'a cat'],
    ['a ![[cat.png|300]] b', 'cat.png', ''],
  ])('%s', (doc, src, alt) => {
    expect(pictureAt(state(doc), 2)).toEqual({ from: 2, to: doc.length - 2, src, alt })
  })

  test('is none for a note, a PDF or a link, which are not pictures', () => {
    for (const doc of ['a ![[Plan]] b', 'a ![[paper.pdf]] b', 'a [[cat.png]] b', 'a b c']) {
      expect(pictureAt(state(doc), 2), doc).toBeNull()
    }
  })

  test('is loaded through the resolver the note is drawn with', () => {
    const current = state('![](cat.png)')
    const picture = pictureAt(current, 0)
    expect(picture && pictureUrl(current, picture)).toBe('asset://space/cat.png')
  })
})

describe('deleting it', () => {
  function run(doc: string, readOnly = false, edit?: string) {
    let current = state(doc, readOnly)
    const picture = pictureAt(current, 2)
    if (edit !== undefined) current = current.update({ changes: { from: 0, insert: edit } }).state

    const ran =
      !!picture &&
      deletePicture(picture)({ state: current, dispatch: (next) => (current = next.state) })
    return { ran, doc: current.doc.toString() }
  }

  test('takes the picture out of the note and leaves the words around it', () => {
    expect(run('a ![](cat.png) b')).toEqual({ ran: true, doc: 'a  b' })
    expect(run('a ![[cat.png]] b')).toEqual({ ran: true, doc: 'a  b' })
  })

  test('does nothing once the note has moved under it', () => {
    expect(run('a ![](cat.png) b', false, 'xyz')).toEqual({ ran: false, doc: 'xyza ![](cat.png) b' })
  })

  test('nor in a note nobody can write in', () => {
    expect(run('a ![](cat.png) b', true)).toEqual({ ran: false, doc: 'a ![](cat.png) b' })
  })
})
