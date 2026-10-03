/** A page, reduced to the part worth keeping: the one article extractor.
 *
 *  Everything here works on a DOM and nothing here knows about markdown. Three
 *  callers hand it one, and all three get the same answer: the clipper's content
 *  script the live page, the app a snapshot its web tab's page wrote of itself
 *  (`readSnapshot`, below), and the tests saved pages parsed by jsdom. So the same
 *  page clips to the same note from the extension and from a tab. What comes out is
 *  an HTML string whose every address is absolute, so the note reads the same from
 *  anywhere.
 *
 *  The article itself is found by Readability, which is the same extractor
 *  Firefox's reader mode uses. When it finds nothing - a page that is a list, a
 *  forum thread, an app - the selection stands in for it, and the body stands in
 *  for that.
 *
 *  Never on the way to a first paint: Readability is most of the weight here, and
 *  the app fetches this when somebody clips. */

import { Readability } from '@mozilla/readability'
import { absolute, runsCode } from './addresses'
import type { ClipOrigin } from './clip-note'
import { NEVER } from './from-html'
import { SELECTED } from './snapshot'

/** The three clips: the article, what is selected, and an address. */
export type ClipKind = ClipOrigin['kind']

/** The page's own controls, written inside its article where no extractor tells them
 *  from the words: a wiki's `[edit]` beside every heading, which in a note is a link to
 *  a form on somebody else's site sitting in the middle of a heading. */
const CONTROLS = ['.mw-editsection', '.editsection']

/** What a note never contains, as a selector a DOM can be swept with.
 *
 *  The list itself is `NEVER` in `from-html.ts`, where the converter refuses the
 *  same elements a second time in case one reaches it another way. Here it becomes
 *  one selector, plus the two things only a DOM can see: a field that is not a task
 *  list's tick, and whatever the page itself says is decoration rather than
 *  content. */
const NOT_CONTENT = [
  ...NEVER,
  'input:not([type="checkbox"])',
  '[aria-hidden="true"]',
  ...CONTROLS,
].join(',')

/** Where a clip came from: all the note's front matter needs, and small enough to
 *  travel between the popup and the service worker without the article. The note's
 *  own shape, `clip-note.ts`, says what it is. */
export type Origin = ClipOrigin

export interface Source extends Origin {
  /** The content as HTML, absolute throughout. Empty for a clipped link, which
   *  is an address and nothing else. */
  html: string
}

/** Where an image really is, for the several ways a page can defer loading one.
 *  A lazy image carries a placeholder in `src` and the real address in an
 *  attribute of the site's own choosing; these four are what the common
 *  libraries write. */
const LAZY = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc']

/** A transparent pixel or a blurred thumbnail stands in until a lazy image
 *  loads. Neither is worth a request, let alone a blob. */
function isPlaceholder(src: string): boolean {
  return !src || src.startsWith('data:')
}

/** The widest candidate a `srcset` offers. The descriptors are either widths
 *  (`640w`) or pixel ratios (`2x`); either way the largest number wins, and an
 *  entry with no descriptor counts as one. */
export function widestOf(srcset: string): string | null {
  let best: { url: string; weight: number } | null = null

  for (const candidate of srcset.split(',')) {
    const parts = candidate.trim().split(/\s+/)
    const url = parts[0]
    if (!url) continue

    const descriptor = parts[1] ?? '1x'
    const weight = Number.parseFloat(descriptor) || 1
    if (!best || weight >= best.weight) best = { url, weight }
  }

  return best?.url ?? null
}

/** Whether a link may keep the address it resolved to. Code the browser would
 *  run rather than follow may not, and neither may a `data:` document, which is
 *  a page of the site's own writing served inside whoever opens the note. */
function followable(address: URL): boolean {
  return !runsCode(address) && address.protocol !== 'data:'
}

/** Every image given the address it was deferring, and every `<picture>` reduced
 *  to the one image it meant.
 *
 *  Its own step, and not part of making the addresses absolute, because it has to
 *  happen before the extractor runs as well as after: Readability throws away a
 *  `<picture>` whose `img` carries no `src` of its own, and with it the only copy
 *  of the article's photographs. An `img` that turns out to mean nothing is left
 *  without a `src` for `absolutise` to remove. */
