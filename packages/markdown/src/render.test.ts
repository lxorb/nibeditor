import { describe, expect, test } from 'vitest'
// Both heavy libraries handed over outright, the way the Worker has them, because
// every render below is synchronous and the app's own lazy loading is engines.test.ts's
// subject rather than this file's. See engines.ts.
import './eager'
import {
  codeBlocks,
  documentTitle,
  frontMatter,
  frontMatterValue,
  renderMarkdown,
  stripFrontMatter,
} from './index'

describe('front matter', () => {
  test('is not rendered', () => {
    expect(renderMarkdown('---\ntitle: Hi\n---\n\nBody.\n')).not.toContain('title: Hi')
    expect(renderMarkdown('---\ntitle: Hi\n---\n\nBody.\n')).toContain('Body.')
  })

  test('can be read on its own', () => {
    expect(frontMatter('---\ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
    expect(frontMatter('No front matter')).toBeNull()
  })

  test('leaves a document without it alone', () => {
    expect(stripFrontMatter('# Title')).toBe('# Title')
  })

  /** Obsidian's rule, and so the app's: the block has to close. A note that opens
   *  with a fence and never closes it opens with a rule, so the renderer draws
   *  those lines as the words they are and the properties table stays away. The
   *  same note is searched in search/match.test.ts and in matcher.rs, which is
   *  what the fixture is for: three readers, one answer. */
  test('a block nobody closed is the note’s own words', () => {
    const open = '---\nstatus: done\n\n# Plan\n'
    const html = renderMarkdown(open, { properties: 'properties' })

    expect(frontMatter(open)).toBeNull()
    expect(stripFrontMatter(open)).toBe(open)
    expect(html).toContain('status: done')
    expect(html).not.toContain('class="properties"')
  })

  test('answers a single field', () => {
    const source = '---\ntitle: "Field Notes"\nauthor: Ada\nexport:\n  paper: A5\n---\n\nBody'

    expect(frontMatterValue(source, 'title')).toBe('Field Notes')
    expect(frontMatterValue(source, 'author')).toBe('Ada')
    expect(frontMatterValue(source, 'paper')).toBeNull()
    expect(frontMatterValue(source, 'missing')).toBeNull()
    expect(frontMatterValue('# No matter', 'title')).toBeNull()
  })
})

describe('titles', () => {
  test('reads the first heading', () => {
    expect(documentTitle('---\na: b\n---\n\n# Real title\n\ntext')).toBe('Real title')
  })

  test('is null when there is no heading', () => {
    expect(documentTitle('just text')).toBeNull()
  })
})

/** A single newline. Prose flows, so CommonMark makes a space of it; a slide is
 *  a poster, so a deck keeps the break. One flag, asked for per render, so the
 *  two shared renderers serve both without one leaking into the other. */
describe('a single newline', () => {
  test('is a space, which is what CommonMark says', () => {
    expect(renderMarkdown('one\ntwo')).toContain('one\ntwo')
    expect(renderMarkdown('one\ntwo')).not.toContain('<br>')
  })

  test('is a line break when asked for', () => {
    expect(renderMarkdown('one\ntwo', { breaks: true })).toContain('one<br>two')
  })

  test('and asking does not change the next render that does not', () => {
    // The two plain renderers are built once and shared; a flag written into one
    // of them would turn every note in the app into a poster.
    renderMarkdown('one\ntwo', { breaks: true })
    expect(renderMarkdown('one\ntwo')).not.toContain('<br>')
  })

  test('a blank line is still a paragraph either way', () => {
    for (const options of [{}, { breaks: true }]) {
      const html = renderMarkdown('one\n\ntwo', options)
      expect(html).toContain('<p>one</p>')
      expect(html).toContain('<p>two</p>')
    }
  })

  test('and the two-space hard break still works either way', () => {
    expect(renderMarkdown('one  \ntwo')).toContain('one<br>two')
    expect(renderMarkdown('one  \ntwo', { breaks: true })).toContain('one<br>two')
  })

  test('a list is still a list, not one item with breaks in it', () => {
    const html = renderMarkdown('- one\n- two\n', { breaks: true })
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  test('and a fence keeps its own newlines', () => {
    const html = renderMarkdown('```\none\ntwo\n```\n', { breaks: true })
    expect(html).not.toContain('<br>')
  })
})

describe('GitHub-flavoured basics', () => {
  test('renders headings, emphasis and code', () => {
    const html = renderMarkdown('# H\n\n**b** *i* `c`')
    expect(html).toContain('<h1>H</h1>')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<code>c</code>')
  })

  test('renders tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  test('renders task lists', () => {
    const html = renderMarkdown('- [x] done\n- [ ] open')
    expect(html).toContain('checked')
  })

  test('marks task items so a stylesheet can draw them', () => {
    const html = renderMarkdown('- [x] done\n- [ ] open\n- plain')

    expect(html).toContain('<li class="task-list-item is-done"><input checked=""')
    expect(html).toContain('<li class="task-list-item"><input disabled=""')
    expect(html).toContain('<li>plain</li>')
  })

  test('marks a link whose text is its address', () => {
    const html = renderMarkdown('See <https://a.dev> or https://b.dev or [here](https://c.dev).')

    expect(html).toContain('<a class="url" href="https://a.dev">https://a.dev</a>')
    expect(html).toContain('<a class="url" href="https://b.dev">https://b.dev</a>')
    expect(html).toContain('<a href="https://c.dev">here</a>')
  })
})

/** Where a plain `[words](../Other note.md)` points, on a surface that knows.
 *
 *  A wikilink has always been resolved by the caller, because only the caller
 *  knows where a note lives. A markdown link naming a note in the same space was
 *  left exactly as written - which is right in the app, where a click is read at
 *  the moment it happens, and wrong on a published page, where the HTML is all a
 *  stranger gets: the site serves `/public/two` and the link said
 *  `../Public/Two.md`, so following one answered 404.
 *
 *  So: a surface that can say where a note is published says so through
 *  `resolveNoteHref`, and a surface that cannot passes nothing and the link is
 *  left as it was written. */
describe('a markdown link that names a note', () => {
  const resolveNoteHref = (target: string) =>
    target.toLowerCase().endsWith('two.md') ? '/public/two' : null

  test('is left exactly as written where nobody can resolve it', () => {
    const html = renderMarkdown('see [the other](../Public/Two.md)')
    expect(html).toContain('<a href="../Public/Two.md">the other</a>')
  })

  test('points where the note is published where somebody can', () => {
    const html = renderMarkdown('see [the other](../Public/Two.md)', { resolveNoteHref })
    expect(html).toContain('<a href="/public/two">the other</a>')
  })

  test('keeps the heading the link named', () => {
    const html = renderMarkdown('see [there](../Public/Two.md#some-heading)', { resolveNoteHref })
    expect(html).toContain('<a href="/public/two#some-heading">there</a>')
  })

  test('and a note nobody published is words, the way an unresolved wikilink is', () => {
    const html = renderMarkdown('see [a draft](../Drafts/Three.md)', { resolveNoteHref })
    expect(html).toContain('a draft')
    expect(html).not.toContain('<a href="../Drafts/Three.md"')
  })

  test('leaves everything that is not a note alone', () => {
    const html = renderMarkdown(
      'see [out](https://example.org/a.md) and [up](/already/there) and [it](#here)',
      { resolveNoteHref },
    )

    expect(html).toContain('href="https://example.org/a.md"')
    expect(html).toContain('href="/already/there"')
    expect(html).toContain('href="#here"')
  })
})

describe('headings and the table of contents', () => {
  const SOURCE =
    '# Title\n\n[toc]\n\n## Two words\n\n### Deeper, *with* `code`\n\n## Two words\n\nText'

  test('are plain by default', () => {
    const html = renderMarkdown(SOURCE)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>[toc]</p>')
  })

  test('get ids from their text when asked', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).toContain('<h1 id="title">Title</h1>')
    expect(html).toContain('<h2 id="two-words">Two words</h2>')
    expect(html).toContain('<h3 id="deeper-with-code">Deeper, <em>with</em> <code>code</code></h3>')
  })

  test('keep ids apart when two headings read the same', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).toContain('<h2 id="two-words-1">Two words</h2>')
  })

  test('turn [toc] into nested links', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).not.toContain('[toc]')
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#title">Title</a>')
    expect(html).toContain('<a href="#deeper-with-code">Deeper, with code</a>')
    expect(html).toMatch(
      /<li><a href="#two-words">Two words<\/a>\n?<ul>\n?<li><a href="#deeper-with-code">/,
    )
  })

  test('accept [TOC] in capitals, as Typora does', () => {
    expect(renderMarkdown('# A\n\n[TOC]\n', { toc: true })).toContain('<nav class="toc">')
  })

  test('leave a [toc] in running text alone', () => {
    expect(renderMarkdown('see [toc] here', { toc: true })).toContain('see [toc] here')
  })

  test('render nothing for a [toc] in a document without headings', () => {
    expect(renderMarkdown('[toc]\n\ntext', { toc: true })).not.toContain('<nav')
  })
})

