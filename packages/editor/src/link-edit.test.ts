import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { editLink, linkPartsAt, removeLink } from './link-edit'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function state(doc: string, readOnly = false) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  )
}

/** What a command leaves: the text, and what is selected in it. */
function after(doc: string, command: StateCommand, readOnly = false) {
  let current = state(doc, readOnly)
  const ran = command({
    state: current,
    dispatch: (transaction) => (current = transaction.state),
  })
  const { from, to } = current.selection.main
  return { ran, doc: current.doc.toString(), selected: current.doc.sliceString(from, to) }
}

/** The position inside the first occurrence of `words`. */
const inside = (doc: string, words: string) => doc.indexOf(words) + 1

describe('the link a press landed on', () => {
  test.each([
    ['see [the *docs*](https://x.dev "t") now', 'docs', 'https://x.dev', 'the *docs*'],
    ['see <https://x.dev> now', 'x.dev', 'https://x.dev', null],
    ['see www.x.dev now', 'x.dev', 'www.x.dev', null],
    ['see [[Plan#Today|the plan]] now', 'plan', 'Plan#Today', 'the plan'],
    ['see [[Plan]] now', 'Plan', 'Plan', 'Plan'],
    ['see [words][ref] now\n\n[ref]: https://r.dev', 'words', '[ref]', 'words'],
    ['see [words]() now', 'words', '', 'words'],
  ])('%s', (doc, at, target, words) => {
    const parts = linkPartsAt(state(doc), inside(doc, at))
    expect(parts && doc.slice(parts.target.from, parts.target.to)).toBe(target)
    expect(parts?.words).toBe(words)
  })

  test('is found from its address as well as from its words', () => {
    const doc = 'see [docs](https://x.dev) now'
    expect(linkPartsAt(state(doc), inside(doc, 'x.dev'))?.words).toBe('docs')
  })

  test('is no picture and no embed, which have menus of their own', () => {
    for (const doc of ['![shot](https://x.dev/a.png)', '![[shot.png]]', 'plain words']) {
      expect(linkPartsAt(state(doc), 4), doc).toBeNull()
    }
  })
})

describe('editing it', () => {
  test('selects where it points, so the next thing typed is the new address', () => {
    const doc = 'see [docs](https://x.dev) now'
    const done = after(doc, editLink(inside(doc, 'docs')))
    expect(done).toEqual({ ran: true, doc, selected: 'https://x.dev' })
  })

  test('selects the note of a link with words of its own, not the words', () => {
    const doc = 'see [[Plan|the plan]] now'
    expect(after(doc, editLink(inside(doc, 'the plan'))).selected).toBe('Plan')
  })
})

describe('taking it away', () => {
  test.each([
    ['see [the *docs*](https://x.dev) now', 'docs', 'see the *docs* now'],
    ['see [[Plan#Today|the plan]] now', 'plan', 'see the plan now'],
    ['see [[Plan#Today]] now', 'Plan', 'see Plan#Today now'],
  ])('%s keeps its words', (doc, at, left) => {
    expect(after(doc, removeLink(inside(doc, at)))).toMatchObject({ ran: true, doc: left })
  })

  test('is nothing for an address written out, which would still be the link', () => {
    const doc = 'see <https://x.dev> now'
    expect(after(doc, removeLink(inside(doc, 'x.dev')))).toMatchObject({ ran: false, doc })
  })

  test('and nothing in a note nobody can write in', () => {
    const doc = 'see [docs](https://x.dev) now'
    expect(after(doc, removeLink(inside(doc, 'docs')), true)).toMatchObject({ ran: false, doc })
    expect(after(doc, editLink(inside(doc, 'docs')), true).ran).toBe(false)
  })
})
