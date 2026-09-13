/** A published note is the note.
 *
 *  One fixture with every construct nib renders in it - everything.md, which the
 *  browser drive in apps/desktop/test/e2e/publishing.py opens in the reading view
 *  and on a published page side by side - read here through the real routes.
 *
 *  What these hold the page to is the two halves of looking the same: the markup
 *  the renderer was asked for, and a stylesheet that has something to say about
 *  every class in it. The second is the one that catches drift: a construct that
 *  gains a class, or a sheet that stops being served, fails here rather than on
 *  somebody's blog. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { codeBlocks } from '@nib/markdown'
import { diagramKey } from '@nib/markdown/diagrams'
import { blogMath, blogStyle } from '../../../scripts/blog-css'
import { COLOURED } from '../src/blog/code'
import { MATH_CSS, MATH_CSS_PATH, MATH_FONTS } from '../src/blog/math'
import { PAGE_CSS, PAGE_CSS_PATH } from '../src/blog/style'
import { call, signIn, testEnv, type TestEnv } from './harness'

const EVERYTHING = readFileSync(fileURLToPath(new URL('everything.md', import.meta.url)), 'utf8')

const OTHER = '# Another note\n\nThe other note itself.\n\n## Why it works\n\nBecause.\n'

const HOST = 'field.nibeditor.com'

/** The emoji that names the first palette tone, which a published page dresses a
 *  highlight in and never shows. */
const RED = '\u{1F534}'

let env: TestEnv
let token: string
/** The space the fixture is published from. Held out here because the diagram a
 *  page shows is named after it; see @nib/markdown/diagrams. */
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = (created.json as { space: { id: string } }).space.id

  for (const [path, content] of [
    ['Everything.md', EVERYTHING],
    ['Another note.md', OTHER],
  ] as const) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  await call(env, `/v1/spaces/${space}/blog`, {
    method: 'PUT',
    token,
    body: { subdomain: 'field' },
  })
})

afterEach(() => env.close())

function published() {
  return call(env, '/everything', { host: HOST })
}

/** The note's own markup, without the page around it. */
function body(html: string): string {
  const at = html.indexOf('<main id="write">')
  return html.slice(at, html.indexOf('</main>', at))
}

/** Every class the page uses, except the ones inside an equation: KaTeX brings a
 *  vocabulary of its own - `mord`, `vlist`, `pstrut` - and its own stylesheet to
 *  colour it with, so those subtrees are cut out before the names are read. */
function classesIn(html: string): string[] {
  const found = new Set<string>()
  for (const [, list] of withoutMaths(html).matchAll(/class="([^"]*)"/g)) {
    for (const name of (list ?? '').trim().split(/\s+/)) if (name) found.add(name)
  }

  return [...found].sort()
}

/** The same HTML with every rendered equation taken out of it. KaTeX writes one
 *  `<span class="katex">` per formula and everything under it is its own, so the
 *  span that opens one is followed until it closes. */
function withoutMaths(html: string): string {
  let out = ''
  let at = 0

  while (at < html.length) {
    const found = /<span class="katex(?:-display)?"/.exec(html.slice(at))
    if (!found) return out + html.slice(at)

    const opens = at + found.index
    out += html.slice(at, opens)

    let depth = 0
    let scan = opens
    while (scan < html.length) {
      const next = /<span\b|<\/span>/.exec(html.slice(scan))
      if (!next) return out
      scan += next.index + next[0].length
      depth += next[0] === '</span>' ? -1 : 1
      if (depth === 0) break
    }

    at = scan
  }

  return out
}

/** Whether an address is somebody else's to serve: it names a host of its own, or
 *  a scheme that is not the `data:` a sheet draws its own arrow with. A path, with
 *  or without a leading slash, is this blog's. */
function elsewhere(url: string): boolean {
  return url.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith('data:'))
}

