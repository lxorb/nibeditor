import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
// The emoji table handed over outright: in the app it is fetched the first time a note
// turns out to have a `:shortcode:` in it, and what is being built here is one pass of
// decorations with no frame after it to fill anything in. See @nib/markdown/engines.
import '@nib/markdown/eager'
import { buildDecorations } from './decorate'
import { FenceHeaderWidget } from './widgets'
import { buildBlockDecorations } from './blocks'
import { trustedMarkup } from '../markup'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

/** Somewhere to park the caret that is outside every construct under test. */
const PARK = '\n\nx'

function state(doc: string, cursor: number, trusted = false) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        trustedMarkup(trusted),
      ],
    }),
  )
}

/** Text the reader never sees. Without a cursor, the caret parks off the sample. */
function concealed(doc: string, cursor?: number, trusted = false): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length
  const { atomic } = buildDecorations(state(full, pos, trusted))

  const out: string[] = []
  atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

/** Whole-line constructs replaced by a rendered block: math and diagrams. */
function blocks(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length

  const out: string[] = []
  buildBlockDecorations(state(full, pos)).between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

/** Syntax shown as characters, tagged for the ink-bleed animation. */
function revealedMeta(doc: string, cursor: number): string[] {
  const { decorations } = buildDecorations(state(doc, cursor))
  const out: string[] = []
  decorations.between(0, doc.length, (from, to, value) => {
    if (value.spec.class === 'md-meta') out.push(doc.slice(from, to))
  })
  return out
}

/** Ranges carrying a given decoration class. */
function marked(doc: string, className: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length

  const out: string[] = []
  buildDecorations(state(full, pos)).decorations.between(0, full.length, (from, to, value) => {
    if (value.spec.class === className) out.push(full.slice(from, to))
  })
  return out
}

/** What a decoration's spec carries that these tests read. CodeMirror types
 *  `spec` as whatever the caller passed, so the two fields are named here rather
 *  than reached for blind. */
interface Spec {
  class?: string
  widget?: unknown
  attributes?: Record<string, string>
}

/** The `data-callout` every line carries, in document order. */
function lineAttrs(doc: string): string[] {
  const full = doc + PARK
  const out: string[] = []
  buildDecorations(state(full, full.length)).decorations.between(
    0,
    full.length,
    (from, to, value) => {
      const spec = value.spec as Spec
      const written = spec.attributes?.['data-callout']
      if (from === to && !spec.widget && written) out.push(written)
    },
  )
  return out
}

/** Every class given to a whole line, in document order. */
function lineClasses(doc: string): string[] {
  const full = doc + PARK
  const out: string[] = []
  buildDecorations(state(full, full.length)).decorations.between(
    0,
    full.length,
    (from, to, value) => {
      const spec = value.spec as Spec
      // Line decorations are the only empty ranges that carry no widget.
      if (from === to && !spec.widget && spec.class) out.push(...spec.class.split(' '))
    },
  )
  return out
}

describe('headings', () => {
  test('hides the hash and its trailing space when the caret is elsewhere', () => {
    expect(concealed('# Title')).toEqual(['# '])
  })

  test('reveals the hash when the caret is on the heading line', () => {
    expect(concealed('# Title\n\nbody', 3)).toEqual([])
    expect(revealedMeta('# Title\n\nbody', 3)).toEqual(['# '])
  })

  test('covers all six levels', () => {
    expect(concealed('###### Six')).toEqual(['###### '])
  })
})

describe('inline emphasis', () => {
  test('hides both markers of an inactive bold span', () => {
    expect(concealed('a **bold** b')).toEqual(['**', '**'])
  })

  test('reveals only the span the caret sits in', () => {
    const doc = '**one** and **two**'
    expect(revealedMeta(doc, 3)).toEqual(['**', '**'])
    expect(concealed(doc, 3)).toEqual(['**', '**'])
  })

  test('handles italic, strikethrough, subscript and superscript', () => {
    expect(concealed('_i_ ~~s~~ H~2~O X^2^')).toEqual(['_', '_', '~~', '~~', '~', '~', '^', '^'])
  })
})

describe('links', () => {
  test('leaves only the label visible', () => {
    expect(concealed('see [docs](https://x.dev "t") now')).toEqual([
      '[',
      ']',
      '(',
      'https://x.dev',
      '"t"',
      ')',
    ])
  })
})

describe('code', () => {
  test('hides inline backticks', () => {
    expect(concealed('run `npm i` first')).toEqual(['`', '`'])
  })

  test('hides fence markers and the language tag', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })

  // Both delimiters come back together, so the block's extent stays obvious
  // wherever in it the caret happens to be.
  test('reveals both fence markers when the caret is on the opening line', () => {
    expect(revealedMeta('```js\nlet x\n```\n', 2)).toEqual(['```', 'js', '```'])
  })

  test('reveals both fence markers from inside the code', () => {
    expect(concealed('```js\nlet x\n```\n', 8)).toEqual([])
  })

  test('reveals both fence markers from the closing line', () => {
    expect(concealed('```js\nlet x\n```\n', 14)).toEqual([])
  })

  test('hides them again once the caret leaves the block', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })

  test('leaves a neighbouring fence hidden', () => {
    const doc = '```js\na\n```\n\n```py\nb\n```\n'
    expect(concealed(doc, 8)).toEqual(['```', 'py', '```'])
  })
})

