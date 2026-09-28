import { history, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { moveBlockDown, moveBlocks, moveBlockUp } from './commands'
import { landing, moveBlock } from './move'
import { blockAt } from './span'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

/** A block moved keeps being the block it was.
 *
 *  Markdown has no walls between blocks: a paragraph written straight under a list
 *  item is more of that item, a line straight under a table is another row of it,
 *  and a numbered item that does not start at one, straight under a bullet, is more
 *  of the bullet's words. So a move that got the blank lines wrong did not put a
 *  block somewhere else, it put it inside something else - the presets agent found a
 *  paragraph moved up past a tight list land as the last item's second line.
 *
 *  Every case here goes through one of the ways in: the keys and the grip's rows are
 *  `moveBlockUp`, `moveBlockDown` and `moveBlocks`, a drag is `moveBlock` at the
 *  line it was dropped on. And every case reads the result twice: as text, and as
 *  what the parser makes of it, because the text looking right is not the bug. */

function viewOf(doc: string, caret: number) {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        history(),
      ],
    }),
  )

  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec | Transaction) => {
      state = parsed(spec instanceof Transaction ? spec.state : state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView

  return { view, said: () => view.state.doc.toString() }
}

/** The caret in the block that starts with `words`, and one step up or down. */
function moved(doc: string, words: string, delta: -1 | 1) {
  const { view, said } = viewOf(doc, doc.indexOf(words) + 1)
  const ran = (delta < 0 ? moveBlockUp : moveBlockDown)(view)
  return { ran, text: said(), view }
}

const up = (doc: string, words: string) => moved(doc, words, -1).text
const down = (doc: string, words: string) => moved(doc, words, 1).text

/** What the parser makes of a note, a word for each top-level block and a count of
 *  the items in each list. */
function read(doc: string): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
  const found: string[] = []

  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    const items = node.getChildren('ListItem').length
    found.push(items ? `${node.name} ${items}` : node.name)
  }

  return found
}

/** A drop, as the grip makes one: the block under `words`, put in front of the line
 *  that starts `before` - or after everything, when that is null. */
function dropped(doc: string, words: string, before: string | null): string | null {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
  const span = blockAt(state, doc.indexOf(words) + 1)
  if (!span) throw new Error(`no block at ${words}`)

  const edit = moveBlock(state, span, before === null ? doc.length : doc.indexOf(before))
  return edit ? state.update({ changes: edit.changes }).state.doc.toString() : null
}

describe('a paragraph and a tight list', () => {
  const doc = '- one\n- two\n\nBravo words.\n'

  test('the paragraph moved up past the last item stays a paragraph', () => {
    const once = up(doc, 'Bravo')
    expect(once).toBe('- one\n\nBravo words.\n\n- two\n')
    expect(read(once)).toEqual(['BulletList 1', 'Paragraph', 'BulletList 1'])
  })

  test('and up again, the list is one tight list again', () => {
    const twice = up(up(doc, 'Bravo'), 'Bravo')
    expect(twice).toBe('Bravo words.\n\n- one\n- two\n')
    expect(read(twice)).toEqual(['Paragraph', 'BulletList 2'])
  })

  test('and down twice, it is back where it was', () => {
    const top = 'Bravo words.\n\n- one\n- two\n'
    expect(down(down(top, 'Bravo'), 'Bravo')).toBe(doc)
  })

  test('an item moved out of the list and past the paragraph keeps being an item', () => {
    const out = down(doc, 'two')
    expect(out).toBe('- one\n\nBravo words.\n\n- two\n')
    expect(read(out)).toEqual(['BulletList 1', 'Paragraph', 'BulletList 1'])
  })

  test('items moved inside it keep it tight', () => {
    expect(up(doc, 'two')).toBe('- two\n- one\n\nBravo words.\n')
    expect(down('- one\n- two\n- three\n', 'one')).toBe('- two\n- one\n- three\n')
  })
})