describe('code fences', () => {
  test('are listed with their language', () => {
    const blocks = codeBlocks(
      '```js\nlet a\n```\n\n- item\n\n  ```mermaid\n  graph TD\n  ```\n\n```\nplain\n```',
    )

    expect(blocks).toEqual([
      { language: 'js', code: 'let a' },
      { language: 'mermaid', code: 'graph TD' },
      { language: '', code: 'plain' },
    ])
  })

  test('can be taken over by the caller', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n```\n\n```js\nlet a = 1 < 2\n```', {
      code: (code, language) => (language === 'mermaid' ? `<figure>${code}</figure>` : null),
    })

    expect(html).toContain('<figure>graph TD</figure>')
    expect(html).toContain('<pre><code class="language-js">let a = 1 &lt; 2\n</code></pre>')
  })

  test('are listed under the language alone, whatever else the fence says', () => {
    // What a caller loads a parser for, and what it matches a drawing against.
    expect(codeBlocks('```ts src/main.ts\nlet a\n```')).toEqual([{ language: 'ts', code: 'let a' }])
  })

  test('say what they are, over the block', () => {
    const html = renderMarkdown('```ts src/main.ts\nlet a = 1\n```')

    expect(html).toContain('<figure class="code">')
    expect(html).toContain('<figcaption>src/main.ts</figcaption>')
    // The language is the first word, so the block is coloured as TypeScript
    // rather than as a language nobody has.
    expect(html).toContain('<code class="language-ts">')
  })

  test('are left alone when they say nothing but their language', () => {
    expect(renderMarkdown('```ts\nlet a = 1\n```')).not.toContain('<figure')
  })

  test('keep a caller’s own frame rather than being framed twice', () => {
    const html = renderMarkdown('```mermaid Architecture\ngraph TD\n```', {
      code: (code) => `<figure class="diagram">${code}</figure>`,
    })

    expect(html).toContain('<figure class="diagram">graph TD</figure>')
    expect(html).not.toContain('figcaption')
  })

  test('renders strikethrough', () => {
    expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>')
  })
})

describe('Typora extensions', () => {
  test('highlights', () => {
    expect(renderMarkdown('a ==marked== b')).toContain('<mark>marked</mark>')
  })

  test('subscript and superscript', () => {
    const html = renderMarkdown('H~2~O and X^2^')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
  })

  test('inline math', () => {
    const html = renderMarkdown('mass $E=mc^2$ here')
    expect(html).toContain('math-inline')
    expect(html).toContain('katex')
  })

  test('block math', () => {
    const html = renderMarkdown('$$\nE = mc^2\n$$\n')
    expect(html).toContain('math-block')
  })

  /** A whole line of `$$…$$` is how a formula is usually typed, and every other
   *  editor reads it that way. It used to come out as an inline formula with a
   *  literal dollar on each side of it. */
  test('block math written on one line', () => {
    const html = renderMarkdown('$$E = mc^2$$\n')

    expect(html).toContain('math-block')
    expect(html).not.toContain('math-inline')
    expect(html).not.toContain('$')
  })

  test('block math on one line among prose', () => {
    const html = renderMarkdown('Before.\n\n$$E = mc^2$$\n\nAfter.\n')

    expect(html).toContain('<p>Before.</p>')
    expect(html).toContain('math-block')
    expect(html).toContain('<p>After.</p>')
  })

  test('a one line block that is not the whole line is left alone', () => {
    // Display maths is a block; `$$` part way along a line is somebody's prose.
    const html = renderMarkdown('The sum $$E = mc^2$$ sits here.\n')

    expect(html).not.toContain('math-block')
  })

  test('an empty pair of double dollars is not a formula', () => {
    expect(renderMarkdown('$$$$\n')).not.toContain('math-block')
  })

  test('renders chemical equations', () => {
    const html = renderMarkdown('$\\ce{H2O}$')
    expect(html).toContain('katex')
    // mhchem splits the formula into atoms and a subscript.
    expect(html).toContain('H')
    expect(html).not.toContain('ParseError')
  })

  test('leaves a lone dollar alone', () => {
    expect(renderMarkdown('costs $5 and $9')).not.toContain('katex')
  })

  /** A formula says how big its own rules and struts are, and a note is not
   *  always the reader's own: one arrives from a share, from a room, or is
   *  published to strangers. Left uncapped, one line of TeX was a box tens of
   *  thousands of ems tall, which is a page nobody can read or scroll. */
  test('a formula cannot ask for a box bigger than the page', () => {
    const html = renderMarkdown('$$\\rule{99999em}{99999em}$$')
    expect(html).toContain('katex')
    expect(html).not.toContain('99999em')
    for (const size of html.matchAll(/(\d+(?:\.\d+)?)em/g)) {
      expect(Number(size[1])).toBeLessThanOrEqual(100)
    }
  })

  test('emoji shortcodes become characters', () => {
    expect(renderMarkdown('ship it :rocket:')).toContain('🚀')
    expect(renderMarkdown('ship it :rocket:')).not.toContain(':rocket:')
  })

  test('a lone colon is left alone', () => {
    expect(renderMarkdown('note: this stays')).toContain('note: this stays')
  })

  test('an unknown shortcode is left as written', () => {
    expect(renderMarkdown(':not_an_emoji_name:')).toContain(':not_an_emoji_name:')
  })

  test('callouts become labelled blocks', () => {
    const html = renderMarkdown('> [!WARNING]\n> Careful.\n')
    expect(html).toContain('data-callout="warning"')
    expect(html).toContain('class="callout callout-warning"')
    expect(html).toContain('<span>Warning</span>')
    expect(html).toContain('Careful.')
    expect(html).not.toContain('[!WARNING]')
  })

  test('a callout wears an icon of its own', () => {
    expect(renderMarkdown('> [!bug]\n> Broken.\n')).toContain('class="callout-icon"')
  })

  test('an alias wears the look it names and keeps the word that was written', () => {
    const html = renderMarkdown('> [!tldr]\n> The short of it.\n')
    expect(html).toContain('class="callout callout-abstract"')
    expect(html).toContain('data-callout="tldr"')
    expect(html).toContain('<span>TLDR</span>')
  })

  test('a type nothing knows is still a callout, under its own name', () => {
    const html = renderMarkdown('> [!recipe]\n> Flour, water, salt.\n')
    expect(html).toContain('<div class="callout" data-callout="recipe">')
    expect(html).toContain('<span>Recipe</span>')
    expect(html).not.toContain('callout-icon')
    expect(html).toContain('Flour, water, salt.')
  })

  test('a title of the writer’s own stands in for the type', () => {
    const html = renderMarkdown('> [!tip] Mind the gap\n> Between the train and the platform.\n')
    expect(html).toContain('<span>Mind the gap</span>')
    expect(html).toContain('Between the train and the platform.')
    expect(html).not.toContain('Mind the gap</p>\n<p>Mind the gap')
  })

  test('the marker goes and what was written beside it stays', () => {
    const html = renderMarkdown('> [!note] Read this\n> Some **bold** words and $x$ too.\n')
    expect(html).not.toContain('[!note]')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('katex')
  })

  test('the fold sign is not words', () => {
    const html = renderMarkdown('> [!warning]- Shut\n> Behind it.\n')
    expect(html).toContain('<span>Shut</span>')
    expect(html).not.toContain(']-')
  })

  test('a fold sign makes the callout a details, shut on a minus', () => {
    const html = renderMarkdown('> [!warning]- Shut\n> Behind it.\n')
    expect(html).toContain('<details class="callout callout-warning" data-callout="warning">')
    expect(html).toContain('<summary class="callout-title">')
    expect(html).toContain('class="callout-fold"')
    expect(html).toContain('Behind it.')
    expect(html).toContain('</details>')
  })

  test('a plus opens it, and leaves it foldable', () => {
    const html = renderMarkdown('> [!warning]+ Open\n> In front.\n')
    expect(html).toContain('data-callout="warning" open>')
    expect(html).toContain('<summary class="callout-title">')
  })

  test('no sign at all is a callout that does not fold', () => {
    const html = renderMarkdown('> [!warning]\n> Nothing to open.\n')
    expect(html).toContain('<div class="callout callout-warning" data-callout="warning">')
    expect(html).toContain('<p class="callout-title">')
    expect(html).not.toContain('callout-fold')
    expect(html).not.toContain('<details')
  })

  test('an ordinary quote stays a quote', () => {
    const html = renderMarkdown('> Just a quote.\n')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('callout')
  })

  test('footnotes link both ways', () => {
    const html = renderMarkdown('Text[^1].\n\n[^1]: The note.\n', { footnotes: true })
    expect(html).toContain('id="fnref-1"')
    expect(html).toContain('id="fn-1"')
    expect(html).toContain('<section class="footnotes">')
  })
})

describe('raw HTML', () => {
  // Typora passes inline HTML through, and so does this - embeds are a feature
  // of a local document.
  test('is preserved for local use', () => {
    expect(renderMarkdown('<u>underlined</u>')).toContain('<u>underlined</u>')
    expect(renderMarkdown('<video src="clip.mp4"></video>')).toContain('<video')
  })

  // A published note is served to strangers, and every blog on the shared
  // domain would otherwise be able to script every other one.
  test('is shown as text when publishing', () => {
    const html = renderMarkdown('<script>alert(1)</script>', { escapeHtml: true })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('escapes inline HTML too', () => {
    const html = renderMarkdown('text <img src=x onerror=alert(1)> more', { escapeHtml: true })
    expect(html).not.toContain('onerror=alert(1)>')
    expect(html).toContain('&lt;img')
  })

  test('markdown itself still renders when publishing', () => {
    const html = renderMarkdown('# Title\n\n**bold** and [a link](https://x.dev)', {
      escapeHtml: true,
    })
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="https://x.dev"')
  })
})

describe('an <iframe> a note wrote', () => {
  const TAG = '<iframe src="https://field.example.test/plan" height="300"></iframe>'

  // Both surfaces, because the claim is that there is one card: the frame is
  // never in the markup, so a note that mentions a page tells that page nothing
  // until a reader asks it to.
  test('is the same card whether the note is the reader’s own or a public page', () => {
    for (const options of [{}, { escapeHtml: true }]) {
      const html = renderMarkdown(`${TAG}\n`, options)
      expect(html, JSON.stringify(options)).toContain('class="embed-web embed-page"')
      expect(html, JSON.stringify(options)).toContain('field.example.test')
      expect(html, JSON.stringify(options)).toContain(
        'data-frame="https://field.example.test/plan"',
      )
      expect(html, JSON.stringify(options)).not.toContain('<iframe')
    }
  })

  test('and on a page, which runs nothing, the card is a link to the page itself', () => {
    expect(renderMarkdown(`${TAG}\n`, { escapeHtml: true })).toContain(
      'href="https://field.example.test/plan"',
    )
  })

  test('inside a sentence as well as on a line of its own', () => {
    const html = renderMarkdown(`See ${TAG} for the plan.\n`)
    expect(html).toContain('class="embed-web embed-page"')
    // The closing half goes with the opening one. Left behind it is a tag the
    // parser drops without a word here and four characters of text on a page.
    expect(html).not.toContain('iframe>')
    expect(renderMarkdown(`See ${TAG} for the plan.\n`, { escapeHtml: true })).not.toContain(
      'iframe',
    )
  })

  test('and a tag pointing where a browser will not frame is nothing at all', () => {
    // The card or nothing, and never the tag: a frame at `javascript:`, at a page
    // of this app's own, or at plain http is a frame a note may not have, and one
    // left in the markup would be a real frame in a document that is trusted.
    for (const tag of [
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="/index.html"></iframe>',
      '<iframe src="http://x.dev/a"></iframe>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    ]) {
      for (const options of [{}, { escapeHtml: true }]) {
        expect(renderMarkdown(`${tag}\n`, options), tag).not.toContain('iframe')
      }
    }
  })

  /** The card is a construct that builds its own markup out of the note, which is
   *  the family of thing `HOSTILE` below is a sweep over; this is that sweep for
   *  the one construct made out of a tag rather than out of markdown. */
  test('and nothing a tag carried can run on a page built from it', () => {
    for (const tag of [
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="https://x.dev/a" onload="alert(1)"></iframe>',
      '<iframe src="https://x.dev/a?q=1&quot; onload=&quot;alert(1)"></iframe>',
      '<iframe src=\'https://x.dev/"onload="alert(1)\'></iframe>',
      '<iframe src="https://x.dev/a" height="1" onmouseover="alert(1)"></iframe>',
    ]) {
      expect(running(renderMarkdown(`${tag}\n`, { escapeHtml: true })), tag).toEqual([])
    }
  })
})

/** The one place a note's own code runs, and the two answers about whose note it
 *  is. `escapeHtml` is how the app says which: a document of the reader's own is
 *  markup, and one in a room, in a shared space or on a published page is the
 *  characters it is made of. See `apps/desktop/src/lib/trust.ts`. */
describe('a block of HTML that does something', () => {
  const BLOCK = '<div id="dial">nothing yet</div>\n<script>alert(1)</script>\n'

  test('is a card that runs it elsewhere, in a document that is the reader’s own', () => {
    const html = renderMarkdown(BLOCK)
    expect(html).toContain('class="embed-web embed-html"')
    expect(html).toContain('data-srcdoc=')
    // Not on the page: not the div, not the script, not one character of either.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<div id="dial"')
  })

  test('and is the characters it is made of in a note somebody else can reach', () => {
    const html = renderMarkdown(BLOCK, { escapeHtml: true })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('embed-html')
    expect(html).not.toContain('data-srcdoc=')
  })

  test('HTML that only shows something is markup in the first and text in the second', () => {
    expect(renderMarkdown('<div class="two-up">text</div>\n')).toContain('<div class="two-up">')
    expect(renderMarkdown('<div class="two-up">text</div>\n', { escapeHtml: true })).toContain(
      '&lt;div',
    )
  })
})

describe('definition lists', () => {
  test('renders a term and its meaning', () => {
    expect(renderMarkdown('Markdown\n: A way of writing.\n')).toContain('<dt>Markdown</dt>')
    expect(renderMarkdown('Markdown\n: A way of writing.\n')).toContain(
      '<dd>A way of writing.</dd>',
    )
  })

  test('takes several meanings for one term', () => {
    const html = renderMarkdown('Nib\n: A pen tip.\n: This editor.\n')
    expect(html.match(/<dd>/g)).toHaveLength(2)
  })

  test('takes several terms in one list', () => {
    const html = renderMarkdown('One\n: first\n\nTwo\n: second\n')
    expect(html.match(/<dt>/g)).toHaveLength(2)
  })

  test('formats inside a term and a meaning', () => {
    const html = renderMarkdown('**Bold**\n: with *emphasis*\n')
    expect(html).toContain('<dt><strong>Bold</strong></dt>')
    expect(html).toContain('<em>emphasis</em>')
  })

  test('leaves a plain paragraph alone', () => {
    const html = renderMarkdown('Just a line of prose.\n')
    expect(html).not.toContain('<dl>')
  })

  test('leaves a colon in prose alone', () => {
    expect(renderMarkdown('Note: this is prose.\n')).not.toContain('<dl>')
  })
})

describe('abbreviations', () => {
  const SOURCE = '*[HTML]: HyperText Markup Language\n\nI write HTML every day.\n'

  test('expands a defined word', () => {
    expect(renderMarkdown(SOURCE)).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  test('does not print the definition itself', () => {
    expect(renderMarkdown(SOURCE)).not.toContain('*[HTML]')
  })

  test('works when the definition comes after the use', () => {
    const html = renderMarkdown('I write HTML.\n\n*[HTML]: HyperText Markup Language\n')
    expect(html).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  test('leaves code alone', () => {
    const html = renderMarkdown('*[HTML]: HyperText Markup Language\n\n`HTML` and HTML\n')
    expect(html).toContain('<code>HTML</code>')
    expect(html.match(/<abbr/g)).toHaveLength(1)
  })

  test('does not reach inside an attribute', () => {
    const html = renderMarkdown('*[HTML]: Markup\n\n[link](https://e.com/HTML)\n')
    expect(html).toContain('href="https://e.com/HTML"')
  })

  test('matches whole words only', () => {
    const html = renderMarkdown('*[IT]: Information Technology\n\nlittle bits\n')
    expect(html).not.toContain('<abbr')
  })

  test('prefers the longer of two definitions', () => {
    const html = renderMarkdown('*[HTML]: Markup\n*[HTML5]: Newer markup\n\nHTML5 is here.\n')
    expect(html).toContain('<abbr title="Newer markup">HTML5</abbr>')
  })

  test('escapes what it puts in the title', () => {
    const html = renderMarkdown('*[X]: a "quoted" <thing>\n\nX marks it.\n')
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).not.toContain('<thing>')
  })

  test('a definition inside a fence defines nothing', () => {
    // A note explaining the syntax shows the syntax, and showing it must not
    // also do it - which is the rule the block tokenizer already follows.
    const html = renderMarkdown('```\n*[HTML]: Markup\n```\n\nHTML here.\n')
    expect(html).not.toContain('<abbr')
    expect(html).toContain('*[HTML]: Markup')
  })

  test('a fence carrying a language does not close the fence above it', () => {
    // A note showing two blocks: the second ``` line names a language, which
    // CommonMark allows only on the line that opens a block. Read as a closing
    // fence it let the lines after it define words the note was only showing.
    const html = renderMarkdown('```\n*[A]: one\n```ts\n*[B]: two\n```\n\nA and B.\n')
    expect(html).not.toContain('<abbr')
  })
})

