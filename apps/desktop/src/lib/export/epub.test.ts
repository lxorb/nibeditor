/** The ePub, built for real and then taken apart again.
 *
 *  Nothing here stubs anything: the note goes through the same renderer an
 *  export uses, then through `toEpub`, and the bytes that come out are unzipped
 *  and read. Every rule that decides whether a reader opens a book is about
 *  those bytes rather than about any one function - the first entry and how it
 *  is stored, the manifest, the spine, and above all whether each part is XML a
 *  parser will take. */

import { renderMarkdown } from '@nib/markdown'
// Both heavy libraries handed over outright. In the app a formula is set by a render
// that has awaited them - `prepareFences` and `runExport` do - and these render
// synchronously; see @nib/markdown/engines.
import '@nib/markdown/eager'
import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { type EpubOptions, forReading, sectionsOf, toEpub, toXhtml } from './epub'
import type { Picture } from './pictures'

/** One of everything a book has to carry: two levels of heading, marked-up
 *  prose, a footnote at both ends, maths inline and on its own, a table, a
 *  fence, a task list, a quote, two pictures, and the characters XML is
 *  fussiest about. */
const NOTE = `# Handbook

[toc]

Prose with **strong**, *slight*, a [link](https://nib.dev), $E=mc^2$ and a note[^1].

Guard: a < b && c > d

## Table

| Left | Right |
| - | - |
| 1 | 2 |

## Code

\`\`\`ts
const answer = 42
\`\`\`

$$
\\int_0^1 x\\,dx
$$

- [x] done
- [ ] open

> Careful.

![One](assets/one.png)

![Two](assets/two%20picture.jpg)

<!-- a plain note -->

<!-- careful -- here -->

# Appendix

Nothing much.

[^1]: The note.
`

const PICTURES: Picture[] = [
  {
    src: 'assets/one.png',
    name: 'one.png',
    mime: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
  },
  {
    src: 'assets/two%20picture.jpg',
    name: 'two picture.jpg',
    mime: 'image/jpeg',
    bytes: new Uint8Array([255, 216, 255, 224, 9, 9, 9]),
  },
]

const MODIFIED = '2026-09-04T12:34:56.789Z'

const BASE: EpubOptions = {
  title: 'Nib Handbook',
  author: 'Ada Lovelace',
  lang: 'de',
  identifier: 'urn:uuid:7f1c9f5e-0000-4000-8000-0123456789ab',
  modified: MODIFIED,
  body: renderMarkdown(NOTE, { footnotes: true, toc: true }),
  css: '#write { max-width: 40em; }\n.katex { font-family: "KaTeX_Main", serif; }\n',
  pictures: PICTURES,
}

interface Book {
  bytes: Uint8Array
  /** Every entry, in the order the zip carries them. */
  names: string[]
  container: string
  opf: string
  nav: string
  ncx: string
  sections: string[]
  bytesOf: (path: string) => Promise<Uint8Array>
}

async function openBook(bytes: Uint8Array): Promise<Book> {
  const zip = await JSZip.loadAsync(bytes)

  const text = async (path: string): Promise<string> => {
    const file = zip.file(path)
    if (!file) throw new Error(`${path} is not in the book`)
    return file.async('string')
  }

  const names = Object.keys(zip.files)
  const parts = names.filter((name) => /^OEBPS\/text\/section-\d+\.xhtml$/.test(name)).sort()

  return {
    bytes,
    names,
    container: await text('META-INF/container.xml'),
    opf: await text('OEBPS/package.opf'),
    nav: await text('OEBPS/nav.xhtml'),
    ncx: await text('OEBPS/toc.ncx'),
    sections: await Promise.all(parts.map(text)),
    bytesOf: async (path: string) => {
      const file = zip.file(path)
      if (!file) throw new Error(`${path} is not in the book`)
      return file.async('uint8array')
    },
  }
}

// The five names XML defines by itself, plus any number. Anything else needs a
// DTD, which a part of a book has not got.
const REFERENCE = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/y
const CLOSE_TAG = /<\/([^\s>]+)\s*>/y
const OPEN_TAG = /<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/y
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g

function strayReference(text: string): string | null {
  for (let at = text.indexOf('&'); at >= 0; at = text.indexOf('&', at + 1)) {
    REFERENCE.lastIndex = at
    if (!REFERENCE.test(text)) return `a bare & at ${JSON.stringify(text.slice(at, at + 24))}`
  }

  return null
}

