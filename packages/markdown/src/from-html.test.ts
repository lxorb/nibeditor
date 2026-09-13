import { describe, expect, test } from 'vitest'
import { htmlToMarkdown, NEVER, workDone } from './from-html'

describe('a page as markdown', () => {
  test('headings and emphasis become markdown', () => {
    expect(htmlToMarkdown('<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '## Title\n\n**bold** and *italic*',
    )
  })

  test('links keep their target', () => {
    expect(htmlToMarkdown('<a href="https://x.dev">site</a>')).toBe('[site](https://x.dev)')
  })

  /** A note outlives the page it was clipped from, and every surface refuses these
   *  when it renders one - so the file does not carry them either. The words stay,
   *  which is what an unresolvable link is anywhere. */
  test('a target no surface would follow is not written down', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe('click')
    expect(htmlToMarkdown('<a href="data:text/html,<b>hi">click</a>')).toBe('click')
    expect(htmlToMarkdown('<a href="vbscript:msgbox">click</a>')).toBe('click')
    // Written with a character a browser skips while it reads a scheme.
    expect(htmlToMarkdown('<a href="java&#9;script:alert(1)">click</a>')).toBe('click')
  })

  /** An address into the app a note came from is a fact about where the note used to
   *  live. Only for an import, which is the one caller reading an export; see
   *  `appTargets`. */
  describe('a link into the app the note came from', () => {
    test('is words for a clip and a paste, which have no app to point back at', () => {
      expect(htmlToMarkdown('<a href="applenotes:note/ideas">Ideas</a>')).toBe('Ideas')
    })

    test('and stays a link for an import, exactly as it was written', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="applenotes:note/ideas">Ideas</a>', kept)).toBe(
        '[Ideas](applenotes:note/ideas)',
      )
      expect(htmlToMarkdown('<a href="bear://x-callback-url/open-note?id=1">Plan</a>', kept)).toBe(
        '[Plan](bear://x-callback-url/open-note?id=1)',
      )
      expect(htmlToMarkdown('<a href="evernote:///view/1/s1/abc/abc/">Note</a>', kept)).toBe(
        '[Note](evernote:///view/1/s1/abc/abc/)',
      )
    })

    test('and never one that runs code, whoever is asking', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="vbscript:msgbox">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="data:text/html,<b>hi">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="blob:https://x.dev/abc">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="java&#9;script:alert(1)">click</a>', kept)).toBe('click')
    })

    test('and a picture is still only ever a picture', () => {
      expect(
        htmlToMarkdown('<img src="applenotes:note/ideas" alt="a">', { appTargets: true }),
      ).toBe('')
    })

    test('while http, a path and a fragment are what they always were', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="https://x.dev">site</a>', kept)).toBe('[site](https://x.dev)')
      expect(htmlToMarkdown('<a href="notes/plan.md">plan</a>', kept)).toBe('[plan](notes/plan.md)')
      expect(htmlToMarkdown('<a href="#later">later</a>', kept)).toBe('[later](#later)')
    })
  })

  test('and neither is a picture that is a document rather than a picture', () => {
    expect(htmlToMarkdown('<img src="data:image/svg+xml,<svg onload=x>" alt="a">')).toBe('')
    expect(htmlToMarkdown('<img src="javascript:alert(1)" alt="a">')).toBe('')

    // A small picture may still travel inside the document.
    expect(htmlToMarkdown('<img src="data:image/png;base64,AAA" alt="a">')).toBe(
      '![a](data:image/png;base64,AAA)',
    )
  })

  /** The imports are the one caller whose addresses are not finished: macOS writes
   *  `file:///Users/…/photo.png` into the HTML it hands out, and the file is usually
   *  one of the files arriving beside the note. */
  test('and a file on the old machine survives for the caller that resolves one', () => {
    const html = '<p><img src="file:///Users/emil/photo.png"></p>'

    expect(htmlToMarkdown(html)).toBe('')
    expect(htmlToMarkdown(html, { fileTargets: true })).toBe('![](file:///Users/emil/photo.png)')

    const link = '<a href="file:///Users/emil/Notes/Other.html">other</a>'
    expect(htmlToMarkdown(link)).toBe('other')
    expect(htmlToMarkdown(link, { fileTargets: true })).toBe(
      '[other](file:///Users/emil/Notes/Other.html)',
    )
  })

  test('while that caller still gets no target a note could never follow', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">x</a>', { fileTargets: true })).toBe('x')
    expect(
      htmlToMarkdown('<img src="data:image/svg+xml,<svg>" alt="a">', { fileTargets: true }),
    ).toBe('')
  })

  test('while the ones a note is full of are', () => {
    expect(htmlToMarkdown('<a href="mailto:a@b.dev">mail</a>')).toBe('[mail](mailto:a@b.dev)')
    expect(htmlToMarkdown('<a href="/notes/Plan.md">plan</a>')).toBe('[plan](/notes/Plan.md)')
    expect(htmlToMarkdown('<a href="tel:+41000">ring</a>')).toBe('[ring](tel:+41000)')
  })

  /** An address is an address whichever attribute carried it. Turndown escapes the
   *  one in an `href` rather than encoding it, and a `\` the page put there
   *  escaped the escape: the destination ended at the bracket after it and the
   *  rest of the attribute became a link of the page's own, pointing wherever the
   *  page said. */
  test('an address cannot write a link of its own', () => {
    expect(htmlToMarkdown('<a href="https://x.test/a\\)[click](https://evil.test)">text</a>')).toBe(
      '[text](https://x.test/a%5C%29[click]%28https://evil.test%29)',
    )

    expect(htmlToMarkdown('<a href="https://x.test/a)[click](https://evil.test)">text</a>')).toBe(
      '[text](https://x.test/a%29[click]%28https://evil.test%29)',
    )
  })

  /** The words a link shows arrive as markdown - the emphasis inside it, or a
   *  picture of its own - and their text has been escaped on the way, backslash
   *  and brackets together. So they are written as they came, and a page cannot
   *  close the brackets early from inside them. */
  test('a backslash in a link text cannot close its brackets', () => {
    expect(htmlToMarkdown('<a href="https://x.test/ok">a\\](https://evil.test)[b</a>')).toBe(
      '[a\\\\\\](https://evil.test)\\[b](https://x.test/ok)',
    )
  })

  test('the brackets an ordinary address carries stay in the link', () => {
    expect(htmlToMarkdown('<a href="https://x.test/File_(1).html">t</a>')).toBe(
      '[t](https://x.test/File_%281%29.html)',
    )
  })

  test("a link's address is not encoded twice either", () => {
    expect(htmlToMarkdown('<a href="https://x.test/a%20b.html">t</a>')).toBe(
      '[t](https://x.test/a%20b.html)',
    )
  })

  /** A link keeps the title the page gave it, where a picture drops it: a link's
   *  address is the page's own, so there is no numbered placeholder for a title to
   *  stand in front of. Escaping the quote is not enough on its own - a title
   *  ending in `\` escaped the quote that was to close it. */
  test('a title cannot end its own quotes', () => {
    expect(htmlToMarkdown('<a href="https://x.test/ok" title="he said &quot;hi&quot;">t</a>')).toBe(
      '[t](https://x.test/ok "he said \\"hi\\"")',
    )

    expect(htmlToMarkdown('<a href="https://x.test/ok" title="ends in a\\">t</a>')).toBe(
      '[t](https://x.test/ok "ends in a\\\\")',
    )
  })

  /** The markers are the editor's own: one space after a bullet, not three. Both
   *  converters used to have their own opinion about this, and a page pasted into
   *  a note came out differently from the same page clipped into one. */
  test('lists get the markers the editor itself writes', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  test('a numbered list keeps the number it started on', () => {
    expect(htmlToMarkdown('<ol start="3"><li>three</li><li>four</li></ol>')).toBe(
      '3. three\n4. four',
    )
  })

  /** A long list is a page somebody pastes, and every item of it has to know its
   *  place among the others. Looked up by walking the list, that was a walk per
   *  item: five thousand items cost 93 ms on the machine this was written on and
   *  41 ms once each list is counted out once, and ten thousand of them 415 ms
   *  against 206 ms.
   *
   *  Counted rather than timed. This held a stopwatch to the conversion and asked
   *  for under a second; a runner with the rest of the suite on it answered
   *  1,400 ms and failed a test that had found nothing wrong, and the same commit
   *  had passed on its own minutes earlier. A wall-clock figure here measures the
   *  queue in front of the code as much as the code, while `workDone` in
   *  from-html.ts says what the numbering actually did - and says it the same way
   *  on a loaded machine as on an idle one.
   *
   *  What it says is the whole point of the test: one list counted out once, every
   *  item asking it where it sits, and the list walked its own length between them
   *  rather than its length for each line of it. */
  test('a list of five thousand items is numbered without a pass each', () => {
    const items = 5000
    const html = `<ol>${Array.from({ length: items }, (_, at) => `<li>item ${at}</li>`).join('')}</ol>`

    // Whatever an earlier conversion left counted, dropped, so what comes back is
    // this one's own.
    workDone()
    const lines = htmlToMarkdown(html).split('\n')
    const work = workDone()

    expect(lines).toHaveLength(items)
    expect(lines[0]).toBe('1. item 0')
    expect(lines.at(-1)).toBe(`${items}. item ${items - 1}`)

    // One list, counted out once, and every item of it asking where it sits.
    expect(work.lists).toBe(1)
    expect(work.items).toBe(items)
    // And the list walked exactly once over: a return to a walk per item would
    // make this twenty five million rather than five thousand.
    expect(work.walked).toBe(items)
  })

  test('nested lines line up under the text above them', () => {
    expect(htmlToMarkdown('<ul><li>one<ul><li>under</li></ul></li></ul>')).toBe('- one\n  - under')
  })

  test('a ticked item keeps one space between its box and its words', () => {
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked>done</li></ul>')).toBe(
      '- [x] done',
    )
  })

  test('code blocks keep their fence and the language the page named', () => {
    const markdown = htmlToMarkdown('<pre><code class="language-ts">let x = 1</code></pre>')
    expect(markdown).toBe('```ts\nlet x = 1\n```')
  })

  test('a fence long enough to hold code that is itself full of backticks', () => {
    const markdown = htmlToMarkdown('<pre><code>a ``` b</code></pre>')
    expect(markdown).toBe('````\na ``` b\n````')
  })

  test('a preformatted block with no code element inside it still fences', () => {
    expect(htmlToMarkdown('<pre>  indented\n  lines</pre>')).toBe('```\n  indented\n  lines\n```')
  })

  test('the older spelling of the language class reads too, and either half may carry it', () => {
    expect(htmlToMarkdown('<pre><code class="lang-py">x = 1</code></pre>')).toBe(
      '```py\nx = 1\n```',
    )
    expect(htmlToMarkdown('<pre class="language-go"><code>x := 1</code></pre>')).toBe(
      '```go\nx := 1\n```',
    )
  })

  /** What the highlighters write now. Shiki puts the language in an attribute and
   *  in no class at all, and the docs of half the tools anybody clips are built
   *  with it, so the fence used to come out bare. */
  test('the attribute the highlighters name the language in reads as well', () => {
    expect(
      htmlToMarkdown('<pre data-language="js" class="shiki"><code>let x = 1</code></pre>'),
    ).toBe('```js\nlet x = 1\n```')

    expect(htmlToMarkdown('<pre><code data-lang="rust">let x = 1;</code></pre>')).toBe(
      '```rust\nlet x = 1;\n```',
    )
  })

  /** The language comes off the page's own markup, so a clipped article decides what
   *  kind of block the note holds - and two of them are not blocks that show
   *  something: a `query` fence searches the reader's own space as the note renders,
   *  and an `ai` fence reads its body as a prompt and offers to send it. */
  test('a language of the app’s own is not a page’s to choose', () => {
    expect(htmlToMarkdown('<pre data-language="query"><code>path:Salary</code></pre>')).toBe(
      '```\npath:Salary\n```',
    )
    expect(htmlToMarkdown('<pre class="language-ai"><code>Summarise @note</code></pre>')).toBe(
      '```\nSummarise @note\n```',
    )
    // Whatever the case it was written in.
    expect(htmlToMarkdown('<pre data-lang="QUERY"><code>x</code></pre>')).toBe('```\nx\n```')
  })

  /** And the drawn and runnable ones are left alone on purpose: a clipped page of
   *  developer documentation is the commonest clip there is, and taking the language
   *  off its fences would cost the highlighting and the diagrams on every one. */
  test('while the languages a page really is written in are kept', () => {
    for (const [language, kept] of [
      ['js', '```js'],
      ['mermaid', '```mermaid'],
      ['c++', '```c++'],
      ['c#', '```c#'],
      ['objective-c', '```objective-c'],
    ] as const) {
      expect(htmlToMarkdown(`<pre data-language="${language}"><code>x</code></pre>`)).toBe(
        `${kept}\nx\n\`\`\``,
      )
    }
  })

  test('and a language that is not a word at all is no language', () => {
    const smuggled = '<pre class="language-x&quot;&gt;&lt;img src=x&gt;"><code>hi</code></pre>'
    expect(htmlToMarkdown(smuggled)).toBe('```\nhi\n```')

    expect(htmlToMarkdown(`<pre data-language="${'a'.repeat(25)}"><code>x</code></pre>`)).toBe(
      '```\nx\n```',
    )
  })

  test('an attribute holding nothing leaves the class to say it', () => {
    expect(
      htmlToMarkdown('<pre data-language="" class="language-go"><code>x := 1</code></pre>'),
    ).toBe('```go\nx := 1\n```')
  })

  /** The GFM rules keep a table whose first row is not headings as the page's own
   *  raw HTML - classes, styles, attributes and whatever is nested inside them -
   *  and a note's markup is rendered as the note's own. A clipped page is somebody
   *  else's, so the table becomes a table. */
  test('a table with no headings becomes a table rather than the page markup', () => {
    const html =
      '<table class="layout"><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>'

    expect(htmlToMarkdown(html)).toBe('|  |  |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
  })

  test('nothing of the page is kept as markup', () => {
    const html =
      '<table><tr><td onmouseover="run()"><img src="x" onerror="run()"></td></tr></table>'

    expect(htmlToMarkdown(html)).not.toContain('onerror')
    expect(htmlToMarkdown(html)).not.toContain('<td')
  })

  /** A second `tbody` was a way past both rules at once: this one said the table
   *  was headed and the GFM rules said it was not, so neither claimed it and
   *  turndown handed back the page's own markup. */
  test('nor from a table whose rows sit in a tbody of their own', () => {
    const html =
      '<table class="layout"><tbody></tbody><tbody><tr><th>Col</th></tr>' +
      '<tr><td>cell<img src="https://elsewhere.example/b.png" onerror="run()"></td></tr>' +
      '</tbody></table>'
    const markdown = htmlToMarkdown(html)

    expect(markdown).not.toContain('<table')
    expect(markdown).not.toContain('onerror')
    expect(markdown).toBe('|  |\n| --- |\n| Col |\n| cell![](https://elsewhere.example/b.png) |')
  })

  test('and a headed table keeps the heading row it already had', () => {
    for (const html of [
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
      '<table><tr><th>H</th></tr><tr><td>c</td></tr></table>',
      '<table><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>',
      '<table><thead></thead><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>',
    ]) {
      expect(htmlToMarkdown(html)).toBe('| H |\n| --- |\n| c |')
    }
  })

  test('a cell is one line, whatever the page put inside it', () => {
    const html = '<table><tr><td><p>one</p><p>two</p></td><td>a | b</td></tr></table>'

    expect(htmlToMarkdown(html)).toBe('|  |  |\n| --- | --- |\n| one two | a \\| b |')
  })

  /** Not styling lost but the number: every one of these said a different quantity
   *  from the one the page stated. */
  test('raised and lowered text keep their markers', () => {
    expect(htmlToMarkdown('<p>x<sup>2</sup> and H<sub>2</sub>O</p>')).toBe('x^2^ and H~2~O')
  })

  test('a body the marker cannot hold keeps the tag instead', () => {
    expect(htmlToMarkdown('<p>a<sup>b^c</sup></p>')).toBe('a<sup>b^c</sup>')
    expect(htmlToMarkdown('<p>a<sub>b~c</sub></p>')).toBe('a<sub>b~c</sub>')
  })

  test('a raised footnote mark keeps the link it wraps', () => {
    expect(htmlToMarkdown('<p>said<sup><a href="https://x.dev#n1">[1]</a></sup></p>')).toBe(
      'said^[\\[1\\]](https://x.dev#n1)^',
    )
  })

  /** MathML says what a formula means and markdown cannot write that down, but the
   *  TeX it was built from travels inside it. Without this a formula arrived as the
   *  letters it happened to be made of, or as nothing at all. */
  test('a formula arrives as the TeX the page built it from', () => {
    const html =
      '<p>the equality <math alttext="e^{i\\pi}+1=0"><semantics>' +
      '<annotation encoding="application/x-tex">e^{i\\pi}+1=0</annotation>' +
      '</semantics></math> where</p>'

    expect(htmlToMarkdown(html)).toBe('the equality $e^{i\\pi}+1=0$ where')
  })

  test('the element says the TeX when nothing inside it does', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x^2"><mi>x</mi></math> b</p>')).toBe('a $x^2$ b')
  })

  /** A formula with a whole block to itself is a block, and one a sentence runs
   *  through is part of the sentence however the page draws it: `$$` in the middle
   *  of a line is a formula to nobody. */
  test('a formula alone in its block is written as a block', () => {
    const html = '<p>words</p><p><math alttext="e^{i\\pi}+1=0"><mi>e</mi></math></p><p>after</p>'

    expect(htmlToMarkdown(html)).toBe('words\n\n$$\ne^{i\\pi}+1=0\n$$\n\nafter')
  })

  test('a formula in a heading stays inside the heading', () => {
    expect(htmlToMarkdown('<h2><math alttext="x=1"><mi>x</mi></math></h2>')).toBe('## $x=1$')
  })

  test('a dollar inside a formula cannot close it early', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x=$5"><mi>x</mi></math> b</p>')).toBe('a $x=\\$5$ b')

    // One the page had already escaped stays as it is; escaping it again would
    // leave a backslash of its own in the formula.
    expect(htmlToMarkdown('<p>a <math alttext="x=\\$5"><mi>x</mi></math> b</p>')).toBe(
      'a $x=\\$5$ b',
    )
  })

  /** The rule writes the formula rather than escaping it, so what an `alttext`
   *  says is the one string on a clipped page that nothing else looks at - and a
   *  tag in a note of the reader's own is markup the app renders. */
  test('a tag inside a formula is written as TeX rather than as a tag', () => {
    const html =
      '<p>see <math alttext="<a href=javascript:run()>click</a> \\"><mi>q</mi></math> ok</p>'
    const markdown = htmlToMarkdown(html)

    expect(markdown).not.toContain('<a')
    expect(markdown).not.toContain('</a>')
    expect(markdown).toContain('\\lt ')
  })

  test('and a comparison in a formula still draws as one', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x<y"><mi>x</mi></math> b</p>')).toBe('a $x\\lt y$ b')
  })

  test('a formula that says no TeX keeps the letters it was made of', () => {
    expect(htmlToMarkdown('<p>a <math><mi>x</mi></math> b</p>')).toBe('a x b')
  })

  test('a block holding nothing is nothing to fence', () => {
    expect(htmlToMarkdown('<pre>  </pre>')).toBe('')
  })

  test('code inside a sentence stays inside it', () => {
    expect(htmlToMarkdown('<p>the <code>id</code> field</p>')).toBe('the `id` field')
  })

  test('a rule and a quotation come out as the editor writes them', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
    expect(htmlToMarkdown('<blockquote><p>said</p></blockquote>')).toBe('> said')
  })

  test('tables survive, via the GFM rules', () => {
    const markdown = htmlToMarkdown(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
    expect(markdown).toContain('| a | b |')
    expect(markdown).toContain('| 1 | 2 |')
  })

  test('strikethrough comes back as the two tildes GitHub uses', () => {
    expect(htmlToMarkdown('<del>gone</del>')).toBe('~~gone~~')
  })

  test('highlighted text keeps its markdown form', () => {
    expect(htmlToMarkdown('<mark>kept</mark>')).toBe('==kept==')
  })

  /** The colour has a markdown form too, so a highlight copied out of the reading
   *  view and pasted back is still the colour it was; see highlights.ts. */
  test('a coloured highlight comes back as the colour it was', () => {
    expect(htmlToMarkdown('<mark class="tone-1">kept</mark>')).toBe('==\u{1F534} kept==')
    expect(htmlToMarkdown('<mark class="tone-6">kept</mark>')).toBe('==\u{1F7E3} kept==')
  })

  test('a mark from anywhere else is a highlight with no colour of its own', () => {
    expect(htmlToMarkdown('<mark class="hljs-thing">kept</mark>')).toBe('==kept==')
  })

  test('underline has no markdown, so the tag stays', () => {
    expect(htmlToMarkdown('<u>under</u>')).toBe('<u>under</u>')
  })

  test('scripts, styles and a page title are dropped', () => {
    const markdown = htmlToMarkdown(
      '<title>Tab</title><p>text</p><script>window.x = 1</script><style>p{}</style>',
    )
    expect(markdown).toBe('text')
  })

  /** Five of them cannot be given words to lose: an HTML parser moves what the head
   *  holds out of the body before any converter sees it, and `embed` is void, so
   *  words written after it are the paragraph's rather than its own. The head is
   *  answered by the test above instead. */
  test('every element on the list is refused', () => {
    const childless = new Set(['head', 'meta', 'link', 'title', 'embed'])

    for (const tag of NEVER) {
      if (childless.has(tag)) continue
      expect(htmlToMarkdown(`<p>kept</p><${tag}>gone</${tag}>`), tag).toBe('kept')
    }
  })

  test('images become markdown images', () => {
    expect(htmlToMarkdown('<img src="a.png" alt="alt">')).toBe('![alt](a.png)')
  })

  test('alt text cannot break out of its own brackets', () => {
    expect(htmlToMarkdown('<img src="a.png" alt="a [b] c">')).toBe('![a \\[b\\] c](a.png)')
  })

  /** The backslash was the way out of the brackets that was left. Escaping only
   *  the brackets, alt text ending in one escaped the escape instead: the words
   *  closed early, the address the picture came with became the text after them,
   *  and the picture in the note pointed at the host the alt text named. */
  test('a backslash in alt text cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img src="https://x.test/ok.png" alt="a\\](https://evil.test/b.png)![b">'),
    ).toBe('![a\\\\\\](https://evil.test/b.png)!\\[b](https://x.test/ok.png)')
  })

  test('an image with no address is nothing to point at', () => {
    expect(htmlToMarkdown('<p>before<img alt="none">after</p>')).toBe('beforeafter')
  })

  /** A page's own words are words, and a page showing what a tag looks like is
   *  the commonest thing anyone copies. Left alone, the `<` came through as
   *  markup: the note then held a tag its writer never wrote, and the reading
   *  view, an export and a canvas card all render a note's own HTML. So a `<`
   *  that would open a tag arrives escaped, which is how markdown writes one. */
  test('text that looks like a tag stays text', () => {
    expect(htmlToMarkdown('<p>a &lt;img src=q onerror=alert(1)&gt; b</p>')).toBe(
      'a \\<img src=q onerror=alert(1)> b',
    )
    expect(htmlToMarkdown('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '\\<script>alert(1)\\</script>',
    )
    expect(htmlToMarkdown('<h1>&lt;b&gt;shout&lt;/b&gt;</h1>')).toBe('# \\<b>shout\\</b>')
  })

  /** Only a `<` that would open something. `a < b` is arithmetic, and escaping
   *  it would put a backslash in front of every comparison a note quotes. */
  test('a lone angle bracket is left as it was typed', () => {
    expect(htmlToMarkdown('<p>1 &lt; 2 and 3 &gt; 2</p>')).toBe('1 < 2 and 3 > 2')
  })

  /** Code says what it says. Turndown hands a fence its own text rather than the
   *  escaped kind, and the fence keeps it that way. */
  test('a tag inside code keeps its brackets', () => {
    expect(htmlToMarkdown('<pre><code>&lt;img src=q&gt;</code></pre>')).toBe(
      '```\n<img src=q>\n```',
    )
  })

  /** The address is the other way text reached the page as markup: a `)` ends the
   *  destination early, and whatever followed it in the attribute was written
   *  into the note as its own markdown - a second picture, pointing at a host the
   *  pasted HTML chose. Percent encoded, the whole attribute is one address. */
  test('an address cannot break out of its own brackets', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%29![]%28https://evil.test/b.png)')

    expect(htmlToMarkdown('<img alt="a" src="x)<img src=q onerror=alert(1)>">')).toBe(
      '![a](x%29%3Cimg%20src=q%20onerror=alert%281%29%3E)',
    )
  })

  /** Escaping the brackets left the escape itself: a `\` the page put in the
   *  address escaped the backslash that was protecting the bracket, and the
   *  bracket ended the destination after all. */
  test('a backslash in an address cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png\\)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%5C%29![]%28https://evil.test/b.png)')
  })

  /** An address with brackets in it is ordinary rather than adversarial -
   *  Wikipedia writes them - and the note has to hold it as the one address it
   *  is. Encoded rather than escaped, because what is being written is a URL and
   *  a URL says the same thing either way. */
  test('the brackets an ordinary address carries survive as one address', () => {
    expect(htmlToMarkdown('<img alt="a" src="https://x.test/File_(1).png">')).toBe(
      '![a](https://x.test/File_%281%29.png)',
    )
  })

  /** And an address with a space in it is one address, not an address and a
   *  title: written bare it used to leave the picture as four words of prose. A
   *  tab or a control character ends a destination the same way. */
  test('a blank in an address cannot end it', () => {
    expect(htmlToMarkdown('<img alt="a" src="my picture.png">')).toBe('![a](my%20picture.png)')
    expect(htmlToMarkdown('<img alt="a" src="a&#9;b.png">')).toBe('![a](a%09b.png)')
  })

  /** An address that already carries escapes is left as the address it was: the
   *  percent is not encoded again, so `a%20b.png` stays one file rather than
   *  becoming a name with `%2520` in it. */
  test('an address that is already encoded is not encoded twice', () => {
    expect(htmlToMarkdown('<img alt="a" src="https://x.test/a%20b.png">')).toBe(
      '![a](https://x.test/a%20b.png)',
    )
  })

  test('an address a caller chose is encoded the same way', () => {
    expect(htmlToMarkdown('<img alt="a" src="a.png">', { image: () => 'one two.png' })).toBe(
      '![a](one%20two.png)',
    )
  })

  /** A picture says two things here and no more. A title would be a third string
   *  to break out of, and the quote that opens it is on any page that quotes
   *  somebody; it would also sit between the brackets the clipper fills its
   *  numbers in by. So the page's own is dropped. */
  test('a title is not markdown a page can write', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="a.png" title="he said &quot;hi&quot;) ![](b.png">'),
    ).toBe('![a](a.png)')
  })

  /** What the clipper needs: the bytes are still on the site when the conversion
   *  runs, so it numbers the pictures and fills the addresses in afterwards. */
  test('a caller can say what a picture becomes', () => {
    const seen: string[] = []
    const markdown = htmlToMarkdown(
      '<p><img src="a.png" alt="one"></p><p><img src="b.png" alt="two"></p>',
      { image: (source) => `nib:${seen.push(source) - 1}` },
    )

    expect(markdown).toBe('![one](nib:0)\n\n![two](nib:1)')
    expect(seen).toEqual(['a.png', 'b.png'])
  })

  test('nothing in, nothing out', () => {
    expect(htmlToMarkdown('')).toBe('')
    expect(htmlToMarkdown('   \n  ')).toBe('')
  })

  test('runs of blank lines are one blank line', () => {
    expect(htmlToMarkdown('<p>one</p><p></p><p></p><p>two</p>')).toBe('one\n\ntwo')
  })
})
