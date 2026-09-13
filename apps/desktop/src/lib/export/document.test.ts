import { describe, expect, test } from 'vitest'
import { CORPUS, CORPUS_NAME } from './corpus'
import { type Block, documentOf, picturesIn, type Span, titleOf } from './document'

const doc = documentOf(CORPUS, CORPUS_NAME)

/** The blocks of one kind, so a test says what it is about rather than counting
 *  its way to an index. */
function kind<K extends Block['kind']>(k: K): Extract<Block, { kind: K }>[] {
  return doc.blocks.filter((block): block is Extract<Block, { kind: K }> => block.kind === k)
}

const words = (spans: readonly Span[]) => spans.map((span) => span.text).join('')

describe('the document a note comes to', () => {
  test('takes its title, author, language and date from the front matter', () => {
    expect(doc.title).toBe('Export corpus')
    expect(doc.author).toBe('Ada Lovelace')
    expect(doc.lang).toBe('en')
    expect(doc.date).toBe('2026-09-08')
  })

  test('leaves the front matter itself out of the blocks', () => {
    expect(words(kind('paragraph')[0]?.spans ?? [])).not.toContain('title:')
  })

  /** The shape every export that is not HTML stands on, so this is where a comment
   *  is kept out of Word, RTF, ePub and plain text at once; see comments.ts in
   *  @nib/markdown for the rest of the paths. */
  test('leaves a comment the writer wrote out of the blocks', () => {
    const commented = documentOf('# Head\n\n<!-- to myself -->\n\nWords.\n', 'Note.md')
    const said = commented.blocks
      .flatMap((block) => ('spans' in block ? block.spans : []))
      .map((span) => span.text)
      .join('')

    expect(said).not.toContain('to myself')
    expect(said).toContain('Words.')
  })

  test('keeps a comment that is inside a code fence, which the fence is showing', () => {
    const fenced = documentOf('```html\n<!-- kept -->\n```\n', 'Note.md')
    expect(
      fenced.blocks.some((block) => 'code' in block && block.code.includes('<!-- kept -->')),
    ).toBe(true)
  })

  test('keeps the headings with their levels', () => {
    expect(kind('heading').map((one) => [one.level, words(one.spans)])).toEqual([
      [1, 'Export corpus'],
      [2, 'A table'],
      [2, 'Code'],
      [2, 'Display maths'],
      [2, 'Pictures'],
      [2, 'Links and lists'],
      [2, 'Diagram'],
    ])
  })
})

describe('the marks on a run', () => {
  const spans = kind('paragraph')[0]?.spans ?? []
  const marked = (mark: keyof Span) =>
    spans.filter((span) => span[mark] === true).map((s) => s.text)

  test('finds bold, italic, struck and marked text', () => {
    expect(marked('bold')).toEqual(['bold'])
    expect(marked('italic')).toEqual(['italic'])
    expect(marked('strike')).toEqual(['struck'])
    expect(marked('mark')).toEqual(['marked'])
  })

  test('finds code, superscript and subscript', () => {
    expect(marked('code')).toEqual(['inline code'])
    expect(marked('sub')).toEqual(['2'])
    expect(marked('sup')).toEqual(['2'])
  })

  test('carries a link with the address it points at', () => {
    const link = spans.find((span) => span.href !== undefined)
    expect(link).toEqual({ text: 'link', href: 'https://nibeditor.com' })
  })

  test('carries inline maths as the TeX between the dollars', () => {
    expect(spans.find((span) => span.maths)?.text).toBe('E = mc^2')
  })

  test('carries a footnote reference by the label it named', () => {
    expect(spans.find((span) => span.note !== undefined)?.note).toBe('one')
  })
})

/** A `==highlight==` is one of six colours - the plain one and the five Obsidian
 *  writes an emoji for - and the blocks every document format is written from have
 *  to say which, or Word and RTF can only guess. See highlights.ts in
 *  @nib/markdown, the one place that knows the six. */
