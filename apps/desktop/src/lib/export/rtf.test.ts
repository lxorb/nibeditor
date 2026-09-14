import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SETUP, paperTwips } from '../page-setup'
import { documentOf, type Doc } from './document'
import type { Picture } from './pictures'
import { toRtf } from './rtf'

/** The page every test here goes on unless it says otherwise: the A4 the app
 *  defaults to, with its 20 mm margin and no running text. paper.test.ts beside
 *  this is where the page itself is measured. */
const PAPER = paperTwips(DEFAULT_PAGE_SETUP, 'Corpus', '2026-09-14')

/** One of everything the document model knows, so the whole writer is measured
 *  against a single document rather than a fixture per feature. */
const NOTE = `---
title: Corpus
author: Ada Lovelace
lang: de
---

# Corpus

## Prose

Words with **bold**, *italic*, \`code()\`, ~~gone~~, ==marked==, H~2~O, x^2^, a
[link](https://nib.dev/a?b=1&c=2), a note[^one] and $E=mc^2$ in it.

[^one]: The footnote's own words.

## Table

| Left | Middle | Right |
| :--- | :----: | ----: |
| one | two | three |

## Code

\`\`\`ts
const answer = 42
  const nested = answer
\`\`\`

## Maths

$$
\\int_0^1 x\\,dx
$$

## Bullets

- one
  - nested
- two

## Tasks

- [x] done
- [ ] open

## Numbers

1. first
2. second

## Quotes

> Quoted words.

> [!NOTE]
>
> Careful now.

## Terms

Markdown
: A way of writing.
: Also the format.

## Rule

---

## Pictures

![Local picture](assets/pic.png)

![Remote picture](https://pics.example/x.jpg)

<div style="page-break-after: always;"></div>

## End

Last words.
`

function be16Bytes(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function be32Bytes(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }

  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: readonly number[]): number {
  let low = 1
  let high = 0
  for (const byte of bytes) {
    low = (low + byte) % 65521
    high = (high + low) % 65521
  }

  return high * 65536 + low
}

function chunk(type: string, data: readonly number[]): number[] {
  const tagged = [...new TextEncoder().encode(type), ...data]

  return [...be32Bytes(data.length), ...tagged, ...be32Bytes(crc32(tagged))]
}

/** A deflate stream that compresses nothing: the zlib header, one stored block
 *  and the checksum. Enough to make a real PNG without a compressor. */
function stored(raw: readonly number[]): number[] {
  const header = [0x78, 0x01, 0x01]
  const length = [raw.length & 0xff, (raw.length >>> 8) & 0xff]
  const inverse = [~raw.length & 0xff, (~raw.length >>> 8) & 0xff]

  return [...header, ...length, ...inverse, ...raw, ...be32Bytes(adler32(raw))]
}

/** Signature and IHDR only. The writer reads the size out of those two and
 *  never looks further, so this is what a picture too big to spell out in a test
 *  file is made of. */
function pngHeader(width: number, height: number): number[] {
  const ihdr = [...be32Bytes(width), ...be32Bytes(height), 8, 0, 0, 0, 0]

  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr)]
}

/** A real grey PNG of the size asked for, built by hand so the test owns every
 *  byte the size is read out of. */
function png(width: number, height: number): Uint8Array {
  const rows: number[] = []
  for (let row = 0; row < height; row += 1) {
    // The nought in front of each row names the filter it uses: none.
    rows.push(0, ...new Array<number>(width).fill(0x80))
  }

  return new Uint8Array([
    ...pngHeader(width, height),
    ...chunk('IDAT', stored(rows)),
    ...chunk('IEND', []),
  ])
}

/** SOI, a baseline frame header, EOI. Only the frame header is ever read. */
function jpeg(width: number, height: number): Uint8Array {
  const frame = [0xff, 0xc0, 0x00, 0x0b, 0x08, ...be16Bytes(height), ...be16Bytes(width)]

  return new Uint8Array([0xff, 0xd8, ...frame, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])
}

function picture(src: string, mime: string, bytes: Uint8Array): Picture {
  return { src, name: src.split('/').pop() ?? src, mime, bytes }
}

/** Brace depth walked from the front, minding the pairs the escaper writes as
 *  two characters. A document that ends anywhere but at nought, or that dips
 *  below it on the way, is one a reader gives up on. */