/** Everything a note contains is written by whoever wrote the note, and a
 *  published one is served to strangers from a domain shared with every other
 *  blog. Escaping raw HTML is not enough on its own: a construct that builds
 *  its own markup out of the source, or writes a target the author chose into
 *  an attribute, is a way straight past it. Each case below was one. */
describe('what a note cannot do to the page around it', () => {
  const published = (source: string) => renderMarkdown(source, { escapeHtml: true })

  test('subscript and superscript are text, not markup', () => {
    expect(published('H~<img src=x onerror=alert(1)>~O')).not.toContain('<img src=x')
    expect(published('X^<img src=x onerror=alert(1)>^')).not.toContain('<img src=x')
    expect(published('a ~</p><script>alert(1)</script>~ b')).not.toContain('<script>')
  })

  test('subscript and superscript still render what they are for', () => {
    const html = published('H~2~O and X^2^')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
  })

  /** No element carries an event handler. The name itself may well appear in
   *  the page, as the words of the link a footnote shows; what matters is that
   *  it stays inside the attribute, or inside the text, it was put in. */
  const noHandlers = (html: string) => expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i)

  test('a footnote name cannot break out of the attribute it sits in', () => {
    const html = published('Text[^a"onmouseover=alert(1)].')
    noHandlers(html)
    expect(html).not.toContain('"onmouseover')
  })

  test('a footnote name cannot open a tag of its own', () => {
    expect(published('Text[^<svg/onload=alert(1)>].')).not.toContain('<svg')
    noHandlers(published('T[^x].\n\n[^x"onmouseover=alert(1)]: note\n'))
  })

  test('a footnote still links both ways with an ordinary name', () => {
    const html = renderMarkdown('Text[^note-1].\n\n[^note-1]: The note.\n', { footnotes: true })
    expect(html).toContain('id="fnref-note-1"')
    expect(html).toContain('href="#fn-note-1"')
    expect(html).toContain('id="fn-note-1"')
  })

  test('a link cannot carry a scheme the browser would run', () => {
    for (const target of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const html = published(`[click](${target})`)
      expect(html, target).not.toContain('href=')
      expect(html).toContain('click')
    }
  })

  test('an entity in a target cannot grow into a scheme', () => {
    // These name no scheme as written, and would name one by the time anyone
    // clicked them. What stops them is the ampersand itself being escaped, so
    // the entity never forms.
    for (const target of ['javascript&colon;alert(1)', '&#106;avascript:alert(1)']) {
      const html = published(`[click](${target})`)
      expect(html, target).toContain('&amp;')
      expect(html, target).not.toMatch(/href="[^"]*javascript:/i)
    }
  })

  test('an image cannot either', () => {
    expect(published('![x](javascript:alert(1))')).not.toContain('src=')
    expect(published('![x](data:text/html,<script>alert(1)</script>)')).not.toContain('src=')
  })

  test('an autolink cannot either', () => {
    expect(published('<javascript:alert(1)>')).not.toContain('href=')
  })

  test('the links people actually write still work', () => {
    expect(published('[a](https://x.dev/p?q=1)')).toContain('href="https://x.dev/p?q=1"')
    expect(published('[a](http://x.dev)')).toContain('href="http://x.dev"')
    expect(published('[a](mailto:me@x.dev)')).toContain('href="mailto:me@x.dev"')
    expect(published('[a](#heading)')).toContain('href="#heading"')
    expect(published('[a](notes/other.md)')).toContain('href="notes/other.md"')
    expect(published('![a](pictures/cat.png)')).toContain('src="pictures/cat.png"')
    expect(published('![a](data:image/png;base64,iVBORw0KGgo=)')).toContain('src="data:image/png')
  })

  test('a link with no target yet is words, not a link to this page', () => {
    // `insertLink` writes `[label]()` and puts the caret in the empty target, so
    // a note saved mid-edit has one. An `href=""` points at the page it is on,
    // which is a worse answer than showing the label.
    const html = published('[label]()')
    expect(html).toContain('label')
    expect(html).not.toContain('href')
  })

  test('an ampersand in a URL is written as one entity', () => {
    const html = published('[a](https://x.dev/?a=1&b=2)')
    expect(html).toContain('href="https://x.dev/?a=1&amp;b=2"')
    expect(html).not.toContain('&amp;amp;')
  })
})