describe('the colour a highlight was written in', () => {
  const marks = (source: string) =>
    documentOf(source, 'Note.md')
      .blocks.flatMap((block) => ('spans' in block ? block.spans : []))
      .filter((span) => span.mark === true)

  test('is absent for a highlight that named no colour of its own', () => {
    expect(marks('==marked==\n')).toEqual([{ mark: true, text: 'marked' }])
  })

  test('is the palette tone the emoji names', () => {
    expect(marks('==🔴 careful==\n')).toEqual([{ mark: true, tone: 1, text: 'careful' }])
    expect(marks('==🟠 warm==\n')).toEqual([{ mark: true, tone: 2, text: 'warm' }])
    expect(marks('==🟢 good==\n')).toEqual([{ mark: true, tone: 4, text: 'good' }])
    expect(marks('==🔵 cool==\n')).toEqual([{ mark: true, tone: 5, text: 'cool' }])
    expect(marks('==🟣 odd==\n')).toEqual([{ mark: true, tone: 6, text: 'odd' }])
  })

  test('reaches every run inside the highlight', () => {
    expect(marks('==🟢 a **b** c==\n').map((span) => [span.text, span.tone])).toEqual([
      ['a ', 4],
      ['b', 4],
      [' c', 4],
    ])
  })

  test('never reaches the document as the emoji itself', () => {
    expect(
      marks('==🔴 careful==\n')
        .map((span) => span.text)
        .join(''),
    ).not.toContain('🔴')
  })
})

describe('footnotes', () => {
  test('are gathered out of the flow, with their own words', () => {
    expect(doc.notes).toHaveLength(1)
    expect(doc.notes[0]?.label).toBe('one')
    expect(words(doc.notes[0]?.spans ?? [])).toContain("The footnote's own words")
  })

  test('keep the marks inside them', () => {
    expect(doc.notes[0]?.spans.some((span) => span.bold)).toBe(true)
  })

  test('are not left behind as a paragraph as well', () => {
    const text = kind('paragraph').map((one) => words(one.spans))
    expect(text.some((one) => one.startsWith("The footnote's own words"))).toBe(false)
  })
})

describe('a table', () => {
  const table = kind('table')[0]

  test('keeps its header, its rows and its alignment', () => {
    expect(table?.head.map(words)).toEqual(['Left', 'Middle', 'Right'])
    expect(table?.rows.map((row) => row.map(words))).toEqual([
      ['one', 'alpha', '1'],
      ['two', 'beta', '22'],
    ])
    expect(table?.align).toEqual(['left', 'center', 'right'])
  })
})

describe('a fenced block', () => {
  test('keeps its language and every character of its code', () => {
    const code = kind('code')
    expect(code[0]).toEqual({
      kind: 'code',
      language: 'ts',
      code: 'const answer: number = 42\n  const indented = true',
    })
  })

  test('a diagram is a fence like any other, drawn later or not at all', () => {
    expect(kind('code').at(-1)).toEqual({
      kind: 'code',
      language: 'mermaid',
      code: 'graph TD; A-->B',
    })
  })
})

describe('display maths', () => {
  test('is its own block, holding the TeX as written', () => {
    expect(kind('maths')[0]?.tex.trim()).toBe('\\int_0^1 x^2\\,dx = \\frac{1}{3}')
  })
})

describe('lists', () => {
  const lists = kind('list')

  test('tell a bulleted one from a numbered one', () => {
    expect(lists.map((one) => one.ordered)).toEqual([false, true])
    expect(lists[1]?.start).toBe(1)
  })

  test('keep what is nested under an item as blocks of that item', () => {
    const nested = lists[0]?.items[0]?.blocks[0]
    expect(nested?.kind).toBe('list')
    expect(nested?.kind === 'list' && words(nested.items[0]?.spans ?? [])).toBe('nested bullet')
  })

  test('tell a task apart from a plain item, and done from open', () => {
    expect(lists[0]?.items.map((item) => item.checked)).toEqual([null, true, false])
  })
})

describe('a quote', () => {
  const quotes = kind('quote')

  test('keeps the blocks inside it and the marks inside those', () => {
    const inner = quotes[0]?.blocks[0]
    expect(inner?.kind).toBe('paragraph')
    expect(inner?.kind === 'paragraph' && inner.spans.some((span) => span.bold)).toBe(true)
  })

  test('a callout carries its label, and drops the marker from its words', () => {
    expect(quotes[1]?.label).toBe('Note')
    const inner = quotes[1]?.blocks[0]
    expect(inner?.kind === 'paragraph' && words(inner.spans)).toBe('Careful with that.')
  })

  test('a plain quote has no label', () => {
    expect(quotes[0]?.label).toBeNull()
  })

  test('a title of the writer’s own is the label, and the fold sign is not words', () => {
    // A title is plain words. A mark inside one is not read as markdown, and
    // whichever way it is written none of it leaks into the body below.
    expect(quotes[2]?.label).toBe('The short of it')
    const inner = quotes[2]?.blocks[0]
    expect(inner?.kind === 'paragraph' && words(inner.spans)).toBe(
      'A callout with an alias, a title and a fold sign on it.',
    )
  })
})