describe('a loose list', () => {
  const doc = '- one\n\n- two\n\n- three\n\nBravo words.\n'

  test('an item moved inside it keeps it loose', () => {
    expect(up(doc, 'three')).toBe('- one\n\n- three\n\n- two\n\nBravo words.\n')
  })

  test('a paragraph moved into it stays out of the items', () => {
    const once = up(doc, 'Bravo')
    expect(once).toBe('- one\n\n- two\n\nBravo words.\n\n- three\n')
    expect(read(once)).toEqual(['BulletList 2', 'Paragraph', 'BulletList 1'])
  })
})

describe('a numbered list', () => {
  const doc = '1. one\n2. two\n\nBravo words.\n'

  test('a paragraph moved up past the last item stays a paragraph', () => {
    const once = up(doc, 'Bravo')
    expect(once).toBe('1. one\n\nBravo words.\n\n2. two\n')
    expect(read(once)).toEqual(['OrderedList 1', 'Paragraph', 'OrderedList 1'])
    expect(up(once, 'Bravo')).toBe('Bravo words.\n\n1. one\n2. two\n')
  })

  test('an item moved inside it keeps its own number and the list tight', () => {
    expect(up('1. one\n2. two\n3. three\n', 'three')).toBe('1. one\n3. three\n2. two\n')
  })

  test('a bullet moved in does not take the next numbered item as its own words', () => {
    // `2.` cannot start a list straight under a bullet's words, so without a blank
    // line it would be read as more of them.
    const into = down('- bullet\n\n1. one\n2. two\n', 'bullet')
    expect(into).toBe('1. one\n- bullet\n\n2. two\n')
    expect(read(into)).toEqual(['OrderedList 1', 'BulletList 1', 'OrderedList 1'])
  })
})

describe('a task list', () => {
  test('a paragraph moved up past the last task stays a paragraph', () => {
    const once = up('- [ ] one\n- [x] two\n\nBravo words.\n', 'Bravo')
    expect(once).toBe('- [ ] one\n\nBravo words.\n\n- [x] two\n')
    expect(read(once)).toEqual(['BulletList 1', 'Paragraph', 'BulletList 1'])
  })

  test('a task moved inside it keeps it tight', () => {
    expect(up('- [ ] one\n- [x] two\n', 'two')).toBe('- [x] two\n- [ ] one\n')
  })
})

describe('a nested list', () => {
  test('a paragraph moved up steps over the whole item, children and all', () => {
    const doc = '- one\n  - nested\n\nBravo words.\n'
    expect(up(doc, 'Bravo')).toBe('Bravo words.\n\n- one\n  - nested\n')
  })

  test('an item moved up past one with children does not adopt them', () => {
    expect(up('- one\n  - nested\n- two\n', 'two')).toBe('- two\n- one\n  - nested\n')
  })

  test('a paragraph moved down steps over the whole item', () => {
    const doc = 'Bravo words.\n\n- one\n  - nested\n- two\n'
    expect(down(doc, 'Bravo')).toBe('- one\n  - nested\n\nBravo words.\n\n- two\n')
  })

  test('a child moves among its siblings', () => {
    expect(up('- one\n  - a\n  - b\n', 'b')).toBe('- one\n  - b\n  - a\n')
  })

  test('a child moved out of its parent comes out to the parent’s depth', () => {
    expect(up('- one\n  - nested\n', 'nested')).toBe('- nested\n- one\n')
  })

  test('a deep child moved past a paragraph stays an item rather than turning into code', () => {
    const doc = '- one\n  - two\n    - three\n\nBravo words.\n'
    const out = down(doc, 'three')
    expect(out).toBe('- one\n  - two\n\nBravo words.\n\n- three\n')
    expect(read(out)).toEqual(['BulletList 1', 'Paragraph', 'BulletList 1'])
  })

  test('a drop between an item and its children lands before the item', () => {
    const doc = '- one\n  - nested\n\nBravo words.\n'
    expect(dropped(doc, 'Bravo', '  - nested')).toBe('Bravo words.\n\n- one\n  - nested\n')
  })
})

