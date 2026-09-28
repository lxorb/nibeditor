import { type DOMWindow, JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
// Both heavy libraries handed over outright. In the app a formula is set by a render
// that has awaited them - `prepareFences` and `runExport` do - and these render
// synchronously; see @nib/markdown/engines.
import '@nib/markdown/eager'
import {
  buildHtml,
  localSources,
  PANDOC_FORMATS,
  prepareEmbeds,
  prepareFences,
  renderNote,
} from './export'
import { titleOf } from './export/document'
import { EXPORT_FORMATS } from './export/formats'

/** One of everything the renderer knows. */
const NOTE = `---
title: Meta
author: Ada Lovelace
lang: de
export:
  footer: \${title} - \${date}
---

# Handbook

[toc]

Prose with **strong**, ==marked==, H~2~O, $E=mc^2$, a [link](https://nib.dev) and <https://bare.dev>.

## Lists

- one
  - nested
- [x] done
- [ ] open

## Table

| a | b |
| - | - |
| 1 | 2 |

## Code

\`\`\`ts
const answer = 42
\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`

> [!NOTE]
> Careful.

$$
\\int_0^1 x\\,dx
$$

<div style="page-break-after: always;"></div>

![Picture](assets/pic.png)

Footnote[^1].

[^1]: The note.
`

describe('a styled export', () => {
  const html = buildHtml(NOTE, 'Handbook.md', { date: '2026-09-04' })

  test('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain('<meta charset="utf-8">')
  })

  test('takes title, author and language from the front matter', () => {
    expect(html).toContain('<title>Meta</title>')
    expect(html).toContain('<meta name="author" content="Ada Lovelace">')
    expect(html).toContain('<html lang="de"')
  })

  test('is light unless asked otherwise', () => {
    expect(html).toContain('data-theme="light"')
    expect(buildHtml(NOTE, 'Handbook.md', { scheme: 'dark' })).toContain('data-theme="dark"')
  })

  test('carries the theme, the export sheet and the accent with it', () => {
    expect(html).toContain('--bg:')
    expect(html).toContain('#write')
    expect(html).toContain('@media print')
    expect(html).toContain('--accent: #5b4be0')
    expect(buildHtml(NOTE, 'x.md', { accent: 'teal' })).toContain('--accent: #0f9b8e')
  })

  /** WebKit, which a Mac prints with, does not honour `break-after: avoid`, and a
   *  heading ended a page with its section on the next. The room a heading keeps
   *  under it is WebKit's alone, and never the last heading's, which has nothing to
   *  keep with. */
  test('keeps a heading with its section on paper in WebKit as well', () => {
    const print = html.slice(html.indexOf('@media print'))
    const webkit = print.slice(print.indexOf('@supports (hanging-punctuation: first)'))

    expect(print).toContain('break-after: avoid')
    expect(webkit).toContain('#write h2:not(:last-child)::after')
    expect(webkit).toContain('height: calc(11pt * 1.55 * 3)')
    expect(webkit).toContain('margin-bottom: calc(11pt * 1.55 * -3)')
  })

  test('needs no network to render maths', () => {
    expect(html).toContain('class="katex')
    expect(html).toContain('src:url(data:font/woff2;base64,')
    expect(html).not.toContain('url(fonts/')
    expect(html).not.toContain('cdn.jsdelivr')
    expect(html).not.toContain('<script')
  })

  test('leaves the maths stylesheet out of a note without any', () => {
    expect(buildHtml('# Plain\n\ntext', 'p.md')).not.toContain('font-family:KaTeX')
  })

  test('renders every construct', () => {
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<mark>marked</mark>')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('data-callout="note"')
    expect(html).toContain('<table>')
    expect(html).toContain('class="footnotes"')
    expect(html).toContain('<li class="task-list-item is-done">')
    expect(html).toContain('<div style="page-break-after: always;"></div>')
  })

  test('links the table of contents to the headings', () => {
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#lists">Lists</a>')
    expect(html).toContain('<h2 id="lists">Lists</h2>')
    expect(html).not.toContain('[toc]')
  })

  test('tells a bare link from a worded one', () => {
    expect(html).toContain('<a class="url" href="https://bare.dev">')
    expect(html).toContain('<a href="https://nib.dev">link</a>')
  })

  test('leaves front matter out', () => {
    expect(html).not.toContain('title: Meta')
    expect(html).not.toContain('Ada Lovelace</p>')
  })

  test('carries the paper and the running text', () => {
    expect(html).toContain('@page { size: A4 portrait; margin: 20mm; }')
    expect(html).toContain('<div class="running-footer">Meta - 2026-09-04</div>')
    expect(buildHtml('# Plain', 'p.md')).not.toContain('class="sheet"')
  })

  test('takes the paper from the settings when the note says nothing', () => {
    const page = {
      paper: 'Letter',
      orientation: 'landscape',
      margin: '1in',
      header: '',
      footer: '',
    } as const
    expect(buildHtml('# Plain', 'p.md', { page })).toContain(
      '@page { size: Letter landscape; margin: 1in; }',
    )
  })

  test('writes the code palette in', () => {
    expect(html).toContain('#write .hl-keyword { color: var(--accent); }')
    expect(buildHtml(NOTE, 'x.md', { codeTheme: 'github' })).toContain(
      '#write .hl-keyword { color: #cf222e; }',
    )
  })

  test('lets a theme file and custom css sit on top', () => {
    const styled = buildHtml(NOTE, 'x.md', { css: '#write { --custom: 1; }' })
    expect(styled.indexOf('--custom: 1')).toBeGreaterThan(styled.indexOf('@media print'))
  })

  test('leaves a fence as code until told otherwise', () => {
    expect(html).toContain('<pre><code class="language-mermaid">graph TD; A--&gt;B\n</code></pre>')
  })

  test('uses fences the caller prepared', () => {
    const styled = buildHtml(NOTE, 'x.md', {
      fence: (code, language) =>
        language === 'mermaid' ? `<figure class="diagram">${code}</figure>` : null,
    })
    expect(styled).toContain('<figure class="diagram">graph TD; A-->B</figure>')
  })
})

/** A document that has left the app takes the colours with it: the class the
 *  renderer writes and the rules that dress it are both in the sheet baked into
 *  the page, so a highlight is the same colour on paper as on screen. See
 *  highlights.ts in @nib/markdown and `--mark-*` in tokens.css. */
describe('a coloured highlight in an exported document', () => {
  const html = buildHtml('Be ==\u{1F534} careful== here.\n', 'x.md')

  test('wears the tone it named, and never the emoji', () => {
    expect(html).toContain('<mark class="tone-1">careful</mark>')
    expect(html).not.toContain('\u{1F534}')
  })

  test('carries the rule that colours it, and the tone it reads', () => {
    expect(html).toContain('mark.tone-1')
    expect(html).toContain('--mark-1')
    expect(html).toContain('--canvas-1')
  })
})

/** An exported document as a browser would hold it, less its paper. An `@page`
 *  rule has no selector, which jsdom reads as one that matches every element and
 *  then cannot rank; the size of the paper has no say in what is printed on it. */
function opened(html: string): DOMWindow {
  const { window } = new JSDOM(html)
  for (const sheet of window.document.styleSheets) {
    for (let at = sheet.cssRules.length - 1; at >= 0; at--) {
      if (sheet.cssRules[at]?.cssText.startsWith('@page')) sheet.deleteRule(at)
    }
  }
  return window
}

/** A column's side is the renderer's `align` attribute, and any `text-align` a
 *  sheet declares outranks one of those, so the theme has to hand it back. jsdom
 *  runs the cascade, specificity and all, over the sheets baked into the page:
 *  the same sheets the reading view wears and a published page is served. */
describe('an aligned table column in an exported document', () => {
  const window = opened(
    buildHtml(
      '| Name | Value | Unit | Note |\n| :-- | --: | :-: | --- |\n| mass | 42 | kg | dry |\n',
      'x.md',
    ),
  )
  const sides = [...window.document.querySelectorAll('th, td')].map((cell) =>
    window.getComputedStyle(cell).getPropertyValue('text-align'),
  )

  test('reads from the side the note gave it, in the header and the body alike', () => {
    expect(sides.slice(0, 3)).toEqual(['left', 'right', 'center'])
    expect(sides.slice(4, 7)).toEqual(['left', 'right', 'center'])
  })

  test('reads from where its words start when the note gave it none', () => {
    expect([sides[3], sides[7]]).toEqual(['start', 'start'])
  })
})

describe('a bare export', () => {
  const html = buildHtml(NOTE, 'Handbook.md', { bare: true })

  test('carries no styles', () => {
    expect(html).not.toContain('<style>')
    expect(html).not.toContain('--bg')
  })

  test('still carries the content and the metadata', () => {
    expect(html).toContain('<h1 id="handbook">Handbook</h1>')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<title>Meta</title>')
    expect(html).toContain('<meta name="author" content="Ada Lovelace">')
  })
})

describe('preparing fences', () => {
  const draw = async (code: string, language: string, scheme: string) =>
    `<svg data-language="${language}" data-scheme="${scheme}">${code}</svg>`

  test('draws diagrams and colours code', async () => {
    const fence = await prepareFences(NOTE, 'light', {}, draw)

    expect(fence('graph TD; A-->B', 'mermaid')).toBe(
      '<figure class="diagram" data-language="mermaid"><svg data-language="mermaid" data-scheme="light">graph TD; A-->B</svg></figure>\n',
    )
    expect(fence('const answer = 42', 'ts')).toContain('<span class="hl-keyword">const</span>')
    expect(fence('const answer = 42', 'ts')).toMatch(/^<pre><code class="language-ts">/)
  })

  test('leaves plain what it cannot draw or colour', async () => {
    const fence = await prepareFences(NOTE, 'light', {}, async () => {
      throw new Error('no browser here')
    })

    expect(fence('graph TD; A-->B', 'mermaid')).toBeNull()
    expect(fence('x', 'no-such-language')).toBeNull()
    expect(fence('x', '')).toBeNull()
  })

  test('skips colouring when asked, and still draws', async () => {
    const fence = await prepareFences(NOTE, 'dark', { highlight: false }, draw)

    expect(fence('const answer = 42', 'ts')).toBeNull()
    expect(fence('graph TD; A-->B', 'mermaid')).toContain('data-scheme="dark"')
  })
})

describe('rendering a whole note', () => {
  test('brings drawn fences and coloured code into the page', async () => {
    const html = await renderNote('```ts\nlet x = 1\n```', 'n.md')
    expect(html).toContain('<span class="hl-keyword">let</span>')
  })

  test('keeps a bare export free of colouring', async () => {
    const html = await renderNote('```ts\nlet x = 1\n```', 'n.md', { bare: true })
    expect(html).toContain('<pre><code class="language-ts">let x = 1\n</code></pre>')
  })

  test('brings an embedded note into the document', async () => {
    const html = await renderNote('# Holder\n\n![[Quote]]\n', 'n.md', {
      readNote: (target) =>
        Promise.resolve(target === 'Quote' ? '## Quoted\n\nThe words.\n' : null),
    })

    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('The words.')
    expect(html).toContain('<figcaption>Quote</figcaption>')
  })

  test('an embed of a note the space has not got reads as its own name', async () => {
    const html = await renderNote('![[Nowhere]]\n', 'n.md', {
      readNote: () => Promise.resolve(null),
    })

    expect(html).not.toContain('<figure class="embed">')
    expect(html).toContain('Nowhere')
  })

  test('a wikilink in a document has nowhere to point, so it reads as words', async () => {
    const html = await renderNote('see [[Other|the other one]]\n', 'n.md')
    expect(html).toContain('the other one')
    expect(html).not.toContain('wikilink')
  })
})

describe('preparing the notes a document embeds', () => {
  test('reads each named note once, whatever it is named in', async () => {
    const asked: string[] = []
    const resolve = await prepareEmbeds('![[A]]\n\n![[A]]\n\n![[B#Heading]]\n', (target) => {
      asked.push(target)
      return Promise.resolve(`body of ${target}`)
    })

    expect(asked.sort()).toEqual(['A', 'B'])
    expect(resolve({ target: 'A', heading: null, block: null, alias: null, embed: true })).toBe(
      'body of A',
    )
  })

  test('a plain link is not an embed and is not read', async () => {
    const asked: string[] = []
    await prepareEmbeds('see [[A]] now\n', (target) => {
      asked.push(target)
      return Promise.resolve(null)
    })

    expect(asked).toEqual([])
  })

  test('a note that cannot be read is simply left out', async () => {
    const resolve = await prepareEmbeds('![[A]]\n', () => Promise.reject(new Error('gone')))
    expect(
      resolve({ target: 'A', heading: null, block: null, alias: null, embed: true }),
    ).toBeNull()
  })
})

describe('naming the document', () => {
  test('prefers the front matter, then the first heading, then the file', () => {
    expect(titleOf('---\ntitle: Meta\n---\n# Head', 'file.md')).toBe('Meta')
    expect(titleOf('# Head\n', 'file.md')).toBe('Head')
    expect(titleOf('text', 'file.md')).toBe('file')
  })
})

describe('pandoc formats', () => {
  test('cover the rest of what Typora offers', () => {
    const ids = PANDOC_FORMATS.map((format) => format.id)
    for (const expected of ['odt', 'latex', 'mediawiki', 'rst', 'textile', 'opml', 'revealjs']) {
      expect(ids).toContain(expected)
    }
  })

  /** Nib writes its own Word, RTF and ePub, with the diagrams drawn, the code
   *  coloured and the pictures carried. Offering pandoc's as well would mean one
   *  format came out two ways depending on the machine, and a row that appeared
   *  only where pandoc happened to be installed. */
  test('leave out the three Nib writes itself', () => {
    const ids = PANDOC_FORMATS.map((format) => format.id)
    for (const own of ['docx', 'rtf', 'epub']) {
      expect(ids, own).not.toContain(own)
    }
  })

  test('never name a format the export list already has', () => {
    const own = new Set<string>(EXPORT_FORMATS.map((format) => format.id))
    expect(PANDOC_FORMATS.filter((format) => own.has(format.id))).toEqual([])
  })

  test('each names the file extension it produces', () => {
    for (const format of PANDOC_FORMATS) {
      expect(format.extension).toMatch(/^[a-z]+$/)
    }
  })
})

describe('finding local images', () => {
  test('picks out the paths that are files', () => {
    const html =
      '<img src="a.png"><img src="assets/b.jpg" alt="x"><img src="https://e.com/c.png">' +
      '<img src="data:image/png;base64,AAA"><img src="//e.com/d.png">'

    expect(localSources(html)).toEqual(['a.png', 'assets/b.jpg'])
  })

  test('lists each path once', () => {
    expect(localSources('<img src="a.png"><img src="a.png">')).toEqual(['a.png'])
  })

  test('finds nothing in a page without images', () => {
    expect(localSources('<p>text</p>')).toEqual([])
  })
})