describe('the rest of the constructs', () => {
  test('a definition list keeps its term and every meaning under it', () => {
    expect(
      kind('terms')[0]?.entries.map((entry) => [words(entry.term), entry.details.map(words)]),
    ).toEqual([['Markdown', ['A way of writing formatted text.', 'Also the format itself.']]])
  })

  test('a rule and a page break are each their own block', () => {
    expect(kind('rule')).toHaveLength(1)
    expect(kind('break')).toHaveLength(1)
  })

  test('a wikilink reads as the words it showed, alias and all', () => {
    const text = kind('paragraph')
      .map((one) => words(one.spans))
      .join('\n')

    expect(text).toContain('A wikilink to Another note and one with an alias the other.')
    expect(text).not.toContain('[[')
  })
})

describe('an embed on a line of its own', () => {
  const blocks = (source: string) => documentOf(source, 'Note').blocks

  test('an embedded picture is a picture, the way one written `![](…)` is', () => {
    expect(blocks('![[shot.png]]\n')).toEqual([
      { kind: 'paragraph', spans: [{ text: '', picture: 'shot.png' }] },
    ])
    expect(picturesIn(documentOf('![[shot.png]]\n', 'Note'))).toEqual(['shot.png'])
  })

  test('and the words after the bar are what it is of', () => {
    expect(blocks('![[shot.png|the sketch]]\n')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'the sketch', picture: 'shot.png' }] },
    ])
    // A size is not a description.
    expect(blocks('![[shot.png|300]]\n')).toEqual([
      { kind: 'paragraph', spans: [{ text: '', picture: 'shot.png' }] },
    ])
  })

  test('everything else is its name, because a document has no space around it', () => {
    for (const [source, said] of [
      ['![[clip.mp3]]\n', 'clip.mp3'],
      ['![[demo.mp4]]\n', 'demo.mp4'],
      ['![[paper.pdf#page=3]]\n', 'paper.pdf#page=3'],
      ['![[Board.canvas]]\n', 'Board.canvas'],
      ['![[Another note]]\n', 'Another note'],
    ] as const) {
      expect(blocks(source), source).toEqual([{ kind: 'paragraph', spans: [{ text: said }] }])
    }
  })

  test('and never nothing at all', () => {
    // The token carries no children, so before it was answered for here the
    // whole line fell through the walk and left no block behind.
    expect(blocks('before\n\n![[clip.mp3]]\n\nafter\n')).toHaveLength(3)
  })
})

describe('the pictures a document names', () => {
  test('are found in the order they are written, each once', () => {
    expect(picturesIn(doc)).toEqual(['assets/pic.png', 'https://nibeditor.com/remote.jpg'])
  })

  test('carry their words as the span text', () => {
    const spans = doc.blocks
      .filter((block): block is Extract<Block, { kind: 'paragraph' }> => block.kind === 'paragraph')
      .flatMap((block) => block.spans)
      .filter((span) => span.picture !== undefined)

    expect(spans.map((span) => span.text)).toEqual(['Pasted picture', 'Remote picture'])
  })

  test('a picture named twice is listed once', () => {
    const twice = documentOf('![a](x.png)\n\n![b](x.png)\n', 'Note.md')
    expect(picturesIn(twice)).toEqual(['x.png'])
  })

  test('one inside a table cell or a list item is found too', () => {
    const inside = documentOf('| a |\n| - |\n| ![p](t.png) |\n\n- ![q](l.png)\n', 'Note.md')
    expect(picturesIn(inside).sort()).toEqual(['l.png', 't.png'])
  })
})

describe('naming the document', () => {
  test('prefers the front matter, then the first heading, then the file', () => {
    expect(titleOf('---\ntitle: Meta\n---\n# Head\n', 'File.md')).toBe('Meta')
    expect(titleOf('# Head\n', 'File.md')).toBe('Head')
    expect(titleOf('words\n', 'File.md')).toBe('File')
    expect(titleOf('words\n', 'No extension')).toBe('No extension')
  })

  test('says whether the note named itself or borrowed the file’s name', () => {
    expect(documentOf('---\ntitle: Meta\n---\nwords\n', 'File.md').named).toBe(true)
    expect(documentOf('# Head\n', 'File.md').named).toBe(true)
    expect(documentOf('just words\n', 'File.md').named).toBe(false)
    expect(documentOf('just words\n', 'File.md').title).toBe('File')
  })
})