describe('a quote, a fence and a table', () => {
  test('a paragraph moved up to right under a quote is not more of the quote', () => {
    const once = up('> quoted\n- item\n\nBravo words.\n', 'Bravo')
    expect(once).toBe('> quoted\n\nBravo words.\n\n- item\n')
    expect(read(once)).toEqual(['Blockquote', 'Paragraph', 'BulletList 1'])
  })

  test('a quote moved up past a tight list stays out of it', () => {
    const once = up('- one\n- two\n\n> quoted\n', 'quoted')
    expect(once).toBe('- one\n\n> quoted\n\n- two\n')
    expect(read(once)).toEqual(['BulletList 1', 'Blockquote', 'BulletList 1'])
  })

  test('a fence moves whole, blank lines inside it and all', () => {
    const doc = 'Alpha words.\n\n```js\na()\n\nb()\n```\n'
    expect(up(doc, '```js')).toBe('```js\na()\n\nb()\n```\n\nAlpha words.\n')
    expect(down('```js\na()\n\nb()\n```\n\nAlpha words.\n', '```js')).toBe(doc)
  })

  test('a fence moved up past a tight list stays out of it', () => {
    const once = up('- one\n- two\n\n```\ncode\n```\n', '```')
    expect(once).toBe('- one\n\n```\ncode\n```\n\n- two\n')
    expect(read(once)).toEqual(['BulletList 1', 'FencedCode', 'BulletList 1'])
  })

  test('a paragraph moved to right under a table is not another row of it', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n# Heading\n\nBravo words.\n'
    const once = up(doc, 'Bravo')
    expect(once).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\nBravo words.\n\n# Heading\n')
    expect(read(once)).toEqual(['Table', 'Paragraph', 'ATXHeading1'])
  })

  test('a table moves whole', () => {
    const doc = 'Alpha words.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    expect(up(doc, '| a')).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\nAlpha words.\n')
  })
})

describe('a heading', () => {
  const doc = '# One\n\nalpha\n\n# Two\n\nbeta\n'

  test('moves with its whole section, either way', () => {
    expect(up(doc, '# Two')).toBe('# Two\n\nbeta\n\n# One\n\nalpha\n')
    expect(down(doc, '# One')).toBe('# Two\n\nbeta\n\n# One\n\nalpha\n')
  })

  test('steps over its sibling sections, not the words of the one above', () => {
    const doc = '# A\n\na\n\n## B\n\nb\n\n## C\n\nc\n'
    expect(up(doc, '## C')).toBe('# A\n\na\n\n## C\n\nc\n\n## B\n\nb\n')
    expect(up('# A\n\na\n\n## C\n\nc\n', '## C')).toBe('## C\n\nc\n\n# A\n\na\n')
  })

  test('a paragraph moves through one a line at a time, either way', () => {
    const into = down(doc, 'alpha')
    expect(into).toBe('# One\n\n# Two\n\nalpha\n\nbeta\n')
    expect(up(into, 'alpha')).toBe(doc)
  })

  test('moved up past a tight list stays out of it', () => {
    const once = up('- one\n- two\n\n## Heading\n', 'Heading')
    expect(once).toBe('- one\n\n## Heading\n\n- two\n')
    expect(read(once)).toEqual(['BulletList 1', 'ATXHeading2', 'BulletList 1'])
  })
})