function undefer(root: ParentNode): void {
  for (const image of root.querySelectorAll('img')) {
    const found = bestSource(image)

    // Attributes the note has no use for, and which would otherwise keep a
    // relative address around beside the absolute one.
    image.removeAttribute('srcset')
    image.removeAttribute('sizes')
    for (const name of LAZY) image.removeAttribute(name)

    if (found) image.setAttribute('src', found)
    else image.removeAttribute('src')

    // The candidates a `<picture>` held have been read; what is left is a
    // wrapper the converter would turn into a stray space in front of the
    // picture.
    const picture = image.parentElement
    if (picture?.tagName.toLowerCase() === 'picture') picture.replaceWith(image)
  }
}

/** Every address in the tree made absolute against the page it came from. A link
 *  the browser would run rather than follow loses its href and stays as words,
 *  and an image with nowhere to point goes. */
export function absolutise(root: ParentNode, base: string): void {
  for (const link of root.querySelectorAll('a[href]')) {
    const target = absolute(link.getAttribute('href') ?? '', base)

    if (target && followable(target)) link.setAttribute('href', target.href)
    else link.removeAttribute('href')
  }

  undefer(root)

  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    const target = src ? absolute(src, base) : null

    // A picture may be the page's own bytes as a `data:` URL, so only the
    // schemes a browser runs are refused here.
    if (!target || runsCode(target)) {
      image.remove()
      continue
    }

    image.setAttribute('src', target.href)
  }
}

/** The address an `img` really means, before it is resolved. */
function bestSource(image: Element): string | null {
  const src = image.getAttribute('src') ?? ''
  if (!isPlaceholder(src)) return src

  for (const name of LAZY) {
    const deferred = image.getAttribute(name)
    if (deferred) return deferred
  }

  const own = image.getAttribute('srcset') ?? image.getAttribute('data-srcset')
  if (own) return widestOf(own)

  // A `<picture>` keeps its candidates in sibling `<source>` elements, and the
  // `img` inside it may carry nothing at all.
  const picture = image.parentElement
  if (picture?.tagName.toLowerCase() === 'picture') {
    for (const source of picture.querySelectorAll('source[srcset]')) {
      const widest = widestOf(source.getAttribute('srcset') ?? '')
      if (widest) return widest
    }
  }

  return src || null
}

/** This element, brought back into sight: the three ways an element hides itself
 *  taken off it. A class that hides it is the stylesheet's business, and the
 *  stylesheet is not here. */
function unhide(element: Element): void {
  element.removeAttribute('hidden')
  element.removeAttribute('aria-hidden')

  const left = (element.getAttribute('style') ?? '')
    .replace(/(?:display|visibility)\s*:[^;]*;?/gi, '')
    .trim()

  if (left) element.setAttribute('style', left)
  else element.removeAttribute('style')
}

/** Formulas, kept.
 *
 *  A page writes a formula twice: once as MathML, which it then hides, and once as
 *  a picture for whoever cannot draw MathML, which it marks as decoration. Both
 *  copies were thrown away - the extractor drops what a reader cannot see, and
 *  `clean` drops what the page calls decoration - and the note was left with a hole
 *  where the formula had been: "is the equality where", and nothing after it.
 *
 *  So the MathML is brought back into sight before anything reads the page, and
 *  with it the wrappers it sits alone inside, which is where a page does the hiding.
 *  Only those: an ancestor holding anything else is a part of the page and not this
 *  formula's coat. The picture beside it still goes, because the formula is about to
 *  be written as `$…$`, and saying it twice would upload a picture of what the note
 *  already holds. */
function keepMaths(root: ParentNode): void {
  for (const formula of root.querySelectorAll('math')) {
    let at: Element | null = formula

    while (at) {
      unhide(at)

      const above: Element | null = at.parentElement
      at = above?.children.length === 1 ? above : null
    }
  }
}