/** The gutter beside a code block. What the stylesheet draws is a pseudo-element
 *  per line reading these, so the numbers are never text of the document; the
 *  rules are in editor.css in @nib/themes. */
describe('code line numbers', () => {
  /** Each line of code, as the number it is given and the width of the column
   *  it is drawn in. A line with no number is one of the block's own fences. */
  function gutter(doc: string): { number: string | null; digits: string | undefined }[] {
    const full = doc + PARK
    const out: { number: string | null; digits: string | undefined }[] = []

    buildDecorations(state(full, full.length)).decorations.between(
      0,
      full.length,
      (from, to, value) => {
        const spec = value.spec as Spec
        if (from !== to || spec.widget || !spec.class?.split(' ').includes('nib-code')) return
        out.push({
          number: spec.attributes?.['data-code-number'] ?? null,
          digits: spec.attributes?.style,
        })
      },
    )

    return out
  }

  function numbers(doc: string): (string | null)[] {
    return gutter(doc).map((line) => line.number)
  }

  test('numbers the code and not the fences around it', () => {
    expect(numbers('```js\nlet a = 1\nlet b = 2\n```')).toEqual([null, '1', '2', null])
  })

  test('counts from one per block rather than per note', () => {
    const doc = 'words\n\n```\na\nb\n```\n\nmore\n\n```\nc\n```'
    expect(numbers(doc)).toEqual([null, '1', '2', null, null, '1', null])
  })

  test('numbers every line of an indented block, its first included', () => {
    expect(numbers('text\n\n    a\n    b\n    c')).toEqual(['1', '2', '3'])
  })

  test('a blank line inside a fence is a line like any other', () => {
    expect(numbers('```\na\n\nb\n```')).toEqual([null, '1', '2', '3', null])
  })

  test('the column is as wide as the block needs and no wider', () => {
    // Nine lines of code want one digit; ten want two. Read off the block's own
    // count, not the note's - a fence far down a long note still starts at one.
    const nine = `\`\`\`\n${'a\n'.repeat(9)}\`\`\``
    expect(gutter(nine).map((line) => line.digits)).toEqual(
      Array.from({ length: 11 }, () => '--code-digits:1'),
    )

    const ten = `\`\`\`\n${'a\n'.repeat(10)}\`\`\``
    expect(new Set(gutter(ten).map((line) => line.digits))).toEqual(new Set(['--code-digits:2']))

    // The fences carry the width as well, so the code keeps one left edge.
    expect(gutter('x\n\n```\na\n```').every((line) => line.digits === '--code-digits:1')).toBe(true)
  })

  test('the number rides on the line, so nothing selects or copies it', () => {
    // Not a widget and not text: a line decoration carrying an attribute, which
    // only a pseudo-element reads. A selection over the block takes the code.
    const doc = '```\nlet a = 1\n```'
    const full = doc + PARK
    let carried = 0

    buildDecorations(state(full, full.length)).decorations.between(
      0,
      full.length,
      (from, to, value) => {
        const spec = value.spec as Spec
        if (!spec.attributes?.['data-code-number']) return
        carried += 1
        expect(from).toBe(to)
        expect(spec.widget).toBeUndefined()
      },
    )

    expect(carried).toBe(1)
  })

  test('a rendered diagram has no lines to number', () => {
    expect(numbers('```mermaid\ngraph TD\nA-->B\n```')).toEqual([])
  })
})