function braces(rtf: string): { end: number; lowest: number } {
  let depth = 0
  let lowest = 0

  for (let at = 0; at < rtf.length; at += 1) {
    const char = rtf[at]
    // A backslash takes the character after it along, which keeps `\{` out of
    // the count and costs nothing on a control word.
    if (char === '\\') {
      at += 1
      continue
    }

    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    lowest = Math.min(lowest, depth)
  }

  return { end: depth, lowest }
}

/** The control words that stand for something the reader can see. */
const SHOWN: Record<string, string> = { par: '\n', line: '\n', row: '\n', tab: '\t', cell: '\t' }

/** The document's words with every control word taken off: near enough to what a
 *  reader shows to look for a phrase in, and in the order it would meet them. */
function words(rtf: string): string {
  // The hex of a picture is not words, and it is long enough to hide anything.
  const text = rtf.replace(/\{\\pict[^{}]*\}/g, '')
  let out = ''
  let at = 0

  while (at < text.length) {
    const char = text[at]

    // A newline in the file is the writer's own formatting, never content.
    if (char === '{' || char === '}' || char === '\n') {
      at += 1
      continue
    }

    if (char !== '\\') {
      // The loop stops at the end of the text, so a character read inside it is
      // always there; the index type has no way of knowing that.
      out += char ?? ''
      at += 1
      continue
    }

    const symbol = text[at + 1]
    if (symbol === '\\' || symbol === '{' || symbol === '}') {
      out += symbol
      at += 2
      continue
    }
    if (symbol === '~') {
      out += ' '
      at += 2
      continue
    }

    const word = /^\\([a-z]+)(-?\d+)?[ ]?/i.exec(text.slice(at))
    if (!word) {
      at += 1
      continue
    }

    out += SHOWN[word[1] ?? ''] ?? ''
    at += word[0].length
    // A `\uN` escape is followed by the one character a reader without Unicode
    // shows instead, and that character is not part of the text.
    if (word[1] === 'u' && text[at] === '?') at += 1
  }

  return out
}

function count(rtf: string, pattern: RegExp): number {
  return [...rtf.matchAll(pattern)].length
}

/** A run as the writer builds one: opened, the words, closed again. */
function run(on: string, text: string, off: string): string {
  return `{${on} ${text}${off}}`
}

/** A document with only what the case under test needs in it. */
function made(blocks: Doc['blocks'], notes: Doc['notes'] = []): Doc {
  return { title: 'Made', named: true, author: null, lang: 'en', date: null, blocks, notes }
}

const PICTURES = [
  picture('assets/pic.png', 'image/png', png(24, 24)),
  picture('https://pics.example/x.jpg', 'image/jpeg', jpeg(32, 48)),
]

// Written once: every test below reads the same document, and lexing it per test
// would be the slowest thing in the file.
const DOC = documentOf(NOTE, 'Corpus.md')
const RTF = toRtf(DOC, PICTURES, PAPER)

describe('the file', () => {
  test('opens as RTF, balances its braces and closes at the end', () => {
    expect(RTF.startsWith('{\\rtf1')).toBe(true)
    expect(RTF.endsWith('}')).toBe(true)
    expect(braces(RTF)).toEqual({ end: 0, lowest: 0 })
  })

  test('names the three faces and lists the colours', () => {
    expect(RTF).toContain('{\\fonttbl')
    expect(RTF).toContain('\\f0\\froman\\fcharset0 Georgia')
    expect(RTF).toContain('\\f2\\fmodern\\fcharset0 Consolas')
    expect(RTF).toContain('{\\colortbl;')
    expect(RTF).toContain('\\red17\\green85\\blue204')
  })

  test('carries the title, the author and the language', () => {
    expect(RTF).toContain('{\\info{\\title Corpus}{\\author Ada Lovelace}}')
    expect(RTF).toContain('\\deflang1031')
    expect(toRtf(made([]), [], PAPER)).toContain('\\deflang1033')
  })
})