/** Every address a stylesheet asks a browser to fetch. */
function urlsIn(css: string): string[] {
  return [...css.matchAll(/url\(\s*"?([^)"]+)"?\s*\)/g)].map(([, url = '']) => url)
}

/** Everything a reader's browser fetches on its way to seeing the page: the sheets
 *  it links, the pictures and players in it, and whatever those sheets ask for in
 *  turn. Not the links in the prose - a note may point anywhere it likes, and a
 *  reader who presses one has chosen to go. */
function fetched(html: string, sheets: readonly string[]): string[] {
  const asked = (pattern: RegExp) => [...html.matchAll(pattern)].map(([, url = '']) => url)

  return [
    // A `<link>` that is a statement rather than a fetch - where the page lives,
    // and the feed beside it - is not something a browser goes and gets.
    ...asked(/<link\b(?![^>]*\brel="(?:canonical|alternate)")[^>]*\bhref="([^"]*)"/g),
    ...asked(/<(?:script|img|audio|video|source|iframe|embed)\b[^>]*\bsrc="([^"]*)"/g),
    ...sheets.flatMap(urlsIn),
  ]
}

describe('the stylesheet a page is served with', () => {
  test('is the one the generator writes from the themes package', () => {
    const target = fileURLToPath(new URL('../src/blog/style.ts', import.meta.url))
    expect(readFileSync(target, 'utf8')).toBe(blogStyle())
  })

  test('is served from the blog itself, at a path that is its own hash', async () => {
    const answer = await call(env, PAGE_CSS_PATH, { host: HOST })

    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/css')
    expect(answer.headers.get('cache-control')).toContain('immutable')
    expect(answer.text).toBe(PAGE_CSS)
  })

  test('is linked by the page rather than written into it', async () => {
    const answer = await published()

    expect(answer.text).toContain(`<link rel="stylesheet" href="${PAGE_CSS_PATH}">`)
    // Only the sheets; a page carries no rules of its own any more.
    expect(answer.text).not.toContain('<style>')
  })

  test('is base.css and document.css themselves, scoped to #write as they are', () => {
    // One rule from each of the three sheets, so a sheet dropped from the
    // generator is a test failing rather than a page losing its callouts.
    expect(PAGE_CSS).toContain('--callout-warning:')
    expect(PAGE_CSS).toContain('#write blockquote{')
    expect(PAGE_CSS).toContain('#write .task-list-item')
    expect(PAGE_CSS).toContain('#write .chart-svg{')
    expect(PAGE_CSS).toContain('.hl-keyword{')
  })

  test('reads light or dark from the reader', () => {
    expect(PAGE_CSS).toContain(
      "@media (prefers-color-scheme:dark){:root:not([data-theme='light']){",
    )
    expect(PAGE_CSS).toContain('@media print{:root,')
    // Nothing said: the tokens on `:root` are what the page gets, and on the
    // open web those are the light ones.
    expect(PAGE_CSS).toContain(':root{color-scheme:light;--bg:#fbfcfd')
  })

  test('and lets a reader who says which one have it', () => {
    // The button in the bar writes `data-theme`, so both stated schemes are
    // restated after the system's - otherwise a page would keep the colours the
    // system asked for and the button would change nothing anybody can see.
    expect(PAGE_CSS).toContain(":root[data-theme='dark']{color-scheme:dark")
    expect(PAGE_CSS).toContain(":root[data-theme='light']{color-scheme:light")
    expect(PAGE_CSS.indexOf(":root[data-theme='dark']{color-scheme:dark")).toBeGreaterThan(
      PAGE_CSS.indexOf('@media (prefers-color-scheme:dark)'),
    )
  })
})