/** A tag pointing at a page somewhere else is that page's card here, the same one
 *  the reading view and a published page show. Nothing is fetched for it: the card
 *  is markup, and the frame arrives when it is pressed. See web-embed.ts. */
describe('an <iframe> in the text', () => {
  const TAG = '<iframe src="https://field.example.test/plan"></iframe>'

  test('is replaced by the card that stands for it', () => {
    expect(concealed(TAG)).toEqual([TAG])
  })

  test('and is the tag again while the caret is in it', () => {
    expect(concealed(TAG, 10)).toEqual([])
  })

  test('inside a sentence the closing half goes with it', () => {
    // Two nodes there rather than one, and the card stands for both: a card
    // followed by a visible `</iframe>` would be the markup half shown.
    expect(concealed(`See ${TAG} here.`)).toEqual([TAG.slice(0, -9), '</iframe>'])
  })

  test('and both halves come back with the caret in either', () => {
    expect(concealed(`See ${TAG} here.`, 10)).toEqual([])
    expect(concealed(`See ${TAG} here.`, 4 + TAG.length - 4)).toEqual([])
  })

  test('a tag a browser would not frame is left as it was written', () => {
    expect(concealed('<iframe src="javascript:alert(1)"></iframe>')).toEqual([])
    expect(concealed('<iframe></iframe>')).toEqual([])
  })
})

/** A backslash before a character is how markdown says "this one is a
 *  character, not a marker". It is a marker itself, so it is hidden the way
 *  every other marker is, and shown again when the caret is on it. A pasted tag
 *  arrives written this way - see `from-html` in @nib/markdown - so a page
 *  copied into a note used to read back with a backslash in front of every tag. */
describe('escapes', () => {
  test('hides the backslash and keeps the character', () => {
    expect(concealed('a \\* b')).toEqual(['\\'])
    expect(concealed('a \\< b')).toEqual(['\\'])
    expect(concealed('a \\[x] b')).toEqual(['\\'])
  })

  test('shows it again with the caret on it', () => {
    expect(concealed('a \\* b', 3)).toEqual([])
  })

  test('leaves a lone backslash alone', () => {
    expect(concealed('a \\ b')).toEqual([])
  })

  test('a backslash inside code is code', () => {
    expect(concealed('`a \\* b`')).toEqual(['`', '`'])
  })
})

describe('blocks', () => {
  test('hides the quote marker', () => {
    expect(concealed('> quoted')).toEqual(['> '])
  })

  test('replaces a horizontal rule', () => {
    expect(concealed('a\n\n---')).toEqual(['---'])
  })

  test('replaces a bullet marker', () => {
    expect(concealed('- one\n- two')).toEqual(['-', '-'])
  })

  test('replaces the task marker and the bullet before it', () => {
    expect(concealed('- [x] done')).toEqual(['- ', '[x]'])
  })

  test('replaces the whole table with a rendered one', () => {
    expect(blocks('| a |\n| - |\n| 1 |')).toEqual(['| a |\n| - |\n| 1 |'])
    expect(concealed('| a |\n| - |\n| 1 |')).toEqual([])
  })

  test('falls back to source while the caret is in the table', () => {
    expect(blocks('| a |\n| - |\n| 1 |', 8)).toEqual([])
  })
})