/** The attributes nothing in a note has any use for, taken off whatever the page
 *  put them on.
 *
 *  Nothing downstream keeps an attribute: the converter writes markdown out of the
 *  tree and only ever reads the handful it needs - `href`, `src`, `alt`, a code
 *  block's language. So this is a second lock rather than the first, and it is here
 *  because the first one is a library's: a rule that hands a node back as its own
 *  `outerHTML` puts every attribute on it into the note, which is exactly what a
 *  table used to do. A clipped page is somebody else's, and `onerror`, `style` and
 *  `srcdoc` are not things a note carries from one. */
const NEVER_KEPT = /^(?:on|style$|srcdoc$|formaction$|xlink:href$)/i

/** What a note never contains, plus what the page itself says is decoration. */
export function clean(root: ParentNode): void {
  keepMaths(root)
  for (const element of root.querySelectorAll(NOT_CONTENT)) element.remove()

  // The root as well as what is under it: a selection can begin inside the very
  // element that carries the handler.
  const all = root.querySelectorAll('*')
  for (const element of [...(root instanceof Element ? [root] : []), ...all]) {
    for (const name of element.getAttributeNames()) {
      if (NEVER_KEPT.test(name)) element.removeAttribute(name)
    }
  }
}

/** The tags the page publishes about itself. Sites write them as a comma list
 *  under `keywords` or one per `article:tag`, so both are read and the result
 *  is capped: a page that lists forty keywords is describing a site, not an
 *  article. */
export function pageTags(document: Document): string[] {
  const written: string[] = []

  for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase()
    if (name !== 'keywords' && name !== 'news_keywords' && name !== 'article:tag') continue

    written.push(...(meta.getAttribute('content') ?? '').split(','))
  }

  const tags: string[] = []
  for (const one of written) {
    const tag = one.trim().replace(/\s+/g, ' ').slice(0, 32)
    if (tag && !tags.includes(tag)) tags.push(tag)
  }

  return tags.slice(0, 8)
}

/** What an address alone suggests a thing is called: the last part of the path,
 *  or the host when the path says nothing. */
function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).at(-1)
    return last ? decodeURIComponent(last.replace(/\.[a-z0-9]{1,5}$/i, '')) : parsed.hostname
  } catch {
    return url
  }
}

/** The page's own name for itself, falling back to its address so a note is
 *  never called nothing.
 *
 *  `og:title` first, where a page has one: it is what the page calls itself
 *  when something else is going to show the name, so it carries the headline
 *  without the site's name bolted on after a pipe. */
export function pageTitle(document: Document, url: string): string {
  const shared = document.querySelector('meta[property="og:title"]')?.getAttribute('content')

  const named = [shared ?? '', document.title].map((one) => one.trim()).find((one) => one !== '')
  return named ?? titleFromUrl(url)
}

/** The words a link shows, for the link that was right clicked. The anchor is
 *  still on the page, so its own text is the truest title there is; a link that
 *  shows only a picture has none, and the address stands in. */
export function linkTitle(document: Document, target: string): string {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = (anchor as HTMLAnchorElement).href
    if (href !== target) continue

    const said = anchor.textContent.replace(/\s+/g, ' ').trim()
    if (said) return said.slice(0, 200)
  }

  return titleFromUrl(target)
}

/** The HTML of a node, cleaned and made absolute. One place, so the article,
 *  the selection and the whole body are all treated the same way. */
function contentOf(node: ParentNode, base: string): string {
  clean(node)
  absolutise(node, base)

  const holder = node as { innerHTML?: string }
  return (holder.innerHTML ?? '').trim()
}

/** What the page's own relative addresses resolve against.
 *
 *  The page itself, unless it named something else: a `<base href>` is what the
 *  browser resolves against, so it is what a note has to resolve against too, or
 *  every relative address in the clip points somewhere the reader never was. */
function baseOf(document: Document, url: string): string {
  return document.baseURI || url
}

/** The article, as Readability sees it, or null when it sees none. The document
 *  is cloned first because Readability rewrites what it is given. */