describe("the sheet an equation is set with, and KaTeX's faces", () => {
  test('are the ones the generator writes from the katex package', () => {
    const target = fileURLToPath(new URL('../src/blog/math.ts', import.meta.url))
    expect(readFileSync(target, 'utf8')).toBe(blogMath())
  })

  test('are served from the blog itself, at paths that are their own hashes', async () => {
    const answer = await call(env, MATH_CSS_PATH, { host: HOST })

    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/css')
    expect(answer.headers.get('cache-control')).toContain('immutable')
    expect(answer.text).toBe(MATH_CSS)

    // Every face the sheet names, and nothing the sheet does not: a `src` the
    // Worker does not answer is an equation set in the reader's serif.
    expect(urlsIn(MATH_CSS).sort()).toEqual(Object.keys(MATH_FONTS).sort())

    for (const path of Object.keys(MATH_FONTS)) {
      const font = await call(env, path, { host: HOST })

      expect(font.status).toBe(200)
      expect(font.headers.get('content-type')).toBe('font/woff2')
      expect(font.headers.get('cache-control')).toContain('immutable')
      // The four characters a woff2 file opens with, so what is served is the
      // font and not a base64 of it.
      expect(font.text.startsWith('wOF2')).toBe(true)
    }
  })

  test('are linked by a page with an equation on it and by no other', async () => {
    const withMaths = await published()
    const without = await call(env, '/another-note', { host: HOST })

    expect(withMaths.text).toContain(`<link rel="stylesheet" href="${MATH_CSS_PATH}">`)
    expect(without.status).toBe(200)
    expect(without.text).not.toContain(MATH_CSS_PATH)
  })

  test('leave the reader of a page nothing to fetch from anybody else', async () => {
    const answer = await published()

    expect(fetched(answer.text, [PAGE_CSS, MATH_CSS]).filter(elsewhere)).toEqual([])
    // The CDN this used to come from, said out loud so the day somebody links a
    // sheet again is the day this fails.
    expect(answer.text).not.toContain('cdn.jsdelivr')
    expect(MATH_CSS).not.toContain('cdn.jsdelivr')

    // And a policy that allows nothing else either.
    const policy = answer.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("style-src 'self' 'unsafe-inline'")
    expect(policy).toContain("font-src 'self'")
    expect(policy).not.toContain('https://cdn')
  })
})

/** The classes no stylesheet anywhere in nib says anything about, on a page or in
 *  the app: a name for what a thing is, which takes its look from what it is
 *  inside. `language-ts` is on a fence for anybody reading the markup, a chart's
 *  bars and a web card's name are coloured by attributes the renderer writes, and
 *  a bare address, a wikilink and the arrow out of a footnote are links. Named
 *  here so the test below is about what a page is missing rather than these. */
const UNDRESSED = /^(?:language-|chart-bar$|embed-name$|footnote-back$|url$|wikilink$)/