describe('headings', () => {
  const LEVELS = toRtf(
    documentOf('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n', 'L.md'),
    [],
    PAPER,
  )

  test('steps the size down and names the outline level', () => {
    const found = [...LEVELS.matchAll(/\\outlinelevel(\d)\\f1\\fs(\d+)\\b /g)]
    const levels = found.map((match) => Number(match[1]))
    const sizes = found.map((match) => Number(match[2]))

    expect(levels).toEqual([0, 1, 2, 3, 4, 5])
    expect(sizes).toEqual([...sizes].sort((one, two) => two - one))
    expect(new Set(sizes).size).toBe(6)
    expect(LEVELS).toContain('\\keepn')
    expect(LEVELS).toMatch(/\\sb\d+\\sa\d+/)
  })

  test('closes the bold it opened', () => {
    expect(count(LEVELS, /\\fs\d+\\b /g)).toBe(6)
    expect(count(LEVELS, /\\b0\\par/g)).toBe(6)
  })
})

describe('runs', () => {
  test('opens and closes every mark', () => {
    expect(RTF).toContain(run('\\b', 'bold', '\\b0'))
    expect(RTF).toContain(run('\\i', 'italic', '\\i0'))
    expect(RTF).toContain(run('\\strike', 'gone', '\\strike0'))
    expect(RTF).toContain(run('\\highlight5', 'marked', '\\highlight0'))
    expect(RTF).toContain(run('\\sub', '2', '\\nosupersub'))
    expect(RTF).toContain(run('\\super', '2', '\\nosupersub'))
    expect(RTF).toContain(run('\\f2\\cf2', 'code()', '\\cf1\\f0'))
    expect(RTF).toContain(run('\\f2', 'E=mc^2', '\\f0'))
  })

  test('writes a link as a field carrying the real address', () => {
    expect(RTF).toContain('{\\field{\\*\\fldinst{HYPERLINK "https://nib.dev/a?b=1&c=2"}}')
    expect(RTF).toContain('{\\fldrslt{\\cf3\\ul link}}}')
  })

  test('a quote in an address cannot end the field it stands in', () => {
    const doc: Doc = {
      title: 'Note',
      named: false,
      author: null,
      lang: 'en',
      date: null,
      notes: [],
      blocks: [
        {
          kind: 'paragraph',
          spans: [{ text: 'link', href: 'https://nib.dev/a" \\l "x' }],
        },
      ],
    }

    const out = toRtf(doc, [], PAPER)
    expect(out).toContain('HYPERLINK "https://nib.dev/a%22 \\\\l %22x"')
  })

  /** A paragraph hard wrapped in the file is one paragraph, and the newline in
   *  the middle of it is a space, exactly as a browser reads it. Only the break
   *  the writer asked for with two spaces is a break. See `flowed` in
   *  document.ts. */
  test('flows a wrapped line, and keeps a break that was asked for', () => {
    expect(RTF).not.toContain(', a\\line ')
    expect(toRtf(documentOf('one  \ntwo\n', 'Break.md'), [], PAPER)).toContain('one\\line two')
  })
})

describe('escaping', () => {
  const ODD = toRtf(documentOf('Braces {like} this and a back\\\\slash.\n', 'O.md'), [], PAPER)
  const WIDE = toRtf(
    documentOf('ü → 日本語 \u{1f600}\n\nTabbed:\there.\n\nNo\u00a0gap.\n', 'W.md'),
    [],
    PAPER,
  )

  test('escapes the braces and the backslash', () => {
    expect(ODD).toContain('Braces \\{like\\} this and a back')
    expect(ODD).toContain('\\\\')
  })

  test('writes a character above ASCII as a signed sixteen bit escape', () => {
    expect(WIDE).toContain('\\u252?')
    expect(WIDE).toContain('\\u8594?')
    expect(WIDE).toContain('\\u26085?\\u26412?\\u-30050?')
  })

  test('writes a character outside the BMP as its two surrogates', () => {
    expect(WIDE).toContain('\\u-10179?\\u-8704?')
  })

  test('writes a tab and a non-breaking space as their own control words', () => {
    expect(WIDE).toContain('Tabbed:\\tab here.')
    expect(WIDE).toContain('No\\~gap.')
  })
})

