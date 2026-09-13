import {
  codeBlocks,
  documentTitle,
  findLinks,
  type Heading,
  renderMarkdown,
  type Wikilink,
} from '@nib/markdown'
import { DECK_HEIGHT, DECK_PAGE_CSS, DECK_SCRIPT, DECK_WIDTH, deckBody } from '@nib/markdown/deck'
import { diagramAlt, diagramFigure, diagramKey, isDiagram } from '@nib/markdown/diagrams'
// The formula engine and the emoji table, imported outright rather than loaded when a
// note turns out to want one. The app does the opposite, because it has a first paint
// to make and a session to spread the loading over; an isolate answers one request and
import { objectIn } from './body'
// is gone, so waiting for either would be waiting per request. See
// @nib/markdown/engines.
import '@nib/markdown/eager'
import { isCanvasTarget, isPagesTarget, isPdfTarget } from '@nib/markdown/links'
import { deckOf, isDeck } from '@nib/markdown/slides'
import { blogFence } from './blog/code'
import { feed, type FeedPage, newestFirst, robots, sitemap } from './blog/feed'
import { answersFrom, formHtml, formOf } from './blog/form'
import { type NoteFront, readFront } from './blog/front'
import { gateBody, matches, newTicket, ticketCookie, ticketHolds, ticketIn } from './blog/gate'
import { escape, type Head, headOf } from './blog/head'
import { MATH_CSS, MATH_CSS_PATH, MATH_FONTS } from './blog/math'
import { answers, asked as readQuery, hasWords, matching } from './blog/find'
import { linkedFrom, type Listed } from './blog/nav'
import { pageOf, pathsOf, rememberedNote } from './blog/paths'
import { SITE_JS, SITE_JS_PATH, THEME_JS, THEME_JS_HASH } from './blog/script'
import { type Around, aside, bar, contents, counter, ownFiles, underneath } from './blog/shell'
import { PAGE_CSS, PAGE_CSS_PATH, SLIDES_CSS, SLIDES_CSS_PATH } from './blog/style'
import { askInChunks, places } from './bound'
import { machineOf, maySendAnswer, mayTakeAnswer } from './limits'
import { newId } from './crypto'
import { noteKey } from './notes'
import { readSpaceFiles, type SpaceFile } from './spaces/files'
import { publishes, readSite, type Site, type SitePassword, SVG_POLICY } from './blog/site'
import type { Env, Note, Space } from './types'

/** Where a page lives is blog/paths.ts now that a note can say so itself; the
 *  name stays reachable from here, where every other caller already looks. */
export { slugFor } from './blog/paths'

/** Scripts cannot run on a published note, whatever its markdown contained.
 *
 *  A note read as slides is the one page that needs one - a deck has to turn its
 *  pages - and it gets a nonce rather than a door left open: the only script that
 *  runs is the one written here, and the note's own markup is still shown as text
 *  rather than parsed. See `deckPage`. */