describe('a published note', () => {
  test('is the note, in the element every sheet of the app is written for', async () => {
    const answer = await published()

    expect(answer.status).toBe(200)
    expect(answer.text).toContain('<main id="write">')
  })

  test('has something in the stylesheet for every class it uses', async () => {
    const answer = await published()
    const missing = classesIn(body(answer.text)).filter(
      (name) => !PAGE_CSS.includes(`.${name}`) && !UNDRESSED.test(name),
    )

    expect(missing).toEqual([])
  })

  test('colours every fence whose language the Worker carries', async () => {
    const answer = await published()

    expect(answer.text).toContain('<span class="hl-keyword">export</span>')
    expect(answer.text).toContain('<span class="hl-keyword">def</span>')
    expect(answer.text).toContain('<span class="hl-comment">')
    expect(answer.text).toContain('<pre><code class="language-css">')
  })

  test('leaves a fence it has no grammar for as plain code', async () => {
    const answer = await published()
    const fence = answer.text.slice(answer.text.indexOf('<code class="language-mermaid">'))

    expect(fence.slice(0, fence.indexOf('</code>'))).not.toContain('<span')
  })

  test('names the languages the editor spells the same way', () => {
    // A handful the editor matches through `SPELLINGS`; the whole table is
    // src/blog/code.ts, and a language missing from it is a plain fence.
    for (const word of ['ts', 'tsx', 'py', 'rs', 'golang', 'yml', 'scss', 'h++']) {
      expect(COLOURED).toContain(word)
    }
  })

  test('gathers a table of contents and gives every heading an id', async () => {
    const answer = await published()

    expect(answer.text).toContain('<nav class="toc">')
    expect(answer.text).toContain('<h2 id="a-table">')
    // So that `[[note#heading]]` from another page lands on the heading.
    expect(answer.text).toContain('href="#a-table"')
  })

  test('renders maths, a chart and every callout without a script', async () => {
    const answer = await published()

    expect(answer.text).toContain('class="katex"')
    expect(answer.text).toContain('class="katex-display"')
    expect(answer.text).toContain('<figure class="chart" data-kind="bar">')
    expect(answer.text).toContain('<svg class="chart-svg"')
    // The thirteen Obsidian has, two of them written by one of their aliases, and one
    // nobody registered - which has no look and so no second class.
    expect(answer.text.match(/class="callout callout-/g)).toHaveLength(15)
    expect(answer.text).toContain('data-callout="recipe"')
    // `[!caution]` wears `warning`, the way Obsidian folds it in, and still says the
    // word it was written with. The `-` after it is what makes a callout a `<details>`
    // that opens shut, here and in the app both; see callouts.ts in @nib/markdown.
    expect(answer.text).toContain('<details class="callout callout-warning"')
    expect(answer.text).toContain('data-callout="caution"')
    expect(answer.text).toContain('data-callout="important"')
    expect(answer.text).not.toContain('callout-caution')
    expect(answer.text).not.toContain('callout-important')
    // The note's own markup is shown rather than run, whatever a policy says;
    // what the policy allows is the site's own furniture. See blog.test.ts.
    expect(answer.headers.get('content-security-policy')).toContain("script-src 'self'")
  })

  test('shows what it embeds and says what it cannot show', async () => {
    const answer = await published()

    expect(answer.text).toContain('The other note itself.')
    expect(answer.text).toContain('<audio class="embed-media"')
    expect(answer.text).toContain('<video class="embed-media"')
    expect(answer.text).toContain('data-kind="pdf"')
    expect(answer.text).toContain('data-kind="canvas"')
    // A page from the web is a card that is a link, since nothing may run here.
    expect(answer.text).toContain('<a class="embed-play"')
  })

  test('keeps the note to itself: no front matter, no comments', async () => {
    const answer = await published()

    expect(answer.text).not.toContain('Nobody reads this one')
    expect(answer.text).not.toContain('Nor this one')
    // The metadata is what the page's own title and byline were built from.
    expect(answer.text).not.toContain('class="properties"')
    expect(answer.text).toContain('<title>Everything</title>')
  })

  /** A coloured highlight on a published page. The emoji is the colour, not a word
   *  of the note, so it never reaches a stranger's screen; the class is the one
   *  the reading view and an export wear, and the sheet the Worker serves dresses
   *  it. See highlights.ts in @nib/markdown. */
  test('colours a highlight the way the app does, and hides the emoji', async () => {
    const answer = await published()

    expect(answer.text).toContain('<mark class="tone-1">a red mark</mark>')
    expect(answer.text).toContain('<mark>marked</mark>')
    expect(body(answer.text)).not.toContain(RED)
    expect(PAGE_CSS).toContain('mark.tone-1')
  })

  /** Whether a single newline breaks the line is the author's own answer, so a
   *  published page reads the way its author reads it; see `hardBreaksIn` in
   *  blog.ts. CommonMark until the account says otherwise, which is what every
   *  other reader of the same file does with it. */
  describe('whether a single newline breaks the line', () => {
    const WRAPPED = 'A paragraph wrapped over'

    test('is CommonMark for an account that has never said', async () => {
      const answer = await published()

      expect(answer.text).toContain(`${WRAPPED}\nthree lines in the file`)
      expect(answer.text).not.toContain(`${WRAPPED}<br>`)
    })

    test('is the answer the author gave, once they have given one', async () => {
      await call(env, '/v1/settings', { method: 'PATCH', token, body: { hardBreaks: true } })
      const answer = await published()

      expect(answer.text).toContain(`${WRAPPED}<br>`)
    })

    test('is a break on a slide whatever the account says, because a slide is a poster', async () => {
      const answer = await call(env, '/everything?slides', { host: HOST })

      expect(answer.status).toBe(200)
      expect(answer.text).toContain(`${WRAPPED}<br>`)
    })
  })
})

/** A mermaid diagram on a published page.
 *
 *  The Worker draws nothing: the app drew the SVG, named it after the fence and
 *  sent it up as a blob, and the page writes a picture where the fence stood if the
 *  blob is there. So these tests do what the app does - a PUT of an SVG under the
 *  name the fence computes - and then read the page. See
 *  packages/markdown/src/diagrams.ts and apps/desktop/src/lib/site-diagrams.ts. */
describe('a diagram the app drew', () => {
  /** The fixture's own mermaid fence, read out of it rather than typed again:
   *  the name is the fence's contents, character for character. */
  const fence = () => {
    const found = codeBlocks(EVERYTHING).find((one) => one.language === 'mermaid')
    if (!found) throw new Error('everything.md no longer has a mermaid fence in it')

    return found
  }

  /** One drawing, as the app sends it: a small SVG with the scheme in it, under the
   *  name the fence and the space come to. */
  async function draw(scheme: 'light' | 'dark'): Promise<string> {
    const { language, code } = fence()
    const hash = await diagramKey(space, language, code, scheme)
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120">` +
      `<text>${scheme}</text></svg>`

    const put = await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: svg,
      headers: { 'content-type': 'image/svg+xml' },
    })

    expect(put.status).toBe(201)
    return hash
  }

  test('stays a code block until something has drawn it', async () => {
    const answer = await published()

    expect(answer.text).toContain('<code class="language-mermaid">')
    expect(answer.text).not.toContain('<figure class="diagram"')
  })

  test('becomes a picture in the frame an export uses, one per scheme', async () => {
    const light = await draw('light')
    const dark = await draw('dark')
    const answer = await published()

    expect(answer.text).toContain(
      `<figure class="diagram" data-language="mermaid">` +
        `<img src="/i/${light}.svg" alt="Diagram" data-scheme="light">` +
        `<img src="/i/${dark}.svg" alt="Diagram" data-scheme="dark">` +
        `</figure>`,
    )
    // And the fence itself is gone: a diagram is a picture or it is code, never
    // both.
    expect(answer.text).not.toContain('<code class="language-mermaid">')
  })

  test('is one picture where only the light drawing arrived', async () => {
    const light = await draw('light')
    const answer = await published()

    expect(answer.text).toContain(`<img src="/i/${light}.svg" alt="Diagram">`)
    expect(answer.text).not.toContain('data-scheme=')
  })

  test('is served from the site itself, as an SVG that may do nothing', async () => {
    const light = await draw('light')
    const answer = await call(env, `/i/${light}.svg`, { host: HOST })

    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('image/svg+xml')
    expect(answer.headers.get('cache-control')).toContain('immutable')
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    // Opened on its own it is a document on this origin, so it is sandboxed and
    // allowed nothing but the colours it is drawn in; see src/blobs.ts.
    const policy = answer.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('sandbox')
    expect(answer.text).toContain('<text>light</text>')
  })

  test('is a picture this page may show, and nobody else’s', async () => {
    await draw('light')
    const answer = await published()

    // `'self'` said out loud, so a site read over plain http - a drive against a
    // local Worker - shows its own pictures.
    expect(answer.headers.get('content-security-policy')).toContain("img-src 'self' https: data:")
    // Everything the page fetches is this site's; the diagram is no exception.
    expect(fetched(answer.text, [PAGE_CSS, MATH_CSS]).filter(elsewhere)).toEqual([])
  })

  test('is dressed by the sheet, in both schemes and on paper', () => {
    expect(PAGE_CSS).toContain('#write .diagram img{max-width:100%;height:auto}')
    expect(PAGE_CSS).toContain("#write .diagram img[data-scheme='dark']{display:none}")
    expect(PAGE_CSS).toContain(
      ":root[data-theme='dark'] #write .diagram img[data-scheme='dark']{display:inline}",
    )
    // The reader's own word after the system's, the way the token blocks are.
    expect(PAGE_CSS.indexOf(":root[data-theme='dark'] #write .diagram")).toBeGreaterThan(
      PAGE_CSS.indexOf('@media (prefers-color-scheme:dark)'),
    )
  })

  test('is another name in another space, so the page cannot be poisoned', async () => {
    const { language, code } = fence()
    const elsewhereKey = await diagramKey('some-other-space', language, code, 'light')

    await call(env, `/v1/blobs/${elsewhereKey}`, {
      method: 'PUT',
      token,
      raw: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
      headers: { 'content-type': 'image/svg+xml' },
    })

    const answer = await published()
    expect(answer.text).not.toContain('<figure class="diagram"')
  })

  test('is a picture only where the space’s own owner keeps the bytes', async () => {
    const { language, code } = fence()
    const hash = await diagramKey(space, language, code, 'light')
    const stranger = await signIn(env, 'stranger@b.dev')

    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token: stranger,
      raw: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
      headers: { 'content-type': 'image/svg+xml' },
    })

    const answer = await published()
    expect(answer.text).not.toContain('<figure class="diagram"')
  })
})