describe('tables', () => {
  test('opens one row per row and closes every cell', () => {
    expect(count(RTF, /\\trowd/g)).toBe(2)
    expect(count(RTF, /\\cellx/g)).toBe(6)
    expect(count(RTF, /\\cell\b/g)).toBe(6)
    expect(count(RTF, /\\row\b/g)).toBe(2)
  })

  test('splits the text column evenly and draws all four borders', () => {
    // Three columns across the A4 text column, which is the sheet less both 20 mm
    // margins: 9641 twips. It was 9360 - a letter page with an inch each side -
    // whatever paper the export was going on.
    expect(RTF).toContain('\\cellx3214')
    expect(RTF).toContain('\\cellx6427')
    expect(RTF).toContain('\\cellx9641')
    expect(RTF).toContain('\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10')
    expect(RTF).toContain('\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10')
  })

  test('shades and bolds the header row only', () => {
    expect(count(RTF, /\\clcbpat4/g)).toBe(3)
    expect(RTF).toContain('\\intbl\\ql\\f0\\fs22\\b Left\\b0\\cell')
    expect(RTF).toContain('\\intbl\\qc\\f0\\fs22\\b Middle\\b0\\cell')
    expect(RTF).toContain('\\intbl\\qr\\f0\\fs22\\b Right\\b0\\cell')
  })

  test('keeps each column on its own alignment in the body', () => {
    expect(RTF).toContain('\\intbl\\ql\\f0\\fs22 one\\cell')
    expect(RTF).toContain('\\intbl\\qc\\f0\\fs22 two\\cell')
    expect(RTF).toContain('\\intbl\\qr\\f0\\fs22 three\\cell')
  })
})

describe('blocks', () => {
  test('keeps a code block exactly as it was written', () => {
    expect(RTF).toContain('\\cbpat4\\f2\\fs18 const answer = 42\\par')
    expect(RTF).toContain('\\cbpat4\\f2\\fs18   const nested = answer\\par')
    expect(words(RTF)).toContain('const answer = 42\n  const nested = answer')
  })

  test('sets display maths centred in the code face', () => {
    expect(RTF).toContain('\\qc\\f2\\fs20 \\\\int_0^1 x\\\\,dx\\par')
  })

  test('indents a list, steps a nested one in again and numbers an ordered one', () => {
    expect(RTF).toContain('{\\pntext\\f0\\bullet\\tab}{\\*\\pn\\pnlvlblt\\pnf0\\pnindent0')
    expect(RTF).toContain('\\li720\\fi-360\\sa60\\f0\\fs22 one\\par')
    expect(RTF).toContain('\\li1440\\fi-360\\sa60\\f0\\fs22 nested\\par')
    expect(RTF).toContain('{\\pntext\\f0 1.\\tab}')
    expect(RTF).toContain('{\\pntext\\f0 2.\\tab}')
    expect(RTF).toContain('\\pnstart2\\pndec')
  })

  test('puts a checkbox in front of a task', () => {
    expect(RTF).toContain('\\u9745? done\\par')
    expect(RTF).toContain('\\u9744? open\\par')
  })

  test('draws a quote with a left border and a callout label in bold', () => {
    expect(RTF).toContain('\\brdrl\\brdrs\\brdrw20\\brsp80\\li720')
    expect(RTF).toContain(run('\\b', 'Note', '\\b0'))
    expect(words(RTF)).toContain('Note\nCareful now.')
  })

  test('writes a definition list as a bold term with its details under it', () => {
    expect(RTF).toContain(run('\\b', 'Markdown', '\\b0'))
    expect(RTF).toContain('\\li720\\sa60\\f0\\fs22 A way of writing.\\par')
    expect(RTF).toContain('\\li720\\sa60\\f0\\fs22 Also the format.\\par')
  })

  test('draws a rule and starts a page', () => {
    expect(RTF).toContain('\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\par')
    expect(count(RTF, /\\page\b/g)).toBe(1)
  })
})

describe('footnotes', () => {
  // Built by hand rather than lexed: `documentOf` drops a footnote reference,
  // because the span it makes carries no text and empty spans are filtered out.
  // The writer still has to answer for the span, so the test hands it one.
  const NOTED = made(
    [
      {
        kind: 'paragraph',
        spans: [
          { text: 'Before' },
          { text: '', note: 'one' },
          { text: 'after' },
          { text: '', note: 'ghost' },
          { text: '.' },
        ],
      },
    ],
    [{ label: 'one', spans: [{ text: 'The note itself.' }] }],
  )

  const NOTED_RTF = toRtf(NOTED, [], PAPER)

  test('writes the definition at the reference point', () => {
    expect(NOTED_RTF).toContain('{\\super\\chftn}{\\footnote')
    expect(NOTED_RTF).toContain('The note itself.')
    expect(count(NOTED_RTF, /\\footnote/g)).toBe(1)

    const before = NOTED_RTF.indexOf('Before')
    const mark = NOTED_RTF.indexOf('{\\super\\chftn}')
    const after = NOTED_RTF.indexOf('after')
    expect(before).toBeLessThan(mark)
    expect(mark).toBeLessThan(after)
  })

  test('leaves a label nothing defines as the label', () => {
    expect(NOTED_RTF).toContain('{\\super ghost}')
    expect(braces(NOTED_RTF)).toEqual({ end: 0, lowest: 0 })
  })
})