/** Every construct that can put a target or a piece of markup into the page,
 *  each with something hostile in it, and one check applied to all of them. A
 *  sweep rather than a case: it says nothing about what the output looks like,
 *  only that nothing in it can run. New constructs belong on this list. */
const HOSTILE = [
  '[a](javascript:alert(1))',
  '[a](  javascript:alert(1))',
  '[a](JAVASCRIPT:alert(1))',
  '[a](vbscript:msgbox(1))',
  '[a](data:text/html,BODY)',
  '<javascript:alert(1)>',
  '![a](javascript:alert(1))',
  '![a"onerror=alert(1)](x.png)',
  '![a](x.png "t\\"onerror=alert(1)")',
  '[a](x.md "t\\"onmouseover=alert(1)")',
  'H~IMG~O',
  'X^IMG^',
  '==IMG==',
  'a[^IMG]b',
  'a[^x"onmouseover=alert(1)]b',
  '[^x"onmouseover=alert(1)]: note',
  '# a"onmouseover=alert(1) b',
  '[toc]\n\n# a"onmouseover=alert(1) b',
  '*[X]: a"onmouseover=alert(1)\n\nX here.\n',
  'Term\n: IMG\n',
  '> [!note]\n> IMG\n',
  '$\\href{javascript:alert(1)}{x}$',
  '$\\htmlId{a"onmouseover=alert(1)}{x}$',
  '| a | b |\n| - | - |\n| IMG | x |',
  ':IMG:',
]