function readable(
  document: Document,
  url: string,
  base: string,
): { title: string; html: string } | null {
  const clone = document.cloneNode(true) as Document

  // Before the extractor rather than only after it. It keeps an ordinary `img`
  // and throws a `<picture>` away, which is how most of the publications worth
  // clipping serve their photographs; and it resolves what is left against the
  // page's address rather than against whatever the page said its base was.
  absolutise(clone.body, base)

  // Also before it, and for the same reason: the extractor drops what a reader
  // cannot see, and a formula is written out of sight.
  keepMaths(clone.body)

  // Readability strips every class by default, and one of them carries meaning
  // the note wants: `language-rust` on a code block is how the fence learns
  // what it is fencing. Nothing else here reads a class, and none of them
  // reach the markdown, so keeping them costs a little HTML and no risk.
  const article = new Readability(clone, { keepClasses: true }).parse()
  if (!article?.content) return null

  const parsed = document.implementation.createHTMLDocument('')
  parsed.body.innerHTML = article.content

  const html = contentOf(parsed.body, base)
  if (!html) return null

  const named = article.title?.trim() ?? ''
  return { title: named === '' ? pageTitle(document, url) : named, html }
}

/** What is selected, as HTML, or the empty string when nothing is. */
function selected(document: Document, base: string): string {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''

  const holder = document.implementation.createHTMLDocument('')
  for (let index = 0; index < selection.rangeCount; index++) {
    holder.body.appendChild(selection.getRangeAt(index).cloneContents())
  }

  return contentOf(holder.body, base)
}

/** The whole body, for a page whose article the extractor could not find and
 *  where nothing is selected. Rough, and better than an empty note. */
function whole(document: Document, base: string): string {
  const holder = document.implementation.createHTMLDocument('')
  holder.body.innerHTML = document.body.innerHTML

  return contentOf(holder.body, base)
}

/** The page as something to clip, by what was asked for.
 *
 *  `page` is the article, and falls back to the selection and then to the whole
 *  body, so an extractor that finds nothing costs a rougher note rather than no
 *  note. `link` is the address a link points at, which is the one the menu was
 *  opened on, or the page's own when the popup asked.
 *
 *  `url` is the page. `link` is what was right clicked, if anything was. */
export function extract(document: Document, kind: ClipKind, url: string, link?: string): Source {
  const tags = pageTags(document)

  if (kind === 'link') {
    const target = link ?? url
    const title = link ? linkTitle(document, link) : pageTitle(document, url)
    return { kind, url: target, title, html: '', tags }
  }

  const base = baseOf(document, url)

  if (kind === 'selection') {
    return { kind, url, title: pageTitle(document, url), html: selected(document, base), tags }
  }

  const article = readable(document, url, base)
  if (article) return { kind, url, title: article.title, html: article.html, tags }

  const fallback = selected(document, base) || whole(document, base)
  return { kind, url, title: pageTitle(document, url), html: fallback, tags }
}

/** The snapshot a web tab's page wrote of itself, as the same `Source` a live page
 *  gives: the selection where the page marked one, the article otherwise, and the
 *  body where the extractor finds none. See `snapshot.ts`.
 *
 *  Parsed by `DOMParser`, which makes a document that runs nothing and fetches
 *  nothing: no script in it executes and no picture in it is requested, so a page's
 *  markup is read in the window without being let into it.
 *
 *  The page writes its own base into the snapshot, already resolved, because a
 *  document parsed here would otherwise resolve every relative address against the
 *  app; where it did not - a snapshot of some other making - the page's address is
 *  the base, which is what a page with no `<base>` resolves against too. */
export function readSnapshot(html: string, url: string): Source {
  const page = new DOMParser().parseFromString(html, 'text/html')

  if (!page.querySelector('base[href]')) {
    const base = page.createElement('base')
    base.setAttribute('href', url)
    page.head.prepend(base)
  }

  if (!page.documentElement.hasAttribute(SELECTED)) return extract(page, 'page', url)

  return {
    kind: 'selection',
    url,
    title: pageTitle(page, url),
    html: contentOf(page.body, baseOf(page, url)),
    tags: pageTags(page),
  }
}
