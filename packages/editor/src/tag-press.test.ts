import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { buildDecorations } from './live-preview/decorate'
import { nibMarkdownExtensions } from './markdown/extensions'
import { tagOpener, tagTitle } from './tag-press'
import { parsed } from '../test/parsed'

/** Somewhere to park the caret that is outside every tag under test. */
const PARK = '\n\nx'

function state(
  doc: string,
  at = doc.length,
  more: Extension[] = [],
  upTo = doc.length,
): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }), more],
    }),
    upTo,
  )
}

/** The words the parser read as tags. */
function parsedTags(doc: string): string[] {
  const out: string[] = []
  syntaxTree(state(doc)).iterate({
    enter: (node) => {
      if (node.name === 'Hashtag') out.push(doc.slice(node.from, node.to))
    },
  })
  return out
}

/** Every tag the preview drew, with its class and the name it carries. */
function pills(doc: string, at?: number, more: Extension[] = []) {
  const full = at === undefined ? doc + PARK : doc
  const out: { text: string; className: string; tag: string; title?: string }[] = []

  buildDecorations(state(full, at ?? full.length, more)).decorations.between(
    0,
    full.length,
    (from, to, value) => {
      const spec = value.spec as {
        class?: string
        attributes?: Record<string, string>
      }
      if (!spec.class?.split(' ').includes('tag')) return
      out.push({
        text: full.slice(from, to),
        className: spec.class,
        tag: spec.attributes?.['data-tag'] ?? '',
        ...(spec.attributes?.title ? { title: spec.attributes.title } : {}),
      })
    },
  )

  return out
}

describe('what the parser reads as a tag', () => {
  test('a hash opening a word, then a name', () => {
    expect(parsedTags('Filed under #work and (#aside), #b2')).toEqual(['#work', '#aside', '#b2'])
  })

  test('nested is one tag, and it stops where the name does', () => {
    expect(parsedTags('#work/nib/canvas, then #tag. And #tag’s')).toEqual([
      '#work/nib/canvas',
      '#tag',
      '#tag',
    ])
  })

  test('in a heading’s words, a list item and a quote', () => {
    expect(parsedTags('## Plan #work\n\n- #item\n\n> #quoted')).toEqual([
      '#work',
      '#item',
      '#quoted',
    ])
  })

  test('never a heading, a number, a word’s middle or an escaped hash', () => {
    expect(parsedTags('# Heading\n\n#42 and C#sharp and a#b and \\#not')).toEqual([])
  })

  test('never in code, maths, a comment, an address or a tag of HTML', () => {
    const doc = [
      '`#code` and $#x$ and %%#hidden%% and <!-- #gone -->',
      '',
      '```',
      '#fenced',
      '```',
      '',
      'https://nib.dev/#top and <https://nib.dev/#also> and <a href="#x">',
    ].join('\n')

    expect(parsedTags(doc)).toEqual([])
  })

  test('never in the front matter, where the tags are YAML', () => {
    expect(parsedTags('---\ntags: [one]\n# comment\n---\n\n#body')).toEqual(['#body'])
  })
})

describe('a tag in the preview', () => {
  test('is a pill carrying its name, the hash inside it', () => {
    expect(pills('Filed under #work/nib today')).toEqual([
      { text: '#work/nib', className: 'tag', tag: 'work/nib' },
    ])
  })

  test('reads as its source while the caret is in it, and as a pill again after', () => {
    const doc = 'Filed #work today'
    const inside = doc.indexOf('work') + 2

    expect(pills(doc, inside)).toEqual([{ text: '#work', className: 'tag is-open', tag: 'work' }])
    expect(pills(doc, doc.length)).toEqual([{ text: '#work', className: 'tag', tag: 'work' }])
  })

  test('is left to the link it is written in', () => {
    expect(pills('[see #this](https://nib.dev) and ![#alt](pic.png)')).toEqual([])
  })

  test('promises a press only in an editor that can answer one', () => {
    expect(pills('A #tag')[0]?.title).toBeUndefined()

    const asked: string[] = []
    const answering = tagOpener.of((tag) => asked.push(tag))
    const [pill] = pills('A #tag', undefined, [answering])

    expect(pill?.title).toBe(tagTitle(state('', 0, [answering])))
    expect(pill?.title).toMatch(/search the tag/)
  })
})

describe('the preview’s work on tags', () => {
  test('is the viewport’s, however long the note', () => {
    // A note of two thousand tagged lines and a window onto thirty of them: the
    // decorations are built for what is on screen, so the pills counted are the
    // visible ones and nothing is spent on the rest. The same pass over a note twenty
    // times shorter draws exactly as many. Twenty times shows a count that grows with
    // the note as well as a hundred did; ten thousand lines made into a state were
    // seconds of a machine running three gates, against the five this test has.
    const line = (n: number) => `Line ${n} is filed under #work/n${n} and #reading.`
    const long = Array.from({ length: 2_000 }, (_, n) => line(n)).join('\n')
    const short = Array.from({ length: 100 }, (_, n) => line(n)).join('\n')

    const window = (doc: string) => {
      const from = doc.indexOf(line(40))
      const to = doc.indexOf(line(70))
      return { from, to }
    }

    // Parsed as far as the window, which is all a viewport's pass reads: parsing the
    // whole note was most of this test's time, twice, and nothing it asks about.
    const counted = (doc: string) => {
      const shown = window(doc)
      const built = buildDecorations(state(doc, 0, [], shown.to), [shown])
      let tags = 0
      built.decorations.between(0, doc.length, (_from, _to, value) => {
        if ((value.spec as { class?: string }).class === 'tag') tags++
      })
      return tags
    }

    const drawn = counted(long)
    expect(drawn).toBe(counted(short))
    // Lines 40 to 69, two tags each: the window ends where line 70 starts.
    expect(drawn).toBe(30 * 2)
  })
})