/** What `IMG` in the list above stands for. Written as a placeholder so the
 *  list can also be run through the trusting renderer, which passes raw HTML
 *  through on purpose - a source that carries a tag proves nothing there. */
const IMG = '<img src=x onerror=alert(1)>'

/** No element carries an event handler, and no target names a scheme a browser
 *  would run. */
function running(html: string): string[] {
  const found: string[] = []
  if (/<[a-z]+[^>]*\son[a-z]+\s*=/i.test(html)) found.push('an element with an event handler')
  if (/(?:href|src)="[^"]*(?:javascript|vbscript|data:text|svg\+xml)/i.test(html)) {
    found.push('a target that would run')
  }
  return found
}

describe('the whole sweep', () => {
  test('nothing a note writes can run, when publishing', () => {
    for (const source of HOSTILE) {
      const html = renderMarkdown(source.replaceAll('IMG', IMG), {
        escapeHtml: true,
        footnotes: true,
        toc: true,
      })
      expect(running(html), source).toEqual([])
    }
  })

  test('nor when rendering for a local export, raw HTML aside', () => {
    // Raw HTML passes through here by design, so `IMG` stands for words instead:
    // what is left under test is every construct that builds its own markup, and
    // none of those has raw HTML as an excuse.
    for (const source of HOSTILE) {
      const html = renderMarkdown(source.replaceAll('IMG', 'plain words'), {
        footnotes: true,
        toc: true,
      })
      expect(running(html), source).toEqual([])
    }
  })
})