describe('images', () => {
  test('replaces the whole image with a rendered widget', () => {
    expect(concealed('![alt](pic.png)')).toEqual(['![alt](pic.png)'])
  })

  test('shows the source once the caret enters it', () => {
    expect(concealed('![alt](pic.png)', 3)).toEqual([])
    expect(revealedMeta('![alt](pic.png)', 3)).toEqual(['![', ']', '(', 'pic.png', ')'])
  })

  test('stays a picture with the caret beside it', () => {
    expect(concealed('![alt](pic.png)', 0)).toEqual(['![alt](pic.png)'])
    expect(concealed('![alt](pic.png)', 15)).toEqual(['![alt](pic.png)'])
  })

  test('stays a picture while it is selected', () => {
    const doc = '![alt](pic.png)'
    const selected = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.range(0, doc.length),
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )

    const out: string[] = []
    buildDecorations(selected).atomic.between(0, doc.length, (from, to) => {
      out.push(doc.slice(from, to))
    })
    expect(out).toEqual([doc])
  })

  test('renders a resized image written as an img tag', () => {
    const tag = '<img src="pic.png" alt="a" style="zoom:60%" />'
    expect(concealed(`text ${tag} more`)).toEqual([tag])
  })

  test('leaves other inline HTML alone', () => {
    expect(concealed('text <span>plain</span> more')).toEqual([])
  })

  test('renders a page break', () => {
    const tag = '<div style="page-break-after: always;"></div>'
    expect(concealed(`a\n\n${tag}\n\nb`)).toEqual([tag])
  })

  test('treats a flow fence as a diagram', () => {
    expect(blocks('```flow\nst=>start: Go\n```')).toEqual(['```flow\nst=>start: Go\n```'])
  })

  test('draws a chart fence, and leaves one holding no chart as code', () => {
    const chart = '```chart\nseries:\n  - data: [1, 2]\n```'
    expect(blocks(chart)).toEqual([chart])
    // Nothing to draw: it stays code, which is how nib says it could not read one.
    expect(blocks('```chart\nnot a chart\n```')).toEqual([])
  })

  test('an address a provider answers for is that page, not a picture', () => {
    const written = '![](https://youtu.be/dQw4w9WgXcQ)'
    expect(concealed(written)).toEqual([written])
    // And the markup is reachable, like every other rendered thing.
    expect(concealed(written, 4)).toEqual([])
  })

  test('an address nobody answers for is still a picture', () => {
    expect(concealed('![](https://example.test/a.png)')).toEqual([
      '![](https://example.test/a.png)',
    ])
  })
})

describe('extensions', () => {
  test('replaces inline math with a rendered widget', () => {
    expect(concealed('mass $E=mc^2$ here')).toEqual(['$E=mc^2$'])
  })

  test('reveals math source when the caret enters it', () => {
    expect(revealedMeta('mass $E=mc^2$ here', 8)).toEqual(['$', '$'])
  })

  test('replaces a block math fence', () => {
    expect(blocks('$$\nE = mc^2\n$$')).toEqual(['$$\nE = mc^2\n$$'])
  })

  test('replaces a whole line of $$…$$ the same way', () => {
    expect(blocks('$$E = mc^2$$')).toEqual(['$$E = mc^2$$'])
  })

  test('replaces a known emoji shortcode', () => {
    expect(concealed('ship it :rocket: now')).toEqual([':rocket:'])
  })

  test('leaves an unknown shortcode alone', () => {
    expect(concealed('a :not_an_emoji_name: b')).toEqual([])
  })

  test('shows the shortcode when the caret is on it', () => {
    expect(concealed('ship :rocket: now', 8)).toEqual([])
  })

  test('hides highlight markers', () => {
    expect(concealed('a ==marked== b')).toEqual(['==', '=='])
  })

  test('hides footnote reference brackets', () => {
    expect(concealed('text[^1] more')).toEqual(['[^', ']'])
  })

  test('draws front matter as its rows, and shows the source with the caret in it', () => {
    const note = '---\ntitle: Hi\n---\n\nbody'
    // The whole block is one replacement now, so there are no fences left to
    // conceal one at a time; see live-preview/properties.ts.
    expect(blocks(note)).toEqual(['---\ntitle: Hi\n---'])
    expect(blocks(note, 6)).toEqual([])
  })

  test('and hides the fences of a block it cannot draw as rows', () => {
    // A shape @nib/markdown will not guess at stays source, and source is
    // decorated here the way it always was.
    const note = '---\njust some words\n---\n\nbody'
    expect(blocks(note)).toEqual([])
    expect(concealed(note)).toEqual(['---', '---'])
  })

  test('replaces a callout tag with its label', () => {
    expect(concealed('> [!NOTE]\n> careful')).toEqual(['> ', '[!NOTE]', '> '])
  })

  test('takes the fold sign with the tag: it says how a callout opens, not a word', () => {
    expect(concealed('> [!warning]- Shut\n> behind it')).toEqual(['> ', '[!warning]-', '> '])
    expect(concealed('> [!warning]+ Open\n> in front')).toEqual(['> ', '[!warning]+', '> '])
  })

  test('marks a callout with the look it wears, an alias resolved', () => {
    expect(lineClasses('> [!tldr]\n> the short of it')).toContain('nib-callout-abstract')
  })

  test('marks a type it has never heard of as a callout, with no look at all', () => {
    const classes = lineClasses('> [!recipe]\n> flour and water')
    expect(classes).toContain('nib-callout')
    expect(classes.some((one) => one.startsWith('nib-callout-'))).toBe(false)
  })

  test('carries the type as written, so a theme can reach any of them', () => {
    expect(lineAttrs('> [!recipe]\n> flour and water')).toContain('recipe')
    expect(lineAttrs('> [!TLDR]\n> the short of it')).toContain('tldr')
  })

  test('leaves a quote that names no type a quote', () => {
    expect(lineClasses('> just a quote')).not.toContain('nib-callout')
  })

  /** A note to the writer, hidden here the way it is hidden in the reading view,
   *  in every export and on a published page; see comments.ts in @nib/markdown. */
  test('hides an HTML comment, block or inline', () => {
    expect(concealed('<!-- a note -->')).toEqual(['<!-- a note -->'])
    expect(concealed('words <!-- aside --> more')).toEqual(['<!-- aside -->'])
  })

  test('hides Obsidian’s comment the same way', () => {
    expect(concealed('%% a note %%')).toEqual(['%% a note %%'])
    expect(concealed('words %% aside %% more')).toEqual(['%% aside %%'])
  })

  test('shows Obsidian’s comment again while the caret is inside it', () => {
    expect(concealed('%% a note %%\n\nbody', 4)).toEqual([])
  })

  test('leaves a lone pair of percents alone', () => {
    expect(concealed('a 50%% b')).toEqual([])
  })

  test('shows the comment again while the caret is inside it', () => {
    expect(concealed('<!-- a note -->\n\nbody', 6)).toEqual([])
  })

  test('replaces a mermaid fence with a diagram', () => {
    expect(blocks('```mermaid\ngraph TD;\nA-->B;\n```')).toEqual([
      '```mermaid\ngraph TD;\nA-->B;\n```',
    ])
  })

  test('leaves a diagram fence as source while the caret is inside', () => {
    expect(blocks('```mermaid\ngraph TD;\n```', 14)).toEqual([])
  })

  test('leaves a normal code fence as code', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })
})