function badAttributes(source: string): string | null {
  const seen = new Set<string>()

  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1] ?? ''
    const value = found[2]

    if (value === undefined) return `the bare attribute ${name}`
    if (!value.startsWith('"')) return `an unquoted value on ${name}`
    if (seen.has(name)) return `${name} written twice`
    seen.add(name)

    const stray = strayReference(value)
    if (stray) return `${stray} in ${name}`
  }

  return source.replace(ATTRIBUTE, '').trim() === ''
    ? null
    : `something that is not an attribute in ${JSON.stringify(source)}`
}

/** Everything about one part of a book that has to be true for a reader's XML
 *  parser to open it. Null means well formed; anything else names what is
 *  wrong, so a failure says which rule was broken and where.
 *
 *  Written out again in `image.test.ts` rather than shared: importing one test
 *  file into another registers its whole suite a second time. */
function malformed(xml: string): string | null {
  const open: string[] = []
  let at = 0

  while (at < xml.length) {
    const next = xml.indexOf('<', at)
    const stray = strayReference(xml.slice(at, next < 0 ? xml.length : next))
    if (stray) return stray
    if (next < 0) break

    if (xml.startsWith('<!--', next)) {
      const end = xml.indexOf('-->', next + 4)
      if (end < 0) return 'a comment that never ends'

      const inner = xml.slice(next + 4, end)
      if (inner.includes('--') || inner.endsWith('-')) return `a comment XML forbids: ${inner}`
      at = end + 3
      continue
    }

    if (xml.startsWith('<!', next) || xml.startsWith('<?', next)) {
      const end = xml.indexOf('>', next)
      if (end < 0) return 'a declaration that never ends'
      at = end + 1
      continue
    }

    CLOSE_TAG.lastIndex = next
    const close = CLOSE_TAG.exec(xml)
    if (close) {
      const name = close[1] ?? ''
      if (open.pop() !== name) return `</${name}> closes nothing that is open`
      at = CLOSE_TAG.lastIndex
      continue
    }

    OPEN_TAG.lastIndex = next
    const found = OPEN_TAG.exec(xml)
    const name = found?.[1]
    if (name === undefined) {
      return `a < that starts no tag: ${JSON.stringify(xml.slice(next, next + 40))}`
    }

    const bad = badAttributes(found?.[2] ?? '')
    if (bad) return `${bad} on <${name}>`
    if (found?.[3] !== '/') open.push(name)
    at = OPEN_TAG.lastIndex
  }

  return open.length ? `<${open.join('>, <')}> never closed` : null
}

/** The zip's own first local file header, read by hand. JSZip would answer the
 *  same question about compression from its own bookkeeping, but the reason the
 *  rule exists is that a reader looks at these bytes: the method field of the
 *  first entry, before it has parsed anything else. */
function firstEntry(bytes: Uint8Array): { name: string; method: number; content: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const start = 30 + nameLength + extraLength

  return {
    name: new TextDecoder().decode(bytes.subarray(30, 30 + nameLength)),
    method: view.getUint16(8, true),
    content: new TextDecoder().decode(bytes.subarray(start, start + view.getUint32(22, true))),
  }
}

const book = await openBook(await toEpub(BASE))
const halved = await openBook(await toEpub({ ...BASE, splitAt: 2 }))

/** A book of one small note, for a test that is about one thing. */
const bookOf = async (changed: Partial<EpubOptions>): Promise<Book> =>
  openBook(await toEpub({ ...BASE, pictures: [], ...changed }))

/** One part of a book as text, by the path it is stored under. */
const bookText = async (one: Book, path: string): Promise<string> =>
  new TextDecoder().decode(await one.bytesOf(path))