describe('pictures', () => {
  test('embeds a PNG at the pixel size in its own bytes', () => {
    expect(RTF).toContain('{\\pict\\pngblip\\picw24\\pich24\\picwgoal360\\pichgoal360\n')
  })

  test('embeds a JPEG at the pixel size in its own bytes', () => {
    expect(RTF).toContain('{\\pict\\jpegblip\\picw32\\pich48\\picwgoal480\\pichgoal720\n')
  })

  test('writes the hex in lowercase, wrapped', () => {
    const hex = /\\pichgoal360\n([0-9a-f\n]+)\}/.exec(RTF)?.[1] ?? ''

    expect(hex.startsWith('89504e470d0a1a0a')).toBe(true)
    expect(Math.max(...hex.split('\n').map((line) => line.length))).toBeLessThanOrEqual(120)
  })

  test('brings a picture wider than the column down to it', () => {
    const wide = made([{ kind: 'paragraph', spans: [{ text: 'Wide', picture: 'a/wide.png' }] }])
    const bytes = new Uint8Array(pngHeader(1000, 500))

    // The column is the A4 sheet less both 20 mm margins: 11909 - 2268 twips. It
    // used to be the 9360 of a letter page with an inch each side, whatever paper
    // the export was actually going on.
    expect(toRtf(wide, [picture('a/wide.png', 'image/png', bytes)], PAPER)).toContain(
      '\\picw1000\\pich500\\picwgoal9641\\pichgoal4821',
    )
  })

  test('falls back to the alt text when the picture cannot be read', () => {
    const doc = made([
      {
        kind: 'paragraph',
        spans: [
          { text: 'A drawing', picture: 'a/one.gif' },
          { text: 'A photo', picture: 'a/two.png' },
          { text: '', picture: 'a/gone.png' },
        ],
      },
    ])

    const rtf = toRtf(
      doc,
      [
        picture('a/one.gif', 'image/gif', new Uint8Array([0x47, 0x49, 0x46, 0x38])),
        // A PNG signature and nothing behind it: no IHDR, so no size to be had.
        picture('a/two.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
      ],
      PAPER,
    )

    expect(rtf).toContain('[A drawing]')
    expect(rtf).toContain('[A photo]')
    expect(rtf).toContain('[picture]')
    expect(rtf).not.toContain('\\pict')
  })
})

/** The six colours a `==highlight==` can be. RTF has a colour table of the
 *  document's own, so each tone is the wash the app draws it in rather than the
 *  nearest of a fixed few, and the plain one keeps the index it always had. */
describe('a coloured highlight', () => {
  const TONES = `==plain==, ==🔴 red==, ==🟠 orange==, ==🟢 green==, ==🔵 blue==, ==🟣 violet==\n`
  const COLOURED = toRtf(documentOf(TONES, 'Tones.md'), [], PAPER)

  test('names a colour of its own for each of the six', () => {
    const used = [...COLOURED.matchAll(/\\highlight(\d+) /g)].map(([, one]) => Number(one))

    expect(used).toEqual([5, 6, 7, 8, 9, 10])
    expect(new Set(used).size).toBe(6)
  })

  test('puts every one of them in the colour table', () => {
    const table = /\{\\colortbl;([^}]*)\}/.exec(COLOURED)?.[1] ?? ''

    expect(table.split(';').filter((one) => one.trim() !== '')).toHaveLength(10)
    expect(table).toContain('\\red250\\green210\\blue215')
    expect(table).toContain('\\red225\\green217\\blue251')
  })

  test('closes each of them again', () => {
    expect(count(COLOURED, /\\highlight0/g)).toBe(6)
  })

  test('never carries the colour emoji into the words', () => {
    for (const emoji of ['🔴', '🟠', '🟢', '🔵', '🟣']) expect(COLOURED).not.toContain(emoji)
  })
})