describe('document integrity', () => {
  test('decorating never rewrites the document', () => {
    const doc = '# H\n\n**b** _i_ `c` [l](u)\n\n- [ ] t\n\n> q\n\n---\n\n```js\nx\n```\n'
    const before = state(doc, 0)
    buildDecorations(before)
    expect(before.doc.toString()).toBe(doc)
  })

  test('concealed ranges never overlap', () => {
    const doc = '# H\n\n![a](b) **c** `d`\n\n- [x] e\n\n| f |\n| - |\n| g |\n'
    const { atomic } = buildDecorations(state(doc, doc.length - 1))

    let previousEnd = -1
    atomic.between(0, doc.length, (from, to) => {
      expect(from).toBeGreaterThanOrEqual(previousEnd)
      previousEnd = to
    })
  })
})

describe('definition lists and abbreviations', () => {
  test('hides the colon that opens a definition', () => {
    expect(concealed('Term\n: a meaning')).toContain(':')
  })

  test('shows the colon again when the caret is on the line', () => {
    expect(concealed('Term\n: a meaning', 8)).not.toContain(':')
  })

  test('hides the punctuation around an abbreviation definition', () => {
    const hidden = concealed('*[HTML]: Markup')
    expect(hidden).toContain('*[')
    expect(hidden).toContain(']:')
  })

  test('leaves a bare colon in prose alone', () => {
    expect(concealed('Note: prose')).not.toContain(':')
  })
})

describe('inline code', () => {
  test('frames the span so it reads apart from prose', () => {
    expect(marked('run `npm test` now', 'nib-inline-code')).toEqual(['`npm test`'])
  })

  test('leaves a fenced block to the block styling', () => {
    expect(marked('```\nnpm test\n```', 'nib-inline-code')).toEqual([])
  })

  test('still hides its backticks when the caret is away', () => {
    expect(concealed('a `code` b')).toEqual(['`', '`'])
  })
})