describe('the package', () => {
  test('opens with an uncompressed mimetype', () => {
    const first = firstEntry(book.bytes)

    expect(book.names[0]).toBe('mimetype')
    expect(first.name).toBe('mimetype')
    expect(first.method).toBe(0)
    expect(first.content).toBe('application/epub+zip')
  })

  test('points a reader at the package document', () => {
    expect(book.container).toContain('full-path="OEBPS/package.opf"')
    expect(book.container).toContain('media-type="application/oebps-package+xml"')
  })

  test('says what the book is', () => {
    expect(book.opf).toContain('<package version="3.0" unique-identifier="pub-id"')
    expect(book.opf).toContain(`<dc:identifier id="pub-id">${BASE.identifier}</dc:identifier>`)
    expect(book.opf).toContain('<dc:title>Nib Handbook</dc:title>')
    expect(book.opf).toContain('<dc:language>de</dc:language>')
    expect(book.opf).toContain('<dc:creator>Ada Lovelace</dc:creator>')
  })

  test('dates itself to the instant it was given, to the second', () => {
    expect(book.opf).toContain('<meta property="dcterms:modified">2026-09-04T12:34:56Z</meta>')
  })

  test('leaves the author out when there is none', async () => {
    const bare = await openBook(await toEpub({ ...BASE, author: null }))
    expect(bare.opf).not.toContain('dc:creator')
  })

  test('gives every manifest item its own id, and the nav its property', () => {
    const ids = [...book.opf.matchAll(/<item id="([^"]+)"/g)].map(([, id]) => id)

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    expect(book.opf).toMatch(/<item id="nav" href="nav\.xhtml"[^>]*properties="nav"/)
    expect(book.opf).toContain('media-type="application/x-dtbncx+xml"')
  })

  test('reads in an order that resolves', () => {
    const ids = new Set([...book.opf.matchAll(/<item id="([^"]+)"/g)].map(([, id]) => id))
    const spine = [...book.opf.matchAll(/<itemref idref="([^"]+)"/g)].map(([, id]) => id)

    expect(spine).toEqual(['sec-1', 'sec-2'])
    for (const id of spine) expect(ids.has(id)).toBe(true)
  })

  test('has every file its manifest names', () => {
    const hrefs = [...book.opf.matchAll(/<item [^>]*href="([^"]+)"/g)].map(([, href]) => href ?? '')

    expect(hrefs.length).toBeGreaterThan(4)
    for (const href of hrefs) {
      expect(book.names).toContain(`OEBPS/${decodeURIComponent(href)}`)
    }
  })

  test('carries the stylesheet it was given', async () => {
    const css = new TextDecoder().decode(await book.bytesOf('OEBPS/styles/document.css'))
    expect(css).toBe(BASE.css)
  })
})

describe('the two tables of contents', () => {
  test('list one entry per part, with its headings under it', () => {
    expect(book.nav).toContain('epub:type="toc"')
    expect(book.nav).toContain('<a href="text/section-1.xhtml">Handbook</a>')
    expect(book.nav).toContain('<a href="text/section-2.xhtml">Appendix</a>')
    expect(book.nav).toContain('<a href="text/section-1.xhtml#table">Table</a>')
    expect(book.nav).toContain('<a href="text/section-1.xhtml#code">Code</a>')
  })

  test('say the same thing again for a reader older than EPUB 3', () => {
    expect(book.names).toContain('OEBPS/toc.ncx')
    expect(book.opf).toContain('<spine toc="ncx">')
    expect(book.ncx).toContain('<text>Handbook</text>')
    expect(book.ncx).toContain('<text>Appendix</text>')
    expect(book.ncx).toContain('<content src="text/section-1.xhtml#table" />')

    const order = [...book.ncx.matchAll(/playOrder="(\d+)"/g)].map(([, at]) => Number(at))
    expect(order).toEqual([1, 2, 3, 4])
  })

  /** A reader finds the `navMap` by namespace, so one character wrong here and
   *  the contents are simply not there. Caught by opening a book in a library
   *  that had never seen this writer; see the note in scripts/export-e2e.py. */
  test('name the contents in the namespace an older reader looks in', () => {
    expect(book.ncx).toContain('xmlns="http://www.daisy.org/z3986/2005/ncx/"')
    expect(book.ncx).toContain('"http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"')
    expect(book.ncx).not.toContain('/ns/z3986')
  })
})

/** What a real reader refuses, found by running epubcheck over a book this very
 *  writer produced; see scripts/export-e2e.py for how it was run. Each of these
 *  was an error in that report. */
describe('what a reader that checks the book insists on', () => {
  test('a column’s alignment is a style, since XHTML5 dropped the attribute', () => {
    const aligned = toXhtml(
      '<table><tr><th align="center">A</th><td align="right">1</td></tr></table>',
    )

    expect(aligned).toContain('<th style="text-align: center">')
    expect(aligned).toContain('<td style="text-align: right">')
    expect(aligned).not.toContain('align="center"')
  })

  test('an element that already has a style keeps it rather than gaining a second', () => {
    const both = toXhtml('<td style="color: red" align="left">1</td>')

    expect(both).toContain('style="color: red"')
    expect([...both.matchAll(/style=/g)]).toHaveLength(1)
  })

  test('an align nobody recognises is left as the attribute it was', () => {
    expect(toXhtml('<td align="middle">1</td>')).toContain('align="middle"')
  })

  test('a paragraph inside a diagram’s label becomes a span, which may hold one', () => {
    // Mermaid writes its labels as HTML inside a `foreignObject`, and puts a
    // `<p>` inside a `<span>`, which is not allowed anywhere.
    const drawn = toXhtml(
      '<svg><foreignObject><div><span class="nodeLabel"><p>A</p></span></div></foreignObject></svg>',
    )

    expect(drawn).toContain('<span class="nodeLabel"><span>A</span></span>')
    expect(drawn).not.toContain('<p>')
  })

  test('a paragraph outside one is still a paragraph', () => {
    expect(toXhtml('<svg><foreignObject><p>A</p></foreignObject></svg><p>B</p>')).toContain(
      '</svg><p>B</p>',
    )
  })

  test('a part that draws an SVG says so in the manifest', async () => {
    const drawn = await bookOf({
      body: '<h1>Drawn</h1>\n<figure class="diagram"><svg viewBox="0 0 2 2"></svg></figure>',
    })

    expect(drawn.opf).toMatch(/<item id="sec-1"[^>]*properties="svg"/)
  })

  test('a part with no SVG in it declares nothing', async () => {
    const plain = await bookOf({ body: '<h1>Plain</h1>\n<p>words</p>' })
    expect(plain.opf).not.toMatch(/<item id="sec-1"[^>]*properties=/)
  })

  test('the paper rules stay out of a book, which has no paper', () => {
    const css = 'a { color: red }\n@media print {\n  b { color: blue }\n}\ni { color: green }\n'

    // The blank line the block sat on stays: what is cut is the rules, and a
    // stylesheet is not laid out by whoever reads it.
    expect(forReading(css)).toBe('a { color: red }\n\ni { color: green }\n')
  })

  test('a nested block inside the paper rules goes with them', () => {
    const css = '@media print { @page { margin: 1cm } p { color: red } }\na { color: red }\n'

    expect(forReading(css)).toBe('\na { color: red }\n')
  })

  test('a stylesheet with no paper rules comes back untouched', () => {
    const css = 'a { color: red }\n@media screen { b { color: blue } }\n'

    expect(forReading(css)).toBe(css)
  })

  test('the book’s own stylesheet keeps the prose rules and drops the sheet', async () => {
    const paged = await bookOf({
      css: '#write p { color: red }\n@media print {\n  @page { size: A4 }\n  #write a::after { content: attr(href) }\n}\n',
    })

    const sheet = await bookText(paged, `OEBPS/styles/document.css`)
    expect(sheet).toContain('#write p { color: red }')
    expect(sheet).not.toContain('@page')
    expect(sheet).not.toContain('@media print')
  })
})

describe('the parts', () => {
  test('start at every heading of the split level', () => {
    expect(book.sections).toHaveLength(2)
    expect(book.sections[0]).toContain('<h1 id="handbook">Handbook</h1>')
    expect(book.sections[0]).toContain('<h2 id="table">Table</h2>')
    expect(book.sections[1]).toContain('<h1 id="appendix">Appendix</h1>')
    expect(book.sections[1]).not.toContain('id="handbook"')
  })

  test('cut at the deeper level when asked to, keeping the opening as its own', () => {
    expect(halved.sections).toHaveLength(3)
    expect(halved.sections[0]).toContain('<h1 id="handbook">Handbook</h1>')
    expect(halved.sections[0]).not.toContain('id="table"')
    expect(halved.sections[1]).toContain('<h2 id="table">Table</h2>')
    expect(halved.sections[2]).toContain('<h2 id="code">Code</h2>')
    expect(halved.nav).toContain('<a href="text/section-1.xhtml">Handbook</a>')
  })

  test('each stand alone as an XHTML document', () => {
    for (const section of book.sections) {
      expect(section.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>')).toBe(
        true,
      )
      expect(section).toContain('<html xmlns="http://www.w3.org/1999/xhtml"')
      expect(section).toContain('xmlns:epub="http://www.idpf.org/2007/ops"')
      expect(section).toContain('xml:lang="de"')
      expect(section).toContain('lang="de"')
      expect(section).toContain(
        '<link rel="stylesheet" type="text/css" href="../styles/document.css" />',
      )
      expect(section).toContain('<title>')
    }
  })

  test('keep the footnotes in the last one', () => {
    expect(book.sections[0]).not.toContain('class="footnotes"')
    expect(book.sections[1]).toContain('<section class="footnotes">')
    expect(book.sections[1]).toContain('The note.')
    expect(halved.sections[2]).toContain('<section class="footnotes">')
  })

  test('point a link at the file the id it names is in', () => {
    // The footnote is used in the first part and shown in the last, and the
    // table of contents links out of the first part into both of the others.
    expect(book.sections[0]).toContain('href="section-2.xhtml#fn-1"')
    expect(book.sections[0]).toContain('href="#handbook"')
    expect(book.sections[1]).toContain('href="section-1.xhtml#fnref-1"')
    expect(halved.sections[0]).toContain('href="section-2.xhtml#table"')
  })

  test('carry the maths as KaTeX drew it', () => {
    expect(book.sections[0]).toContain('<span class="math-inline"')
    expect(book.sections[0]).toContain('class="katex"')
    expect(book.sections[0]).toContain('<div class="math-block"')
    expect(book.sections[0]).not.toContain('<math')
  })

  test('leave the characters XML is fussiest about as the renderer escaped them', () => {
    expect(book.sections[0]).toContain('Guard: a &lt; b &amp;&amp; c &gt; d')
  })

  test('close the void elements a task list and a picture bring with them', () => {
    // This renderer writes `checked=""` rather than a bare `checked`, so what
    // the book needs from the transformer here is the closing slash. The bare
    // spelling XHTML forbids is a rule about the markup, not about this note,
    // and is held to further down.
    expect(book.sections[0]).toContain('<input checked="" disabled="" type="checkbox" />')
    expect(book.sections[0]).not.toMatch(/<(?:input|img|br|hr)\b[^>]*[^/]>/)
  })
})

describe('the pictures', () => {
  test('travel as their own bytes, under a name a URL can carry', async () => {
    expect(await book.bytesOf('OEBPS/images/one.png')).toEqual(PICTURES[0]?.bytes)
    expect(await book.bytesOf('OEBPS/images/two picture.jpg')).toEqual(PICTURES[1]?.bytes)
    expect(book.opf).toContain('href="images/two%20picture.jpg" media-type="image/jpeg"')
  })

  test('are pointed at from the body rather than where the note wrote them', () => {
    expect(book.sections[0]).toContain('src="../images/one.png"')
    expect(book.sections[0]).toContain('src="../images/two%20picture.jpg"')
    expect(book.sections[0]).not.toContain('assets/one.png')
  })

  test('keep the src the note wrote when the caller could not read them', async () => {
    const missing = await openBook(await toEpub({ ...BASE, pictures: [] }))
    expect(missing.sections[0]).toContain('src="assets/one.png"')
  })

  test('stay inside the book however they are named', async () => {
    const escaping = await openBook(
      await toEpub({
        ...BASE,
        pictures: [{ ...PICTURES[0], name: '../../escaped.png' } as Picture],
      }),
    )

    for (const name of escaping.names) expect(name).not.toContain('..')
  })

  test('cannot break the manifest open with the type they claim', async () => {
    const hostile = await openBook(
      await toEpub({
        ...BASE,
        pictures: [{ ...PICTURES[0], mime: 'image/png" properties="nav' } as Picture],
      }),
    )

    expect(malformed(hostile.opf)).toBe(null)
    expect(hostile.opf).not.toContain('media-type="image/png" properties="nav"')
  })
})

describe('every part of the book', () => {
  test('is XML a reader will parse', () => {
    const parts: Record<string, string> = {
      'META-INF/container.xml': book.container,
      'OEBPS/package.opf': book.opf,
      'OEBPS/nav.xhtml': book.nav,
      'OEBPS/toc.ncx': book.ncx,
      ...Object.fromEntries(book.sections.map((body, at) => [`section-${at + 1}.xhtml`, body])),
      ...Object.fromEntries(halved.sections.map((body, at) => [`halved-${at + 1}.xhtml`, body])),
    }

    for (const [name, body] of Object.entries(parts)) {
      expect(malformed(body), name).toBe(null)
    }
  })

  /** A comment is a note to the writer and never reaches a rendered page at all;
   *  see `withoutComments` in @nib/markdown. What the writer of an ePub does with a
   *  comment handed to it in markup - XML cannot hold `--` inside one - is tested
   *  against `toXhtml` below. */
  test('puts none of the writer’s own comments in the book', () => {
    expect(book.sections[0]).not.toContain('a plain note')
    expect(book.sections[0]).not.toContain('-- here')
  })
})

describe('the scanner the tests stand on', () => {
  test('names what is wrong instead of passing everything', () => {
    expect(malformed('<p>fine</p>')).toBe(null)
    expect(malformed('<p>open')).toContain('never closed')
    expect(malformed('<b><i>x</b></i>')).toContain('closes nothing that is open')
    expect(malformed('<p>Tom & Jerry</p>')).toContain('a bare &')
    expect(malformed('<input checked />')).toContain('bare attribute')
    expect(malformed('<p>a &nbsp; b</p>')).toContain('a bare &')
  })
})

describe('the transformer', () => {
  test('closes a void element and leaves one already closed alone', () => {
    expect(toXhtml('<p>a<br>b</p>')).toBe('<p>a<br />b</p>')
    expect(toXhtml('<img src="a.png" />')).toBe('<img src="a.png" />')
    expect(toXhtml('<hr><meta charset="utf-8">')).toBe('<hr /><meta charset="utf-8" />')
  })

  test('gives a bare attribute the value HTML let it leave out', () => {
    expect(toXhtml('<input checked type="checkbox">')).toBe(
      '<input checked="checked" type="checkbox" />',
    )
    expect(toXhtml('<button disabled>x</button>')).toBe('<button disabled="disabled">x</button>')
  })

  test('spells out an ampersand that is not already a reference', () => {
    expect(toXhtml('AT&T')).toBe('AT&amp;T')
    expect(toXhtml('a &amp; b &#160; c &lt;')).toBe('a &amp; b &#160; c &lt;')
    expect(toXhtml('&nbsp;')).toBe('&#160;')
    expect(toXhtml('&madeup;')).toBe('&amp;madeup;')
  })

  test('escapes an angle bracket the renderer left as a character', () => {
    expect(toXhtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
    expect(toXhtml('<p title="a & b">x</p>')).toBe('<p title="a &amp; b">x</p>')
  })

  test('keeps a comment, and drops one XML could not hold', () => {
    expect(toXhtml('<!--nib:toc-->')).toBe('<!--nib:toc-->')
    expect(toXhtml('a<!-- one -- two -->b')).toBe('ab')
    expect(toXhtml('a<!-- ends in a dash -->b')).toBe('a<!-- ends in a dash -->b')
    expect(toXhtml('a<!-- dash -->b')).toBe('a<!-- dash -->b')
  })

  test('reorders and renames nothing', () => {
    expect(toXhtml('<DIV CLASS="A" id="b">x</DIV>')).toBe('<DIV CLASS="A" id="b">x</DIV>')
  })

  test('closes what the note left open rather than handing over a broken part', () => {
    expect(toXhtml('<div><p>x')).toBe('<div><p>x</p></div>')
    expect(toXhtml('x</span>')).toBe('x')
  })
})

describe('splitting', () => {
  test('is one part when the note has no heading at that level', () => {
    expect(sectionsOf('<p>one</p>\n<h2>two</h2>', 1)).toEqual(['<p>one</p>\n<h2>two</h2>'])
    expect(sectionsOf('', 1)).toEqual([''])
  })

  test('does not cut inside an element a heading was written in', () => {
    const quoted = '<h1>a</h1>\n<blockquote>\n<h1>b</h1>\n</blockquote>\n<h1>c</h1>\n'
    const parts = sectionsOf(quoted, 1)

    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('<blockquote>')
    expect(parts[1]).toBe('<h1>c</h1>\n')
  })
})