function csp(options: { nonce?: string; scripts?: boolean; counter?: string } = {}): string {
  const { nonce, scripts, counter } = options

  return [
    "default-src 'none'",
    // A deck's own script by its nonce; a page's furniture - the search box's
    // shortcut, the theme button, the hover card, the graph - by its origin,
    // which is this site. The one inline script a page carries is the line that
    // puts the reader's theme on before the first paint, and it is named by the
    // hash of those very characters rather than by `unsafe-inline`. The author's
    // own `publish.js` is served from here too, so `'self'` covers it; see
    // docs/publishing.md.
    nonce
      ? `script-src 'nonce-${nonce}'`
      : scripts
        ? `script-src 'self' '${THEME_JS_HASH}'${counter ? ` ${counter}` : ''}`
        : "script-src 'none'",
    // What the hover card fetches, which is a page of this same site and
    // nothing else.
    scripts ? "connect-src 'self'" : "connect-src 'none'",
    // The page's own stylesheets, which are served from here; see `sheet` below.
    // Inline styles as well, because KaTeX lays an equation out in `style`
    // attributes and a slide is placed by ones the stage writes.
    "style-src 'self' 'unsafe-inline'",
    // The faces an equation is set in, which the Worker carries too; see `face`.
    // Both of these lines used to name the CDN KaTeX came from, which told a
    // third party who was reading what and left the maths of a page broken for
    // anybody offline or behind a blocker.
    "font-src 'self'",
    // The pictures a note names, wherever they are, and the diagrams the app drew
    // for this page, which are served from here; `'self'` is said out loud because
    // a site read over plain http - a drive against a local Worker - is not `https:`
    // and its own images are still its own.
    "img-src 'self' https: data:",
    // A recording or a film a note embeds, which is served from the same place
    // its pictures are: the blob behind the file, over https. Said out loud
    // because media does not fall back to `img-src`, and left off `default-src`
    // so nothing else about this page gains a way out.
    'media-src https: data:',
    "base-uri 'none'",
    // The search box and the password form both post or get to this site, and
    // neither they nor anything else on a page may reach anywhere else.
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** The host a request names, as a name to compare: the port goes, the case
 *  goes, and so does the trailing dot that a fully qualified name may carry.
 *  `Field.Nibeditor.com.` is the same host as `field.nibeditor.com` and must
 *  not read as a domain of someone's own. */
export function hostnameOf(host: string): string {
  return (host.toLowerCase().split(':')[0] ?? '').replace(/\.$/, '')
}

/** Which space, if any, a hostname publishes. */
export async function spaceForHost(env: Env, host: string): Promise<Space | null> {
  const hostname = hostnameOf(host)
  if (!hostname) return null

  if (hostname.endsWith(`.${env.BLOG_ROOT}`)) {
    const subdomain = hostname.slice(0, -(env.BLOG_ROOT.length + 1))
    return (
      (await env.DB.prepare('select * from spaces where blog_subdomain = ? and blog_enabled = 1')
        .bind(subdomain)
        .first<Space>()) ?? null
    )
  }

  // The shared domain itself is the app, whatever any row might say. The
  // API refuses such a row; this is for the day something else writes one.
  if (hostname === env.BLOG_ROOT) return null

  // A domain of one's own answers only once a record in it has said the domain
  // is this account's. A row is not a claim to a name in DNS: without this,
  // typing a name first was enough to be served on it. See spaces/proof.ts.
  return (
    (await env.DB.prepare(
      `select * from spaces
        where blog_domain = ? and blog_enabled = 1 and blog_domain_verified_at is not null`,
    )
      .bind(hostname)
      .first<Space>()) ?? null
  )
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** A note's path as the name a link uses for it: no extension, folded case. The
 *  same reading the editor does, so a link that follows in the app resolves on
 *  the page. */
function nameOf(path: string): string {
  return path.replace(/\\/g, '/').replace(MARKDOWN, '').toLowerCase()
}

/** One note of a site: the row, what the note says about its own page, and where
 *  that puts it. Worked out once per request, because every list on the page and
 *  every link in it asks the same two questions. */
interface Page {
  note: Note
  front: NoteFront
  /** Where it lives, without the leading slash; see blog/paths.ts. */
  slug: string
}

/** Where each note of a space is published, by every name a link could use for
 *  it: its own name and every tail of its path, which is what `[[Note]]` and
 *  `[[folder/Note]]` are. A name two notes answer to goes to the shallower one,
 *  which is the reading the editor settles on too.
 *
 *  Where it is published is the page's own answer rather than its path: a note
 *  with a `permalink:` is linked at the permalink, so a link that follows in the
 *  app follows to the same place on the site.
 *
 *  Built once per page rather than per link: a note with fifty links in it would
 *  otherwise walk the space fifty times. */
function pages(listed: readonly Page[]): Map<string, string> {
  const byName = new Map<string, string>()

  // Deepest first, so a shallower note overwrites it and wins the bare name.
  const ordered = [...listed].sort(
    (one, other) => other.note.path.split('/').length - one.note.path.split('/').length,
  )

  for (const page of ordered) {
    const whole = nameOf(page.note.path)
    const url = `/${page.slug}`
    const parts = whole.split('/')

    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
    byName.set(whole, url)
  }

  return byName
}

/** How many embeds one page will fetch the notes for. Well past any note anyone
 *  writes, and a ceiling so one page cannot pull a whole space out of storage. */
const MOST_EMBEDDED = 20

/** Where the bytes of a file are served: the hash of its contents, with the
 *  extension after it so that saving it keeps a sensible name. The same URL a
 *  pasted picture gets, and for the same reason - addressed by content, it can
 *  never go stale. */
function blobUrl(file: SpaceFile): string {
  const extension = /\.([a-z0-9]+)$/i.exec(file.path)?.[1]?.toLowerCase() ?? 'bin'
  return `/i/${file.hash}.${extension}`
}

/** Where each file of a space is served, by every name a link could use for it:
 *  its whole path and every tail of it, which is the same reading `pages` does
 *  for the notes. A name two files answer to goes to the shallower one. */
function fileUrls(files: readonly SpaceFile[]): Map<string, string> {
  const byName = new Map<string, string>()

  // Deepest first, so a shallower file overwrites it and wins the bare name.
  const ordered = [...files].sort(
    (one, other) => other.path.split('/').length - one.path.split('/').length,
  )

  for (const file of ordered) {
    const url = blobUrl(file)
    // Already forward-slashed: a path with a separator of anyone's platform in
    // it was never recorded; see `wrong` in spaces/files.ts.
    const parts = file.path.toLowerCase().split('/')
    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
  }

  return byName
}

/** A file carries no front matter, so the site's folder rules are the whole of what
 *  decides about one. */
const NO_FRONT: NoteFront = {}

/** The file a request is asking for, when the path names one the space keeps and
 *  the site publishes the folder it sits in.
 *
 *  A markdown link writes the path the note wrote, so the reader's browser asks
 *  the blog for `files/paper.pdf`. The bytes are a blob; this sends them there,
 *  which keeps one place serving them and the `#page=` on the link intact.
 *
 *  The rules are asked the same question they are asked about a note, and used not
 *  to be asked at all: a space that published only `Blog/` answered
 *  `/private/salary.pdf` to anybody who guessed the path. A file is not a note and
 *  has no `publish:` of its own to settle it, so where it sits is the whole of the
 *  answer - and where it sits is a path somebody can guess, which a hash is not. */
function fileFor(space: Space, site: Site, slug: string, url: URL): Response | null {
  const files = readSpaceFiles(space.files)
  if (!files.length) return null

  let wanted = slug
  try {
    wanted = decodeURIComponent(slug)
  } catch {
    // Not valid encoding, so it is already the name it stands for.
  }

  const found = files.find((one) => one.path.toLowerCase() === wanted.toLowerCase())
  if (!found || !publishes(site.rules, found.path, NO_FRONT)) return null

  return Response.redirect(new URL(blobUrl(found), url).toString(), 302)
}

/** What a `[[wikilink]]` on a published page points at. A note the space does
 *  not publish resolves to nothing, and the renderer leaves it as words. */
function linkResolver(listed: readonly Page[], files: readonly SpaceFile[]) {
  const byName = pages(listed)
  const byFile = fileUrls(files)

  return (link: Wikilink) => ({
    // A link naming no note points inside the page it is written on, which is
    // an empty target plus whichever heading it named. A PDF is a file rather
    // than a note and is served from where its bytes are; the renderer writes
    // the page the link named after it.
    href: !link.target
      ? ''
      : isPdfTarget(link.target)
        ? (byFile.get(nameOf(link.target)) ?? null)
        : (byName.get(nameOf(link.target)) ?? null),
  })
}

/** Where a plain `[words](../Other note.md)` on one page points.
 *
 *  A wikilink names a note and `linkResolver` above finds it by name; a markdown
 *  link names a path, written relative to the note it sits in. In the app that
 *  path is read at the moment the link is clicked, against that note - see
 *  Reading.svelte - and a published page has no such moment: the HTML is the whole
 *  of what a stranger gets. Left alone, a link that said `../Public/Two.md`
 *  answered 404 on a site that serves the same note at `/public/two`.
 *
 *  So the path is resolved against the note it was written in and then looked up
 *  the way a wikilink is, through the very same two maps. A note this site does
 *  not publish answers null, and the renderer writes the words rather than a link
 *  into nothing - which is exactly what an unresolved wikilink does. */
function noteHrefResolver(from: string, listed: readonly Page[], files: readonly SpaceFile[]) {
  const byName = pages(listed)
  const byFile = fileUrls(files)

  return (target: string) => {
    const written = decoded(target)
    if (!written) return null

    const path = against(from, written)
    if (isPdfTarget(path)) return byFile.get(path.toLowerCase()) ?? null

    // The resolved path first, then the target as it was written: a link may name
    // a note by a tail of its path rather than by a road from here, and `pages`
    // holds every tail of every name.
    return byName.get(nameOf(path)) ?? byName.get(nameOf(written)) ?? null
  }
}

/** A target as it was written, with any percent-encoding taken off. Null for one
 *  that is not a path at all: a half-written escape is not a note. */
function decoded(target: string): string | null {
  try {
    return decodeURIComponent(target.trim()) || null
  } catch {
    return null
  }
}

/** One path resolved against the note it was written in: the folder that note is
 *  in, plus the road the link takes out of it, with `.` and `..` walked. */
function against(from: string, target: string): string {
  const here = from.replace(/\\/g, '/').split('/').slice(0, -1)
  const out: string[] = [...here]

  for (const step of target.replace(/\\/g, '/').split('/')) {
    if (step === '' || step === '.') continue
    if (step === '..') out.pop()
    else out.push(step)
  }

  return out.join('/')
}

/** The notes the embeds on one page name, by the name each embed used, so the
 *  renderer can ask for them without waiting on storage. */
async function embedded(
  env: Env,
  space: Space,
  notes: readonly Note[],
  source: string,
): Promise<(link: Wikilink) => string | null> {
  const byName = new Map<string, Note>()
  for (const note of notes) byName.set(nameOf(note.path), note)

  const wanted = new Set<string>()
  for (const link of findLinks(source)) {
    if (!link.embed || link.kind !== 'wikilink' || !link.target) continue
    if (wanted.size >= MOST_EMBEDDED) break
    wanted.add(nameOf(link.target))
  }

  const bodies = new Map<string, string>()
  await Promise.all(
    [...wanted].map(async (name) => {
      const note = byName.get(name)
      if (!note) return

      const object = await env.NOTES.get(noteKey(space.id, note.id))
      if (object) bodies.set(name, await object.text())
    }),
  )

  return (link) => bodies.get(nameOf(link.target)) ?? null
}

function title(note: Note, body: string): string {
  return (
    documentTitle(body) ??
    note.path
      .replace(/\.(md|markdown|mdown|mkd)$/i, '')
      .split('/')
      .pop() ??
    note.path
  )
}

/** The author's name under the note's own heading when it opens with one,
 *  and above the text when it does not: a name reads as a byline under a
 *  title, and as a header line over prose that has none. Nothing at all
 *  when there is no name - no placeholder, and never the email. */
function withByline(html: string, author: string | null): string {
  if (!author) return html

  const byline = `<p class="by">by ${escape(author)}</p>`
  const heading = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(html)

  return heading
    ? html.slice(0, heading[0].length) + byline + html.slice(heading[0].length)
    : byline + html
}

/** A stylesheet of the app's own, served from here.
 *
 *  Linked rather than written into the page: it is the same bytes for every note
 *  of every blog, its path is its own hash, so a reader fetches it once and keeps
 *  it, and the second page of a blog carries no stylesheet at all. See
 *  scripts/blog-css.ts. */
function sheet(body: string, kind = 'text/css'): Response {
  return new Response(body, {
    headers: {
      'content-type': `${kind}; charset=utf-8`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** One of the faces an equation is set in, served from here.
 *
 *  Carried in the bundle as base64 and handed over as the bytes it was. The whole
 *  set is 254kB of woff2; a reader's browser fetches the two or three faces the
 *  page it is reading actually uses and nothing else, and each path is that file's
 *  own hash, so a face is fetched once and kept. See scripts/blog-css.ts. */
function face(base64: string): Response {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  return new Response(bytes, {
    headers: {
      'content-type': 'font/woff2',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** KaTeX's sheet, linked by a page with an equation on it and by no other: a note
 *  without maths should not fetch a stylesheet for maths, let alone a font. The
 *  class the renderer writes around every formula is what says whether there is
 *  one - the same question an exported document asks of itself; see
 *  apps/desktop/src/lib/math-fonts.ts. */
function mathLink(body: string): string {
  return body.includes('class="katex') ? `\n<link rel="stylesheet" href="${MATH_CSS_PATH}">` : ''
}

/** The author's name, when they have given one: in the head for machines,
 *  in the footer for readers.
 *
 *  `#write` is Typora's name for a rendered note and is the id the writing
 *  surface, the reading view and an exported document all carry, so every rule in
 *  base.css and document.css - the very sheets the app loads - lands on this page
 *  too. That is the whole of what makes a published note look like the note. */
/** What language a published page says it is in.
 *
 *  One place, because two things read it: the page itself, and the numbers in a
 *  chart on it - `1,234.5` here rather than `1.234,5`, which is grouping the page
 *  cannot disagree with the tag above it about. A site has no language of its own
 *  to choose yet; when it has one, this is where it arrives. */
const PAGE_LANGUAGE = 'en'

/** Which way the page reads, from the language above and nothing else - the same
 *  rule and the same four languages as the app's, which is why the list is stated
 *  and not guessed; see apps/desktop/src/lib/direction.ts.
 *
 *  On the `html` element, so the furniture mirrors with it: the bar, the pages
 *  down one side, the contents down the other, the foot. The note inside is a
 *  different question and answers it itself - every block in `#write` takes the
 *  direction of its own first strong character, so an Arabic note on an English
 *  site reads right either way; see base.css. */
const RIGHT_TO_LEFT_PAGES = ['ar', 'fa', 'ps', 'ur']
const PAGE_DIRECTION = RIGHT_TO_LEFT_PAGES.includes(PAGE_LANGUAGE.split('-')[0] ?? '')
  ? 'rtl'
  : 'ltr'

/** What goes around the note: the bar at the top, the pages down the left, the
 *  contents down the right, what links here at the foot. Every part optional,
 *  because a site of one note has none of them; see blog/shell.ts. */
interface Furniture {
  bar?: string
  left?: string
  right?: string
  under?: string
  /** The author's own stylesheet and script, and a counter's script. */
  own?: { css: string | null; js: string | null }
  counter?: string
  /** The theme the author chose, as the stylesheet it was installed from. */
  theme?: string | null
}

function page(
  head: Head,
  body: string,
  env: Env,
  options: {
    status?: number
    locked?: boolean
    headers?: Record<string, string>
    shell?: Furniture
  } = {},
): Response {
  const author = head.author ?? null
  const shell = options.shell ?? {}

  // The sheets, in the order they win: the app's own, then the theme the author
  // installed, then whatever they wrote themselves. Each is served from this
  // site, so a reader's browser asks nobody else for the way a page looks.
  const sheets = [PAGE_CSS_PATH, ...(shell.theme ? [shell.theme] : [])]
  if (shell.own?.css) sheets.push(shell.own.css)

  const scripts = !options.locked
  const html = `<!doctype html>
<html lang="${PAGE_LANGUAGE}" dir="${PAGE_DIRECTION}"><head>
${headOf(head, sheets)}${mathLink(body)}
${scripts ? `<script>${THEME_JS}</script>` : ''}
${scripts ? `<script defer src="${SITE_JS_PATH}"></script>` : ''}
${shell.own?.js && scripts ? `<script defer src="${shell.own.js}"></script>` : ''}
${shell.counter ?? ''}
</head><body class="site">
${shell.bar ?? ''}
<div class="frame">
${shell.left ?? ''}
<div class="middle"><main id="write">${body}
<footer>${author ? `${escape(author)} · ` : ''}Published with <a href="${env.APP_ORIGIN}">Nib</a></footer>
</main>${shell.under ? `<div class="under">${shell.under}</div>` : ''}</div>
${shell.right ?? ''}
</div></body></html>`

  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A page nobody has said the password for is that reader's own to hold and
      // no shared cache's.
      'cache-control': options.locked ? 'private, no-store' : 'public, max-age=60',
      'content-security-policy': csp({
        scripts,
        ...(shell.counter ? { counter: new URL(counterUrl(shell.counter)).origin } : {}),
      }),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
      ...options.headers,
    },
  })
}

/** The address inside a counter's script tag, for the policy to name its origin.
 *  Read back off the markup rather than threaded through, so the tag and the
 *  policy cannot name two different providers. */
function counterUrl(tag: string): string {
  return /src="([^"]+)"/.exec(tag)?.[1] ?? 'https://example.invalid'
}

/** A deck as a page of its own. Every slide is in it, so a reader with scripting
 *  off still gets the whole talk and a printer gets one sheet per slide.
 *
 *  The same two sheets the app presents from - the prose of a note, and the stage
 *  it is read on - plus the two things a page with no app around it adds: how big
 *  the stage is, and that a slide which is not the one being read is not drawn.
 *  Both come from `@nib/markdown/deck`, along with the markup and the handful of
 *  lines that turn the pages, so the app, an exported deck and this one are one
 *  deck rather than three that look alike. */
function deckPage(head: Head, body: string): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const html = `<!doctype html>
<html lang="${PAGE_LANGUAGE}" dir="${PAGE_DIRECTION}"><head>
${headOf(
  {
    ...head,
    style: `.deck .stage{--stage-width:${DECK_WIDTH}px;--stage-height:${DECK_HEIGHT}px}${DECK_PAGE_CSS}`,
  },
  [PAGE_CSS_PATH, SLIDES_CSS_PATH],
)}${mathLink(body)}
</head><body class="deck-page">${body}
<script nonce="${nonce}">${DECK_SCRIPT}</script>
</body></html>`

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The reader's own browser may keep it; a shared cache may not. The nonce
      // is minted per response, and one handed to a second reader out of a cache
      // in front of this would be a nonce that is not a nonce.
      'cache-control': 'private, max-age=60',
      'content-security-policy': csp({ nonce }),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** The words `?slides` is asked for by, and the one word that offers it. A note
 *  that is not a deck never shows the link, so nothing on the page promises
 *  something it cannot do. */
const SLIDES_QUERY = 'slides'

function presentLink(source: string): string {
  return isDeck(source) ? `<p class="present"><a href="?${SLIDES_QUERY}">Present</a></p>` : ''
}

/** A published note read as slides: the same renderer and the same markup rules
 *  as the page itself, one slide at a time.
 *
 *  One thing differs, and it is the same thing that differs in the app: a single
 *  newline is a line break on a slide, because a slide is a poster. The page the
 *  same note is published as keeps CommonMark's space. The options the page was
 *  built with are spread rather than written into, since the caller renders the
 *  page with them too. */
function publishedDeck(source: string, options: Parameters<typeof renderMarkdown>[1]): string {
  return deckBody(
    deckOf(source).map((slide) => ({
      html: renderMarkdown(slide.markdown, { ...options, breaks: true }),
      shape: slide.shape,
      vertical: slide.vertical,
      fragments: slide.fragments,
    })),
  )
}

/** Whether the author reads a single newline as a line break, out of the settings
 *  blob on their row.
 *
 *  A published page is the author's note read by somebody else, so it reads the way
 *  the author reads it: a note that looks one way in the app and another way on the
 *  web is the whole thing the setting is there to prevent. One key out of a blob
 *  this module has no other business in, so it is read here rather than through the
 *  settings module - and read per request, never into a global, because one isolate
 *  serves many spaces. See `setHardBreaks` in @nib/markdown and the Markdown
 *  settings in the app.
 *
 *  Off for an unreadable blob, a row that is not there, or an account that has
 *  never said: off is CommonMark, which is what every other reader of the same file
 *  does with it. */
function hardBreaksIn(raw: string | null | undefined): boolean {
  return objectIn(raw)?.hardBreaks === true
}

/** How many notes an index lists. Well past any blog anyone writes, and a
 *  ceiling so that one hostname cannot ask for an unbounded page. */
const MOST_LISTED = 2000

/** What a note's page is called: its own `title:`, the heading it opens with, or
 *  its file name. All three are in the column, so a list of pages costs no
 *  bodies out of storage; see blog/front.ts. */
function titleOf(page: Page): string {
  return (
    page.front.title ??
    page.front.heading ??
    page.note.path.replace(MARKDOWN, '').split('/').pop() ??
    page.note.path
  )
}

/** The pages of a site, in path order: every note the rules publish, with what
 *  each says about itself.
 *
 *  A canvas is left out. It syncs as a note because it is text somebody edits on
 *  two machines, but it is a drawing rather than a page, and published it would
 *  come out as the JSON it is made of. So is a page note, which is the same bytes
 *  under a second extension: pages of paper written on with a pen. Published, one
 *  said its ink's coordinates, its cards' words and the address of every file it
 *  embedded, to anybody who guessed the slug - the thing the sentence above exists
 *  to prevent, missing only because the reading asked about one extension of the
 *  two. See `isPagesTarget` in @nib/markdown/links. */
async function sitePages(env: Env, space: Space, site: Site): Promise<Page[]> {
  const listing = await env.DB.prepare(
    'select * from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_LISTED)
    .all<Note>()

  const listed: Page[] = []
  for (const note of listing.results) {
    if (isCanvasTarget(note.path) || isPagesTarget(note.path)) continue

    const front = readFront(note.front)
    if (!publishes(site.rules, note.path, front)) continue

    listed.push({ note, front, slug: pageOf(note.path, front) })
  }

  return listed
}

/** What the machines are given about each page; see blog/feed.ts. */
function feedPages(listed: readonly Page[], origin: string): FeedPage[] {
  return listed.map((page) => ({
    url: `${origin}/${page.slug}`,
    title: titleOf(page),
    updated: page.note.updated_at,
    date: page.front.date,
    summary: page.front.description ?? page.front.summary,
  }))
}

/** The icon a browser tab shows: the drawing the app made of the space's own
 *  mark, or the letter it falls back to, drawn here.
 *
 *  Why the app draws it: a space wears an emoji, a Lucide stroke or a finished
 *  drawing out of a set the app fetches, and the side that has the sets is the
 *  side that can render one. A Worker that bundled every icon set to answer with
 *  half a kilobyte would be a Worker that starts slower for every request there
 *  is. See docs/publishing.md. */
function favicon(space: Space, site: Site): Response {
  const letter = escape((space.blog_title ?? space.name).trim().slice(0, 1).toUpperCase())

  const drawn =
    site.icon ??
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="7" fill="#17161c"/>` +
      `<text x="16" y="23" text-anchor="middle" fill="#fff" font-family="ui-sans-serif,system-ui,sans-serif" font-size="19" font-weight="600">${letter}</text>` +
      `</svg>`

  return new Response(drawn, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      // An icon is the author's own markup, and an SVG opened on its own is a
      // document on this site's origin; the same policy the diagrams get. See
      // `SVG_POLICY`.
      'content-security-policy': SVG_POLICY,
    },
  })
}

/** Where a picture named in front matter is served from: a file of the space, by
 *  any name a link could use for it, or a URL as it was written. Absolute,
 *  because the machines that read `og:image` do not resolve a relative one. */
function pictureAt(
  said: string | undefined,
  files: Map<string, string>,
  origin: string,
): string | undefined {
  if (!said) return undefined

  const written =
    said
      .replace(/^!?\[\[/, '')
      .replace(/\]\]$/, '')
      .split('|')[0]
      ?.trim() ?? ''
  if (!written) return undefined

  if (/^https?:\/\//i.test(written)) return written
  // A path of this site's own, which is what `/i/<hash>` is: the address a
  // picture in a note already has.
  if (written.startsWith('/')) return `${origin}${written}`

  const held = files.get(written.replace(/\\/g, '/').toLowerCase())
  return held ? `${origin}${held}` : undefined
}

/** The first picture on a page, for a note that named none of its own.
 *
 *  Read off the rendered page rather than out of the markdown, because by then
 *  every kind of picture a note can hold - a pasted one, an embedded file, a
 *  linked URL - is one tag with one address. A post whose first picture is its
 *  cover is the ordinary shape of a post, and a card with a picture is worth a
 *  great deal more than a card without one. */
function firstPicture(html: string, origin: string): string | undefined {
  const found = /<img\b[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1]
  if (!found) return undefined

  if (/^https?:\/\//i.test(found)) return found
  return found.startsWith('/') ? `${origin}${found}` : undefined
}

/** Whoever is asking has typed the password. */
async function answered(request: Request, held: SitePassword): Promise<boolean> {
  const form = await request.formData().catch(() => null)
  const said = form?.get('password')

  return typeof said === 'string' ? matches(held, said) : false
}

/** What the site lists, as the navigation, the backlinks and the search read a
 *  page. One shape, so none of them can mention a page the site has not got. */
function listed(page: Page): Listed {
  return { slug: page.slug, title: titleOf(page), path: page.note.path, front: page.front }
}

/** The published pages as the graph the app draws.
 *
 *  A node per page and an edge per link between two of them - the same `NoteGraph`
 *  the app's own graph is laid out and painted from, built here so the page can
 *  hand it to the app's own code rather than to a second implementation. Links to
 *  notes the site does not publish are dropped rather than drawn as the hollow
 *  nodes the app shows: on a site they would be the names of private notes.
 *
 *  `path` is where the node goes when it is pressed, which on a page is a link
 *  rather than a note to open. */
function graphOf(pages: readonly Page[], only?: Set<string>): string {
  const shown = only ? pages.filter((one) => only.has(one.slug)) : pages
  const at = new Map(shown.map((one, index) => [one.slug, index]))
  const byName = new Map<string, string>()

  for (const page of shown) {
    const whole = nameOf(page.note.path)
    const parts = whole.split('/')
    for (let one = 0; one < parts.length; one++) byName.set(parts.slice(one).join('/'), page.slug)
    for (const alias of page.front.aliases ?? []) byName.set(alias, page.slug)
  }

  const degree = new Map<string, number>()
  const edges: { a: number; b: number; both: boolean }[] = []
  const seen = new Set<string>()

  for (const page of shown) {
    const from = at.get(page.slug)
    if (from === undefined) continue

    for (const link of page.front.links ?? []) {
      const target = byName.get(link)
      const to = target === undefined ? undefined : at.get(target)
      if (to === undefined || to === from) continue

      const key = from < to ? `${from}-${to}` : `${to}-${from}`
      if (seen.has(key)) {
        const held = edges.find(
          (one) => (one.a === from && one.b === to) || (one.a === to && one.b === from),
        )
        if (held) held.both = true
        continue
      }

      seen.add(key)
      edges.push({ a: from, b: to, both: false })
      degree.set(page.slug, (degree.get(page.slug) ?? 0) + 1)
      degree.set(target ?? '', (degree.get(target ?? '') ?? 0) + 1)
    }
  }

  return JSON.stringify({
    nodes: shown.map((one) => ({
      id: one.slug,
      name: titleOf(one),
      path: `/${one.slug}`,
      degree: degree.get(one.slug) ?? 0,
      tags: one.front.tags ?? [],
    })),
    edges,
  })
}

/** JSON as a `<script>` element may carry it.
 *
 *  Nothing inside a script element is escaped by the HTML parser: the element ends
 *  at the first `</script` in it, whatever it is part of. So a note whose title is
 *  `</script><script src=…>` would close the island early and open a tag of its
 *  own - and a title is somebody's words, on a domain shared with every other
 *  site here. A `<` escape is how JSON writes a `<`, and `JSON.parse` on the
 *  other side reads it back as one, so the data is the same data and no tag can
 *  begin inside it.
 *
 *  Exported for test/blog.test.ts, which holds an island to it. What was here
 *  replaced `<` with the character `<`, and escaped nothing at all. */
export function asIsland(json: string): string {
  return json.replace(/</g, '\\u003c')
}

/** The picture, and the same pages as words under it.
 *
 *  A canvas is not a list: a reader with scripting off, a reader on a screen
 *  reader and a search engine all get the links, and the drawing is what is added
 *  for everybody else. `data-here` is which page is being read, so the graph marks
 *  it the way the app's does. */
function graphBody(pages: readonly Page[], here: string, only?: Set<string>): string {
  const shown = only ? pages.filter((one) => only.has(one.slug)) : pages

  const rows = shown
    .map((one) => `<li><a href="/${escape(one.slug)}">${escape(titleOf(one))}</a></li>`)
    .join('')

  return (
    `<div class="graph" data-here="${escape(here)}">` +
    `<script type="application/json">${asIsland(graphOf(pages, only))}</script>` +
    `</div><ul class="index">${rows}</ul>`
  )
}

/** Which pages are one link from this one, for the small graph on a page. */
function near(pages: readonly Page[], page: Page): Set<string> {
  const around = new Set<string>([page.slug])
  const all = pages.map(listed)
  const here = listed(page)

  for (const one of linkedFrom(all, here)) around.add(one.slug)

  const byName = pages.reduce((map, one) => {
    const parts = nameOf(one.note.path).split('/')
    for (let at = 0; at < parts.length; at++) map.set(parts.slice(at).join('/'), one.slug)
    for (const alias of one.front.aliases ?? []) map.set(alias, one.slug)
    return map
  }, new Map<string, string>())

  for (const link of page.front.links ?? []) {
    const found = byName.get(link)
    if (found) around.add(found)
  }

  return around
}

/** How many diagrams one page shows. A note is prose; past this it is a deck of
 *  pictures, and each one is two lookups before the page can be written. */
const MOST_DIAGRAMS = 24

/** Which of those hashes the space's owner is actually keeping.
 *
 *  The owner's own account rather than the store as a whole: a blob is addressed
 *  by its name and any account may write any name, so asking "does anybody hold
 *  this" would let somebody else's upload decide what appears on this page. One
 *  query for every diagram of the page, chunked because D1 binds a hundred
 *  parameters; see src/bound.ts. */
async function heldBlobs(
  env: Env,
  userId: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (!hashes.length) return new Set<string>()

  const found = await askInChunks(hashes, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select hash from blobs where user_id = ? and type = 'image/svg+xml'
        and hash in (${places(chunk.length)})`,
    )
      .bind(userId, ...chunk)
      .all<{ hash: string }>()

    return results
  })

  return new Set(found.map((row) => row.hash))
}

/** The diagrams this note has a picture for, as the figure each fence becomes.
 *
 *  Read before the render, for the same reason an embed is: rendering is one
 *  synchronous pass and this is a query. A fence with no picture yet is not in the
 *  map and stays the code block it was - which is what a note published from a
 *  device that has never drawn it looks like, and what a diagram mermaid refused
 *  looks like for ever. See packages/markdown/src/diagrams.ts for the naming and
 *  apps/desktop/src/lib/site-diagrams.ts for what puts the bytes there. */
async function diagramsIn(env: Env, space: Space, source: string): Promise<Map<string, string>> {
  const fences = codeBlocks(source)
    .filter((one) => isDiagram(one.language))
    .slice(0, MOST_DIAGRAMS)

  if (!fences.length) return new Map<string, string>()

  const named = await Promise.all(
    fences.map(async (one) => ({
      fence: one,
      light: await diagramKey(space.id, one.language, one.code, 'light'),
      dark: await diagramKey(space.id, one.language, one.code, 'dark'),
    })),
  )

  const held = await heldBlobs(env, space.user_id, [
    ...new Set(named.flatMap((one) => [one.light, one.dark])),
  ])

  const drawn = new Map<string, string>()
  for (const { fence, light, dark } of named) {
    if (!held.has(light)) continue

    drawn.set(
      `${fence.language}\n${fence.code}`,
      diagramFigure(fence.language.toLowerCase(), diagramAlt(fence.code), {
        light: `/i/${light}.svg`,
        // A device that sent the light drawing and not the dark leaves one
        // picture, which everybody then sees; see `diagramFigure`.
        dark: held.has(dark) ? `/i/${dark}.svg` : null,
      }),
    )
  }

  return drawn
}

/** What a fence on a page becomes: a diagram the app drew, coloured code, and -
 *  where a note asks a question - a form.
 *
 *  The one hook the renderer offers, so all three live here rather than the
 *  renderer learning about any of them. A ` ```form ` fence nobody can read stays
 *  a fence: see blog/form.ts for the grammar and why it is nib's own. */
function fencesOf(noteId: string, url: URL, request: Request, drawn: ReadonlyMap<string, string>) {
  const sent = url.searchParams.get('sent') === noteId
  const wrong = url.searchParams.get('wrong')

  return (code: string, language: string): string | null => {
    if (isDiagram(language)) return drawn.get(`${language}\n${code}`) ?? null

    if (language.toLowerCase() !== 'form') return blogFence(code, language)

    const form = formOf(code)
    if (!form) return null

    return formHtml(form, noteId, sent, request.method === 'GET' ? wrong : null)
  }
}

/** An answer somebody typed into a form on a page.
 *
 *  Answered with a redirect rather than a page, so that a reload after sending
 *  does not send it again and a reader with scripting off gets the same thing
 *  everybody else does. The note is named in the form rather than read off the
 *  address, because an address can be a permalink, an alias or a path that has
 *  moved. */
async function takeAnswer(
  env: Env,
  space: Space,
  request: Request,
  noteId: string,
): Promise<Response> {
  const back = (where: string) =>
    new Response(null, {
      status: 303,
      headers: { location: where, 'cache-control': 'private, no-store' },
    })

  const note = await env.DB.prepare(
    'select * from notes where id = ? and space_id = ? and deleted = 0',
  )
    .bind(noteId, space.id)
    .first<Note>()

  if (!note) return new Response('Not found', { status: 404 })

  const site = readSite(space.site)
  const front = readFront(note.front)
  if (!publishes(site.rules, note.path, front)) return new Response('Not found', { status: 404 })

  const object = await env.NOTES.get(noteKey(space.id, note.id))
  const source = object ? await object.text() : ''

  // The form as the note writes it, so what is accepted is what was asked: a
  // field the note does not have cannot be sent, whatever a machine posts.
  const fence = codeBlocks(source).find((one) => one.language.toLowerCase() === 'form')
  const form = fence ? formOf(fence.code) : null
  const where = `/${pageOf(note.path, front)}`
  if (!form) return back(where)

  // Counting, which is the whole of what is done about spam here: no captcha,
  // because that is a third party watching the reader, and nothing about them is
  // kept. See limits.ts.
  const machine = machineOf({ header: (name) => request.headers.get(name) ?? undefined })
  if (!(await maySendAnswer(env, machine)) || !(await mayTakeAnswer(env, space.id))) {
    return back(`${where}?wrong=${encodeURIComponent('Too many just now. Try later.')}`)
  }

  const sent = await request.formData().catch(() => null)
  if (!sent) return back(where)

  const read = answersFrom(form, sent)
  if ('wrong' in read) return back(`${where}?wrong=${encodeURIComponent(read.wrong)}`)

  await env.DB.prepare(
    'insert into form_answers (id, space_id, note_id, at, answers) values (?, ?, ?, ?, ?)',
  )
    .bind(newId(), space.id, note.id, Date.now(), JSON.stringify(read.answers))
    .run()

  return back(`${where}?sent=${encodeURIComponent(note.id)}`)
}

/** A published space, served.
 *
 *  The site is read here rather than inside, because one question about it is
 *  asked of every answer rather than of one: a site behind a password is nobody's
 *  to keep. Every page of one is `private, no-store`, whatever the page it came
 *  from said - the gate itself already said so, and the pages behind it are the
 *  ones worth protecting. Said once, out here, because a page that forgot it would
 *  be a page a shared cache hands to the next reader with no password at all: a
 *  proxy, a cache rule on the zone, a browser profile two people use. `Vary:
 *  Cookie` would be the other half of the same thing; `no-store` needs no half.
 *
 *  A site with no password - which is every site until somebody sets one - is
 *  served exactly as it was, cached for a minute at the edge. */
export async function serveBlog(
  env: Env,
  space: Space,
  url: URL,
  request: Request,
): Promise<Response> {
  const site = readSite(space.site)
  const answer = await served(env, space, url, request, site)
  if (!site.password) return answer

  const headers = new Headers(answer.headers)
  headers.set('cache-control', 'private, no-store')
  return new Response(answer.body, { status: answer.status, headers })
}

async function served(
  env: Env,
  space: Space,
  url: URL,
  request: Request,
  site: Site,
): Promise<Response> {
  // The stylesheets and the script, first of all: they are the same bytes
  // whatever the space, they are asked for by every page of every blog, and
  // neither the account nor the notes have anything to say about them.
  if (url.pathname === PAGE_CSS_PATH) return sheet(PAGE_CSS)
  if (url.pathname === SLIDES_CSS_PATH) return sheet(SLIDES_CSS)
  if (url.pathname === MATH_CSS_PATH) return sheet(MATH_CSS)
  if (url.pathname === SITE_JS_PATH) return sheet(SITE_JS, 'text/javascript')

  // And the faces that maths sheet names, which were the one thing a reader of a
  // page with an equation on it still fetched from somebody else.
  const wanted = MATH_FONTS[url.pathname]
  if (wanted) return face(wanted)

  const slug = url.pathname.replace(/^\/+|\/+$/g, '')
  const heading = space.blog_title ?? space.name
  /** Whether the reader asked for the note as a talk rather than as a page. */
  const slides = url.searchParams.has(SLIDES_QUERY)
  /** A page being fetched for a hover card wants the note and none of the
   *  furniture around it; see apps/desktop/src/site/site.ts. */
  const preview = request.headers.get('x-nib-preview') === '1'

  if (slug === 'favicon.svg') return favicon(space, site)
  if (slug === 'robots.txt') return robots(url.origin, !!site.password)

  // An answer to a form on one of the pages. Before the password, because a site
  // behind one still has to let a reader who is through it send an answer; the
  // ticket is checked below and a post without one lands on the form again.
  const answering = /^form\/([A-Za-z0-9_-]{1,64})$/.exec(slug)
  if (answering?.[1] && request.method === 'POST' && !site.password) {
    return takeAnswer(env, space, request, answering[1])
  }

  // The password, before anything a reader could read. A site that has none -
  // which is every site until somebody sets one - pays nothing for this.
  if (site.password) {
    const held = site.password
    const said = request.method === 'POST' ? await answered(request, held) : false

    if (said) {
      // Back to the page that was asked for, as a GET, carrying the ticket. A
      // reload after this is a reload of the page rather than of the form.
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname,
          'set-cookie': ticketCookie(await newTicket(held, Date.now())),
          'cache-control': 'private, no-store',
        },
      })
    }

    if (!(await ticketHolds(held, ticketIn(request.headers.get('cookie')), Date.now()))) {
      const wrong = request.method === 'POST'
      return page(
        { title: heading, site: heading, url: `${url.origin}/`, noindex: true },
        gateBody(heading, url.pathname, wrong),
        env,
        { status: wrong ? 401 : 200, locked: true },
      )
    }
  }

  // The owner's name and the one setting of theirs a page has to know: whether a
  // single newline breaks the line. Both off the one row, because it is one row -
  // a published page is on the hot path and this was already a query.
  const owner = await env.DB.prepare('select name, settings from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null; settings: string | null }>()
  const author = owner?.name ?? null
  const breaks = hardBreaksIn(owner?.settings)

  const files = readSpaceFiles(space.files)
  const byFile = fileUrls(files)

  /** What every page of this site says about itself before the page itself has
   *  its turn: the site's name, its description, its picture, its feed. */
  const about = (title: string, over: Partial<Head> = {}): Head => ({
    title,
    site: heading,
    url: `${url.origin}/${slug}`,
    author,
    description: site.description,
    image: pictureAt(site.image, byFile, url.origin),
    feed: true,
    icon: true,
    ...over,
  })

  /** The theme the author installed, served from where its bytes already are. */
  const theme = site.theme ? `/i/${site.theme.hash}.css` : null
  const own = ownFiles(byFile)
  const counting = counter(site)

  const missing = () =>
    page(about('Not found'), '<h1>Not found</h1>', env, {
      status: 404,
      shell: { theme, own, counter: counting },
    })

  // A file the space keeps beside its notes, asked for by the path a link in one
  // of them wrote. Before the notes, because it is settled by the path alone.
  const asked = slug ? fileFor(space, site, slug, url) : null
  if (asked) return asked

  // One note published on its own is the whole site: it sits at the root with
  // no index above it, and nothing else in the space is reachable. Asked for by
  // name rather than found in the listing, so it is served whatever else the
  // space holds.
  if (space.blog_note) {
    if (slug) return missing()

    const only = await env.DB.prepare(
      'select * from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, space.blog_note)
      .first<Note>()

    if (!only) return missing()

    const object = await env.NOTES.get(noteKey(space.id, only.id))
    const source = object ? await object.text() : ''
    const front = readFront(only.front)

    // One note is the whole site, so there is nowhere for a link between notes
    // to go; an embed still shows what it names, which is inside this page.
    const reading = {
      escapeHtml: true,
      code: fencesOf(only.id, url, request, await diagramsIn(env, space, source)),
      breaks,
      locale: PAGE_LANGUAGE,
      // One note is the whole site, so `linkResolver` has no other note to point
      // at - but the files beside it are still served, and a link to one still
      // has somewhere to go.
      resolveLink: linkResolver([], files),
      resolveNoteHref: noteHrefResolver(only.path, [], files),
      resolveEmbed: await embedded(env, space, [only], source),
    }

    // A site of one note has no index and no feed: the page is the site, so it
    // is the site's own front rather than one article of it.
    const head = about(front.title ?? title(only, source), {
      url: `${url.origin}/`,
      description: front.description ?? front.summary ?? site.description,
      image:
        pictureAt(front.image, byFile, url.origin) ?? pictureAt(site.image, byFile, url.origin),
      date: front.date,
      feed: false,
    })

    if (slides && isDeck(source)) return deckPage(head, publishedDeck(source, reading))

    const headings: Heading[] = []
    const rendered = renderMarkdown(source, { footnotes: true, toc: true, headings, ...reading })
    head.image ??= firstPicture(rendered, url.origin)

    return page(head, withByline(rendered, author) + presentLink(source), env, {
      shell: {
        theme,
        own,
        counter: counting,
        ...(preview ? {} : { right: contents(headings) }),
      },
    })
  }

  const pageList = await sitePages(env, space, site)
  const all = pageList.map(listed)

  /** What the furniture is built from, for every page of this site. */
  const around: Around = {
    site: heading,
    pages: all,
    searchable: all.length > 1,
    query: url.searchParams.get('q') ?? '',
  }

  // What a machine reads: every page, and the writing newest first. Both are the
  // list above in another shape, so neither can disagree with the site about
  // what is on it.
  if (slug === 'sitemap.xml') {
    return sitemap([
      { url: `${url.origin}/`, title: heading, updated: space.updated_at },
      ...feedPages(pageList, url.origin),
    ])
  }

  if (slug === 'feed.xml') {
    return feed(feedPages(pageList, url.origin), { title: heading, url: url.origin, author })
  }

  /** The search. Answered by the index, filtered to the pages the site
   *  publishes, and drawn as a page rather than as a list a script fetches. */
  if (slug === 'search') {
    const query = url.searchParams.get('q') ?? ''
    const one = readQuery(query)
    const hits = hasWords(one) ? await matching(env, space.id, one) : []
    const byId = new Map(pageList.map((page) => [page.note.id, page]))

    const found = (
      hasWords(one)
        ? hits.flatMap((hit) => {
            const held = byId.get(hit.noteId)
            return held ? [{ page: held, words: hit.words }] : []
          })
        : // A query of nothing but a tag or a folder is answered from the rows.
          pageList.map((held) => ({ page: held, words: held.front.summary ?? '' }))
    ).filter(({ page: held }) => {
      const tags = held.front.tags ?? []
      const path = held.note.path.toLowerCase()

      return (
        one.tags.every((tag) => tags.includes(tag)) &&
        one.folders.every((folder) => path.includes(folder))
      )
    })

    return page(
      about(query ? `${query} · ${heading}` : `Search ${heading}`, {
        url: `${url.origin}/search`,
        noindex: true,
      }),
      `<h1>Search</h1>${answers(
        found.map(({ page: held, words }) => ({
          slug: held.slug,
          title: titleOf(held),
          words,
        })),
        one,
        query,
      )}`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, 'search'),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  /** The whole site as a picture. The app's own graph, laid out and painted by
   *  the app's own code; see apps/desktop/src/site/site.ts. */
  if (slug === 'graph') {
    return page(
      about(`Graph · ${heading}`, { url: `${url.origin}/graph` }),
      `<h1>Graph</h1>${graphBody(pageList, '')}`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, 'graph'),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  if (!slug) {
    // Newest first, because a blog is read from the top, and by the name the
    // page itself carries rather than by its file name.
    const items = newestFirst(feedPages(pageList, url.origin))
      .map((one) => {
        const date = new Date(one.updated).toISOString().slice(0, 10)
        const where = escape(new URL(one.url).pathname)
        return `<li><a href="${where}"><span>${escape(one.title)}</span><time datetime="${date}">${date}</time></a></li>`
      })
      .join('')

    const byline = author ? `<p class="by">by ${escape(author)}</p>` : ''

    return page(
      about(heading, { url: `${url.origin}/` }),
      `<h1>${escape(heading)}</h1>${byline}<ul class="index">${items}</ul>`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, ''),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  const found = pageList.find((one) => pathsOf(one.note.path, one.front).includes(slug))

  if (!found) {
    // A path this site used to answer on. Somebody's link, somebody's history or
    // somebody's feed reader still says it, so it goes where the page went rather
    // than nowhere. Permanent, because the page did move; see blog/paths.ts.
    const was = await rememberedNote(env, space.id, slug)
    const moved = was ? pageList.find((one) => one.note.id === was) : null
    if (moved) return Response.redirect(new URL(`/${moved.slug}`, url).toString(), 301)

    return missing()
  }

  const note = found.note
  const object = await env.NOTES.get(noteKey(space.id, note.id))
  const source = object ? await object.text() : ''

  // A published note is public: its raw HTML is shown, never run. Its links to
  // other notes point at where those notes are published, and its embeds show
  // what they name - one level deep, which is the renderer's own rule.
  const reading = {
    escapeHtml: true,
    code: fencesOf(note.id, url, request, await diagramsIn(env, space, source)),
    breaks,
    locale: PAGE_LANGUAGE,
    resolveLink: linkResolver(pageList, files),
    resolveNoteHref: noteHrefResolver(note.path, pageList, files),
    resolveEmbed: await embedded(
      env,
      space,
      pageList.map((one) => one.note),
      source,
    ),
  }

  const head = about(found.front.title ?? title(note, source), {
    article: true,
    url: `${url.origin}/${found.slug}`,
    description: found.front.description ?? found.front.summary ?? site.description,
    image:
      pictureAt(found.front.image, byFile, url.origin) ?? pictureAt(site.image, byFile, url.origin),
    date: found.front.date,
  })

  // A note whose rules break it into slides can be read as a talk instead. The
  // same renderer and the same rules, one slide to a screen.
  if (slides && isDeck(source)) return deckPage(head, publishedDeck(source, reading))

  const headings: Heading[] = []
  const rendered = renderMarkdown(source, { footnotes: true, toc: true, headings, ...reading })
  head.image ??= firstPicture(rendered, url.origin)

  // A card on hover is the note and nothing else: no navigation to draw inside a
  // card the size of a paragraph, and no list of what links here.
  if (preview) {
    return page(head, withByline(rendered, author), env, { shell: { theme, own } })
  }

  const here = listed(found)

  return page(
    head,
    `<p class="back"><a href="/">← ${escape(heading)}</a></p>${withByline(rendered, author)}${presentLink(source)}`,
    env,
    {
      shell: {
        bar: bar(around),
        left: aside(around, found.slug),
        right: contents(headings),
        under: `${underneath(around, here)}${
          all.length > 2 ? graphBody(pageList, found.slug, near(pageList, found)) : ''
        }`,
        theme,
        own,
        counter: counting,
      },
    },
  )
}