describe('headings', () => {
  test('every depth styles its line as that depth', () => {
    for (let depth = 1; depth <= 6; depth++) {
      expect(lineClasses(`${'#'.repeat(depth)} Title`)).toContain(`nib-h${depth}`)
    }
  })

  test('the two underlined forms style theirs as the level they mean', () => {
    expect(lineClasses('Title\n=====')).toContain('nib-h1')
    expect(lineClasses('Title\n-----')).toContain('nib-h2')
  })

  test('seven hashes are not a heading', () => {
    expect(lineClasses('####### Title').filter((one) => one.startsWith('nib-h'))).toEqual([])
  })
})

describe('an unclosed fence', () => {
  const doc = '```\n# Title\n\n**bold**'

  test('conceals nothing of its own', () => {
    expect(concealed(doc)).toEqual(['# ', '**', '**'])
  })

  test('does not restyle the lines below it as code', () => {
    expect(lineClasses(doc)).not.toContain('nib-code')
    expect(lineClasses(doc)).toContain('nib-h1')
  })

  test('is styled as code once closed', () => {
    expect(lineClasses('```\n# Title\n```')).toContain('nib-code')
    expect(lineClasses('```\n# Title\n```')).not.toContain('nib-h1')
  })
})

describe('links', () => {
  function linkMarks(doc: string, cursor?: number): { text: string; href: string | null }[] {
    const full = cursor === undefined ? doc + PARK : doc
    const out: { text: string; href: string | null }[] = []
    buildDecorations(state(full, cursor ?? full.length)).decorations.between(
      0,
      full.length,
      (from, to, value) => {
        if (value.spec.class === 'nib-link') {
          out.push({
            text: full.slice(from, to),
            href: value.spec.attributes?.['data-href'] ?? null,
          })
        }
      },
    )
    return out
  }

  test('the label of a link carries its target', () => {
    expect(linkMarks('see [docs](https://x.dev) now')).toEqual([
      { text: 'docs', href: 'https://x.dev' },
    ])
  })

  test('a bare address stays visible and is the link', () => {
    const doc = 'go to https://bare.dev/p?q=1 now'
    expect(concealed(doc)).toEqual([])
    expect(linkMarks(doc)).toEqual([
      { text: 'https://bare.dev/p?q=1', href: 'https://bare.dev/p?q=1' },
    ])
  })

  test('an autolink hides its brackets and shows the address', () => {
    const doc = 'see <https://angle.dev> now'
    expect(concealed(doc)).toEqual(['<', '>'])
    expect(linkMarks(doc)).toEqual([{ text: 'https://angle.dev', href: 'https://angle.dev' }])
  })

  test('a www address gets its scheme', () => {
    expect(linkMarks('see www.w.dev now')).toEqual([
      { text: 'www.w.dev', href: 'https://www.w.dev' },
    ])
  })

  test('an anchor in the same document is styled but is not a browser link', () => {
    expect(linkMarks('see [below](#heading) now')).toEqual([{ text: 'below', href: null }])
  })

  test('a target inside the space is a link between notes, not a browser link', () => {
    // Which is `data-note` rather than `data-href`; see the wikilink tests.
    expect(linkMarks('see [other](notes/other.md) now')).toEqual([])
  })
})

describe('underline', () => {
  test('hides both tags and underlines the text between them', () => {
    expect(concealed('a <u>under lined</u> b')).toEqual(['<u>', '</u>'])
    expect(marked('a <u>under lined</u> b', 'nib-underline')).toEqual(['under lined'])
  })

  test('shows the tags while the caret is between them', () => {
    expect(concealed('a <u>under lined</u> b', 8)).toEqual([])
    expect(revealedMeta('a <u>under lined</u> b', 8)).toEqual(['<u>', '</u>'])
  })

  test('pairs nested underlines from the inside out', () => {
    expect(concealed('<u>a <u>b</u> c</u>')).toEqual(['<u>', '<u>', '</u>', '</u>'])
    expect(marked('<u>a <u>b</u> c</u>', 'nib-underline')).toEqual(['a <u>b</u> c', 'b'])
  })

  test('leaves an opener without a closer alone', () => {
    expect(concealed('a <u>open b')).toEqual([])
    expect(marked('a <u>open b', 'nib-underline')).toEqual([])
  })

  test('leaves other inline tags alone', () => {
    expect(concealed('a <b>bold</b> b')).toEqual([])
  })
})