describe('front matter', () => {
  const doc = '---\ntitle: x\n---\n\nAlpha words.\n\nBravo words.\n'

  test('the first block under it goes no higher', () => {
    const { ran, text } = moved(doc, 'Alpha', -1)
    expect(ran).toBe(false)
    expect(text).toBe(doc)
  })

  test('a drop at the top of the note lands under it', () => {
    expect(dropped(doc, 'Bravo', '---')).toBe(
      '---\ntitle: x\n---\n\nBravo words.\n\nAlpha words.\n',
    )
  })

  test('is never moved itself', () => {
    const state = parsed(
      EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )
    const span = blockAt(state, 1)
    expect(span?.kind).toBe('properties')
    expect(moveBlock(state, span!, state.doc.length)).toBeNull()
  })

  test('the first block under it moves down as any other', () => {
    expect(down(doc, 'Alpha')).toBe('---\ntitle: x\n---\n\nBravo words.\n\nAlpha words.\n')
  })
})

describe('the two ends of a note', () => {
  test('the first block goes no higher, and the last no lower', () => {
    const doc = 'a\n\nb\n'
    expect(moved(doc, 'a', -1).ran).toBe(false)
    expect(moved(doc, 'b', 1).ran).toBe(false)
  })

  test('to the top and to the bottom, with and without a last line break', () => {
    expect(up('a\n\nb\n', 'b')).toBe('b\n\na\n')
    expect(up('a\n\nb', 'b')).toBe('b\n\na')
    expect(down('a\n\nb\n', 'a')).toBe('b\n\na\n')
    expect(down('a\n\nb', 'a')).toBe('b\n\na')
  })

  test('the blank lines around a note are left where they were', () => {
    expect(up('\n\na\n\nb\n', 'b')).toBe('\n\nb\n\na\n')
    expect(down('a\n\nb\n\n\n', 'a')).toBe('b\n\na\n\n\n')
  })

  test('a drop after everything lands under the last line, not after the blank ones', () => {
    expect(dropped('a\n\nb\n', 'a', null)).toBe('b\n\na\n')
  })
})

describe('where a drop lands', () => {
  test('is asked of the same code the move uses, so the line drawn is the line it lands on', () => {
    const doc = '- one\n  - nested\n\nBravo words.\n'
    const state = parsed(
      EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )
    const span = blockAt(state, doc.indexOf('Bravo'))!

    expect(landing(state, span, doc.indexOf('  - nested'))).toBe(0)
    expect(landing(state, span, span.from)).toBeNull()
  })
})

describe('the caret and undo', () => {
  test('the caret goes with the words it was in, even when they come out a level', () => {
    const doc = '- one\n  - nested words\n'
    const { view } = viewOf(doc, doc.indexOf('words'))
    expect(moveBlockUp(view)).toBe(true)

    const at = view.state.selection.main.head
    expect(view.state.doc.sliceString(at, at + 5)).toBe('words')
  })

  test('one undo puts every note back exactly as it was', () => {
    const cases: [string, string, -1 | 1][] = [
      ['- one\n- two\n\nBravo words.\n', 'Bravo', -1],
      ['- one\n  - two\n    - three\n\nBravo words.\n', 'three', 1],
      ['| a |\n| - |\n| 1 |\n# Heading\n\nBravo words.\n', 'Bravo', -1],
      ['- bullet\n\n1. one\n2. two\n', 'bullet', 1],
      ['a\n\nb', 'b', -1],
    ]

    for (const [doc, words, delta] of cases) {
      const { ran, view } = moved(doc, words, delta)
      expect(ran).toBe(true)
      expect(view.state.doc.toString()).not.toBe(doc)

      undo(view)
      expect(view.state.doc.toString()).toBe(doc)
    }
  })

  test('a run of blocks moves as one', () => {
    const doc = '- one\n- two\n\nAlpha words.\n\nBravo words.\n'
    const { view, said } = viewOf(doc, doc.indexOf('Alpha'))
    view.dispatch({
      selection: EditorSelection.range(doc.indexOf('Alpha'), doc.indexOf('Bravo') + 3),
    })

    expect(moveBlocks(view, doc.indexOf('Alpha'), -1)).toBe(true)
    expect(said()).toBe('- one\n\nAlpha words.\n\nBravo words.\n\n- two\n')
  })
})