/** Ten blocks of a thousand characters each, which is an ordinary page of notes
 *  about code and is rebuilt on every keystroke. */
const BODY = 'const x = 1 // padding to make this line long enough to matter\n'.repeat(16)
const MANY_FENCES = Array.from({ length: 10 }, () => `\`\`\`js\n${BODY}\`\`\`\n\n`).join('')

/** The headers drawn on the top line of each block. */
function headers(doc: string, cursor: number): FenceHeaderWidget[] {
  const { decorations } = buildDecorations(state(doc, cursor))
  const found: FenceHeaderWidget[] = []

  decorations.between(0, doc.length, (_from, _to, value) => {
    const widget: unknown = value.spec.widget
    if (widget instanceof FenceHeaderWidget) found.push(widget)
  })

  return found
}

/** How many characters of the document get sliced out of it while the decorations
 *  are built. Counted on the document itself, so every reader of it is counted. */
function slicedWhileBuilding(doc: string, cursor: number): number {
  const built = state(doc, cursor)
  const text = built.doc
  const real = text.sliceString.bind(text)
  let chars = 0

  Object.defineProperty(text, 'sliceString', {
    configurable: true,
    value: (from: number, to?: number, lineSep?: string) => {
      chars += (to ?? text.length) - from
      return real(from, to, lineSep)
    },
  })

  buildDecorations(built)
  return chars
}

describe('what a keystroke in a note full of code costs', () => {
  test('the headers read none of the code they sit on', () => {
    // The header used to be built with the block's code in hand, so every
    // keystroke sliced all ten bodies out of the document - ten thousand
    // characters - to draw ten rows that show a language and two buttons.
    expect(headers(MANY_FENCES, MANY_FENCES.length)).toHaveLength(10)
    expect(slicedWhileBuilding(MANY_FENCES, MANY_FENCES.length)).toBeLessThan(BODY.length)
  })

  test('and typing inside a block leaves its header as it was', () => {
    // Which is what the widget comparison decides. Comparing the code meant the
    // whole of every visible body, character by character, on each keystroke -
    // and then a row rebuilt for a change that never showed in it.
    const one = headers('```js\nlet a = 1\n```\n\nx', 22)[0]
    const other = headers('```js\nlet a = 12\n```\n\nx', 23)[0]

    expect(one && other && one.eq(other)).toBe(true)
  })

  test('but a header whose own words changed is drawn again', () => {
    const one = headers('```js\nlet a = 1\n```\n\nx', 22)[0]
    const other = headers('```ts setup\nlet a = 1\n```\n\nx', 28)[0]

    expect(one && other && one.eq(other)).toBe(false)
  })
})

/** A block of the note's own HTML that runs rather than shows: a `<div>` and the
 *  `<script>` that fills it in.
 *
 *  The reading view has drawn the sandboxed click-to-load card for one of these all
 *  along and the editor drew nothing at all, so half a note was invisible while it
 *  was being written. The same card here, out of the same markup - see
 *  html-block.ts - and only where the app says this document's HTML is markup;
 *  markup.ts is what carries that answer in. */
describe('an interactive block of HTML', () => {
  const BLOCK = '<div id="here"></div>\n<script>document.body.textContent = 1</script>'

  test('is replaced by the card that stands for it', () => {
    expect(concealed(BLOCK, undefined, true)).toEqual([BLOCK])
  })

  test('is the markup again while the caret is in it', () => {
    expect(concealed(BLOCK, 4, true)).toEqual([])
  })

  test('stays the characters it is made of where the HTML is not trusted', () => {
    expect(concealed(BLOCK)).toEqual([])
  })

  /** HTML that only shows something needs no card and never did: it goes through the
   *  renderer as markup, and in the editor it is the markup it is. */
  test('leaves a block that only shows something alone', () => {
    expect(concealed('<div class="card">\n  <p>Wind.</p>\n</div>', undefined, true)).toEqual([])
  })

  test('is the card whatever the note wrote around the script', () => {
    const inline = '<div>\n<script>\nlet a = 1\n</script>\n</div>'

    expect(concealed(inline, undefined, true)).toEqual([inline])
  })
})
