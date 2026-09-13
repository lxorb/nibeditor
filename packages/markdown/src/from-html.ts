/** HTML into the markdown Nib writes.
 *
 *  The other direction, and the same opinions read backwards: the markers here
 *  are the ones the editor's own formatting commands produce, so a page pasted
 *  into a note, an article the clipper saved and a note typed by hand are the
 *  same kind of file. Turndown does the walking, with the GFM rules on top for
 *  tables, task lists and strikethrough.
 *
 *  One copy of it, because there were two: the editor's paste and the clipper
 *  had each grown their own set of rules, and a page pasted into the app came
 *  out with three spaces after every bullet while the same page clipped came out
 *  with one. Whoever needs it imports it from here.
 *
 *  Pictures are the one thing a caller decides. The clipper has no address for
 *  them yet - the bytes are still on the site, and the address is the hash of
 *  bytes nobody has fetched - so it numbers them instead; a paste has the
 *  addresses already and keeps them. */

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { HIGHLIGHT_COLOURS, writeHighlight } from './highlights'
import { safeHref, safeSrc } from './html'
import { asWords } from './words'

/** What a note never contains.
 *
 *  Chrome, layout and interaction, none of which survives the trip into
 *  markdown: a script's source would arrive as a paragraph of code, a stylesheet
 *  as a paragraph of rules, a page's `<title>` as a line of prose above the
 *  heading it repeats. */
export const NEVER = [
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
]

export interface FromHtmlOptions {
  /** What a picture becomes. The default writes the address the page gave it. */
  image?: (source: string, alt: string) => string
  /** Whether a `file:` target is the caller's to resolve.
   *
   *  Off by default, which is what a clip and a paste want: the note is the finished
   *  thing, and an address on somebody else's disk is not one it can follow.
   *
   *  On for the imports, where it is the whole point. macOS writes
   *  `file:///Users/…/photo.png` into the HTML it hands out for every attachment,
   *  and that file is usually one of the files arriving beside the note - so the
   *  address has to survive the conversion for the pass afterwards to point it at
   *  where the file landed, and to leave it alone where the file was not in the
   *  export. See `isAddress` in apps/desktop/src/lib/import/rewrite.ts, which is the
   *  other half of this. */
  fileTargets?: boolean
}

/** The TeX a formula carries about itself.
 *
 *  MathML says what a formula means and markdown has no way of writing that down,
 *  but every renderer that emits MathML keeps the source it was built from - as an
 *  annotation inside it, which is where the MathML standard puts it, or as
 *  `alttext` on the element. KaTeX, MathJax and MediaWiki all write both. */
function texOf(maths: Element): string {
  const annotated = maths.querySelector('annotation[encoding="application/x-tex"]')
  const said = annotated?.textContent ?? maths.getAttribute('alttext') ?? ''

  return angled(said.replace(/\s+/g, ' ').trim())
}

/** A formula's own `<` and `>`, as TeX also writes them.
 *
 *  The formula is written into the note by the rule rather than as text, because
 *  text is escaped and every `\` in a formula would come back doubled - so nothing
 *  else is looking at what an `alttext` says. And a page chooses what that says: a
 *  formula whose TeX was `<img src=x onerror=…>` put a tag into the note, and a
 *  tag in a note of the reader's own is markup the app renders. So the two
 *  characters a tag can begin with are written the way TeX writes them anyway.
 *  KaTeX draws `\lt` and `\gt` as the same glyphs, and the note then holds nothing
 *  a markdown reader can see a tag in, whether or not the formula around them
 *  parses. */
function angled(tex: string): string {
  return tex.replace(/</g, '\\lt ').replace(/>/g, '\\gt ')
}

/** Whether this is the table's first `tbody`, which is where the GFM rules will
 *  look for a heading row outside a `thead`. An empty `thead` in front of it does
 *  not count against it; anything else does. */
function firstBody(element: Element | null): boolean {
  if (element?.nodeName !== 'TBODY') return false

  const before = element.previousElementSibling
  return before === null || (before.nodeName === 'THEAD' && !before.textContent.trim())
}

/** Whether the first row of a table is its headings, which is what the GFM rules
 *  ask before they will convert one at all: a row in a `thead`, or the first row
 *  of the table or of its first `tbody` with nothing but `th` in it.
 *
 *  Asked here as well, because the answer decides whether the table needs a
 *  heading row written for it - and it has to be the *same* answer, or the row
 *  rule and this one would disagree about what the table already says.
 *
 *  The `tbody` half of it is what was missing, and it was a way to get a page's
 *  own markup into a note: a table whose rows sit in a second `tbody` looked
 *  headed here and did not to the plugin, so neither rule claimed the table, and
 *  what turndown does with a node no rule claims is hand back its `outerHTML` -
 *  classes, handlers, nested tags, an `<img>` pointing at the page's own host and
 *  all. The rule below now claims every table, so a disagreement could only ever
 *  cost a line of dashes; this keeps the two agreeing anyway. */
function headed(table: HTMLTableElement): boolean {
  const first = table.rows[0]
  if (!first) return false

  const parent = first.parentElement
  if (parent?.nodeName === 'THEAD') return true

  const looked = parent?.nodeName === 'TABLE' || firstBody(parent)
  return (
    looked &&
    first.previousElementSibling === null &&
    [...first.cells].every((one) => one.nodeName === 'TH')
  )
}

/** The heading row markdown writes for a table that has none: as many empty cells
 *  as the table has columns, and the line of dashes under them. */
function emptyHeading(table: HTMLTableElement): string {
  const across = table.rows[0]?.cells.length ?? 0

  return `|${'  |'.repeat(across)}\n|${' --- |'.repeat(across)}`
}

/** The elements a formula can have a line of its own inside. Turndown's own list
 *  of what a blank line goes around, narrowed to the ones a page's prose nests a
 *  formula in; a heading is deliberately not among them, because a formula in a
 *  heading is part of the heading and not a block under it. */
const OWNS_A_LINE = new Set(['P', 'DIV', 'DD', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'SECTION', 'BODY'])

const HEADING = /^H[1-6]$/

/** Whether the formula is the whole of the block it sits in.
 *
 *  What decides between the two ways of writing one down, and the page's own
 *  `display` is not it: a site draws a formula on a line of its own with CSS while
 *  leaving it inside the sentence it belongs to, and `$$` in the middle of a
 *  sentence is not a formula to any reader of markdown. So the question is whether
 *  anything else shares the block - the words before and after it, in the page's
 *  own tree. */
function standsAlone(maths: Element): boolean {
  const said = maths.textContent.trim()
  let at: Element | null = maths.parentElement

  while (at && !OWNS_A_LINE.has(at.nodeName)) {
    if (HEADING.test(at.nodeName)) return false
    if (at.textContent.trim() !== said) return false
    at = at.parentElement
  }

  return !!at && at.textContent.trim() === said
}

/** A fence long enough to hold the code, whatever backticks the code contains. */
function fenceFor(code: string): string {
  const longest = [...code.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** What a fence's language may look like: a word, a version, a `c++` or a `c#`.
 *  Anything else a page wrote in the attribute is not a language. */
const A_LANGUAGE = /^[\w+#.-]{1,24}$/

/** The two languages a page does not get to choose for somebody's note.
 *
 *  A fence's language comes off the page's own markup, so a clipped article decides
 *  what kind of block the note holds - and these two are not blocks that show
 *  something. ` ```query ` runs a search over the reader's own space the moment the
 *  note is rendered, with nothing pressed; ` ```ai ` reads its own body as a prompt
 *  and puts an Ask glyph on the fence, so the body a page wrote is a question the
 *  reader is invited to send, with their note attached. Neither is a page's decision
 *  about somebody's note, so a clip naming one arrives as a fence with no language at
 *  all - the characters, which is what a clip is.
 *
 *  What is deliberately *not* here: `js` and its spellings, and the drawn ones -
 *  `mermaid`, `chart`, `flow`, `sequence`. A clipped page of developer documentation
 *  is the commonest clip there is, and its fences say `js` and `mermaid`; taking the
 *  language off them would cost the highlighting and the diagram on every one of them
 *  to prevent a glyph the reader has to press, which runs in a frame sandboxed with
 *  `allow-scripts` and nothing else (see packages/editor/src/run/run.ts) - the same
 *  thing that happens when somebody types a fence themselves. A page writing the
 *  characters of a `js` block into a note it was clipped from is the clip working.
 *
 *  Written here rather than imported because the editor owns the runners and it is
 *  this package's dependent, not its dependency; `packages/editor`'s languages.test.ts
 *  is what holds the two sides to each other. */
const THE_APP_S_OWN = new Set(['ai', 'query'])

/** The language a code block names, from the class or the attribute either half
 *  of it carries.
 *
 *  `language-ts` is the convention and `lang-ts` the older spelling, and both
 *  turn up on the same sites. `data-language` is what the highlighters now write
 *  instead: Shiki names it there and nowhere else, and Shiki is what the docs of
 *  half the tools a note is about are built with, so a clipped snippet used to
 *  arrive as a fence with no language on it and no highlighting anywhere after. */
function languageOf(pre: Element): string {
  const code = pre.querySelector('code')

  for (const one of [pre, code]) {
    const named = one?.getAttribute('data-language') ?? one?.getAttribute('data-lang') ?? ''
    const first = named.trim().split(/\s+/)[0]
    if (first) return named_(first)
  }

  const classes = `${pre.className} ${code?.className ?? ''}`
  return named_(/(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? '')
}

/** The language as the note may write it, or nothing at all: a word of the shape a
 *  language has, and not one of the app's own. */
function named_(said: string): string {
  const language = said.toLowerCase()
  return A_LANGUAGE.test(language) && !THE_APP_S_OWN.has(language) ? said : ''
}

/** What numbering the lists of a conversion did, counted.
 *
 *  Here for from-html.test.ts, which asserts these rather than a stopwatch. A
 *  five thousand item list used to be held to a wall-clock budget of a second and
 *  answered 1,400 ms on a runner with the rest of the suite on it, failing a test
 *  that had found nothing wrong; the same commit passed on its own minutes
 *  earlier. A timing is a proxy for the work done and a poor one, because what it
 *  measures is partly the queue in front of the code. These three are the same
 *  numbers on a busy machine as on an idle one, and between them they say the
 *  thing the test is about: one count per list rather than one per item.
 *
 *  Three adds over a conversion that walks a whole page. */
export interface Work {
  /** Lists counted out: one per parent, however many items hang off it. */
  lists: number
  /** Items that asked where they sit among their siblings. */
  items: number
  /** Siblings stepped over while counting those lists out. The one worth
   *  catching: a list is walked once, so this is the length of the list, and a
   *  return to a walk for every item makes it the length squared. */
  walked: number
}

function nothing(): Work {
  return { lists: 0, items: 0, walked: 0 }
}

const work = nothing()

/** What the conversions since this was last asked did, and zero from here. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** Where a node sits among its parent's elements, which is what numbers an item
 *  of an ordered list.
 *
 *  One count per parent, not per child: the walk this used to do over the
 *  parent's children was a walk for every item, so numbering a list cost a pass
 *  over the list for each line of it. The first item counts its siblings out and
 *  the rest read the answer. Counted out rather than spread: a browser's
 *  `HTMLCollection` can be iterated and the small DOM turndown carries for node
 *  cannot. */
function indexer(): (parent: Element | null, node: Node) => number {
  const counted = new WeakMap<Element, Map<Node, number>>()

  return (parent, node) => {
    if (!parent) return 0

    work.items += 1
    let places = counted.get(parent)

    if (!places) {
      work.lists += 1
      places = new Map()
      const kids = parent.children

      for (let at = 0; at < kids.length; at++) {
        work.walked += 1
        const kid = kids[at]
        if (kid) places.set(kid, at)
      }

      counted.set(parent, places)
    }

    return places.get(node) ?? 0
  }
}

/** Alt text that cannot break out of its own brackets.
 *
 *  A backslash is one of the ways out, and the one that was left: alt text
 *  ending in `\` had its escaped bracket escaped instead, the words closed early
 *  and the address after them was the page's rather than the picture's. */
function altOf(image: Element): string {
  return (image.getAttribute('alt') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/([\\[\]])/g, '\\$1')
    .trim()
}

/** Everything markdown reads inside a destination: the brackets that end one,
 *  the angle brackets that open and close the other spelling of one, the
 *  backslash that escapes any of them, the quote that opens a title, and the
 *  blanks and control characters that end a bare destination. */
const IN_DESTINATION = /[\s\p{Cc}()<>\\"]/gu

/** The two `encodeURIComponent` keeps, which are the two that end a destination. */
const KEPT: Record<string, string> = { '(': '%28', ')': '%29' }

/** An address as a markdown destination that cannot be broken out of.
 *
 *  Percent encoded rather than escaped with backslashes. Escaping is what
 *  turndown does for a link and what this copied, and it left the escape itself:
 *  a `\` the page put in the address escaped the backslash turndown wrote, the
 *  destination ended at the bracket after it, and the rest of the attribute was
 *  written into the note as markdown of its own - a second picture, pointing at
 *  whatever host the pasted HTML named. An address is a URL and a URL says the
 *  same thing percent encoded, so there is nothing left to escape and nothing
 *  left to end early. `File_(1).png`, which Wikipedia writes, comes out as one
 *  address rather than as an address and a bracket of prose.
 *
 *  Exported because the clipper fills its picture placeholders in after the
 *  conversion, when there is a blob to point at, and both halves of a clip have to
 *  say an address the same way. It had its own copy built on `encodeURI`, which
 *  escapes the percent as well: an address the page had already escaped came back
 *  escaping its own escapes, and `a%20b.png` was saved as `a%2520b.png`. The
 *  percent is not touched here - an address that already carries escapes stays the
 *  address it was. */
export function destination(address: string): string {
  return address.replace(IN_DESTINATION, (character) => {
    return KEPT[character] ?? encodeURIComponent(character)
  })
}

/** What a link says about itself, in the quotes markdown gives a title, or
 *  nothing at all.
 *
 *  Escaping the quote is what turndown does and it left the backslash that
 *  escapes the quote: a title ending in `\` closed nothing, and what followed the
 *  link was read as more of the title. A link keeps its title where a picture has
 *  none, because a link's address is the page's own - only a picture goes through
 *  a caller's hook, so there is no numbered placeholder here for a title to stand
 *  in front of. */
function titleOf(link: Element): string {
  const title = (link.getAttribute('title') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(["\\])/g, '\\$1')
    .trim()

  return title ? ` "${title}"` : ''
}

/** Whether a target may be written into the note at all.
 *
 *  The same question `safeHref` and `safeSrc` answer for a renderer, asked before the
 *  file is written rather than after: a note outlives the page it came from, so a
 *  `javascript:` or a `data:` document in one is a target nothing will ever follow
 *  and every surface has to refuse again. The exception is a caller resolving its
 *  own `file:` addresses; see `fileTargets`. */
function mayPointAt(said: string, options: FromHtmlOptions, picture = false): boolean {
  if (options.fileTargets === true && /^file:/i.test(said.trim())) return true
  return picture ? safeSrc(said) : safeHref(said)
}

function converter(options: FromHtmlOptions): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  service.use(gfm)

  // Turndown escapes the markdown a page's text would otherwise read as; a `<`
  // is the one it leaves, and the one that matters most here - see `asWords`,
  // which is the same rule the strings that never reach a converter go through.
  // Wrapped rather than replaced, and hung on the instance because that is where
  // turndown looks it up - and it looks it up only for text that is not inside
  // code, which is what keeps a fence's own brackets intact.
  const escapeMarkdown = service.escape.bind(service)
  service.escape = (text: string) => asWords(escapeMarkdown(text))

  // A filter rather than the list itself, because `svg` is not an HTML tag and
  // the list is one. For the clipper this is a second line of defence behind its
  // own DOM cleaning; for a paste it is the only one, since a clipboard's HTML
  // arrives as a whole document with a head on it.
  service.remove((node) => NEVER.includes(node.nodeName.toLowerCase()))

  // Kept for the one conversion, because the tree it counts lives for one
  // conversion.
  const indexIn = indexer()

  // A list item, with one space after its marker rather than turndown's three.
  // Nib writes `- item`, and a note full of `-   item` is a note that looks like
  // it came from somewhere else. Nested lines line up under the text, which is
  // what makes the nesting readable in the source.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, settings) => {
      const parent = node.parentNode as Element | null
      const ordered = parent?.nodeName === 'OL'
      const from = Number(parent?.getAttribute('start') ?? 1) || 1
      const at = indexIn(parent, node)

      const marker = ordered ? `${from + at}.` : (settings.bulletListMarker ?? '-')
      const indent = ' '.repeat(marker.length + 1)

      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, `\n${indent}`)
        // A ticked item brings its box and the space the page had after it; one
        // space between the box and the words is what markdown wants.
        .replace(/^(\[[ x]\])\s*/, '$1 ')

      const ends = node.nextSibling && !body.endsWith('\n') ? '\n' : ''
      return `${marker} ${body}${ends}`
    },
  })

  // GitHub's own spelling, which is the one the editor's format bar writes. The
  // plugin still says `~single~`, which this editor's parser reads as subscript.
  service.addRule('struck', {
    filter: ['del', 's'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  })

  // Highlighted text has a markdown form here, so keep it rather than drop it -
  // and its colour has one too, so a highlight copied out of the reading view and
  // pasted back is still the colour it was. The class is the one the renderer
  // writes; a `<mark>` from anywhere else is a highlight with no colour of its
  // own, which is what it looks like.
  service.addRule('highlight', {
    filter: ['mark'],
    replacement: (content, node) => {
      if (!content) return ''

      const named = (node as Element).className
      const found = HIGHLIGHT_COLOURS.find((one) => one.className && one.className === named)
      return `==${found ? writeHighlight(content, found) : content}==`
    },
  })

  // Underline has none, so the tag itself is the markdown; the editor renders it.
  service.addRule('underline', {
    filter: ['u'],
    replacement: (content) => (content ? `<u>${content}</u>` : ''),
  })

  // Raised and lowered text, which this editor has markers for and a page says in
  // tags. Neither was kept, and what was lost was not styling but the number:
  // `x²` arrived as `x2`, `H₂O` as `H2O` and `10⁶` as `106`, each of them a
  // different quantity from the one the page stated. A body the marker cannot hold
  // - one with the marker's own character in it - keeps the tag, as underline does.
  service.addRule('scripts', {
    filter: ['sup', 'sub'],
    replacement: (content, node) => {
      if (!content) return ''

      const tag = node.nodeName.toLowerCase()
      const marker = tag === 'sup' ? '^' : '~'
      const holds = !content.includes(marker) && !/^\s|\s$/.test(content)

      return holds ? `${marker}${content}${marker}` : `<${tag}>${content}</${tag}>`
    },
  })

  // A cell, and one line of it. Markdown has no way to write a newline inside a
  // cell, so a cell holding a paragraph, a list or a table of its own ended the
  // table where the newline was and left the rows after it as loose pipes; and a
  // cell whose own words contain a pipe used to split itself in two.
  service.addRule('cell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const said = content
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
      const first = (node as Element).previousElementSibling === null

      return `${first ? '| ' : ' '}${said} |`
    },
  })

  // Every table, because a table no rule claims is the page's own raw HTML: the
  // GFM rules hand one back verbatim - its classes, its styles, its attributes and
  // whatever is nested inside them - straight into the note, which the app then
  // renders as the note's own markup. A clipped page is somebody else's and none
  // of it is kept verbatim, so a table becomes a table: the rows as the row rules
  // wrote them, under the empty heading row markdown writes for a table that has
  // no headings of its own.
  service.addRule('table', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (content, node) => {
      const rows = content.replace(/^\n+/, '').trimEnd()
      if (!rows) return ''
      if (headed(node as HTMLTableElement)) return `\n\n${rows}\n\n`

      return `\n\n${emptyHeading(node as HTMLTableElement)}\n${rows}\n\n`
    },
  })

  // One rule for every preformatted block, whether or not it wraps a `code`.
  // Turndown's own fenced rule wants the pair, and a bare `pre` would otherwise
  // come out as a paragraph with its indentation collapsed.
  service.addRule('preformatted', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.textContent.replace(/\n+$/, '')
      if (!code.trim()) return ''

      const fence = fenceFor(code)
      return `\n\n${fence}${languageOf(node)}\n${code}\n${fence}\n\n`
    },
  })

  // A formula, as the `$…$` this editor and Obsidian both draw. MathML is what a
  // page renders one as, and the TeX it was built from travels inside it, so the
  // note keeps the formula rather than the letters it was made of: a clipped
  // Euler's identity is `e^{i\pi}+1=0` and not `eiπ+1=0`.
  //
  // Written by the rule rather than as text, because text is escaped: every `\`
  // in the formula would come back doubled and the note would draw nothing.
  // Named through a function rather than as a tag, because `math` is MathML and
  // turndown's own list of tags is HTML's.
  service.addRule('maths', {
    filter: (node) => node.nodeName.toLowerCase() === 'math',
    replacement: (content, node) => {
      const tex = texOf(node)
      if (!tex) return content

      if (standsAlone(node)) return `\n\n$$\n${tex}\n$$\n\n`

      // A dollar inside the formula is the one thing that would close it early,
      // and `\$` is how TeX writes one anyway. One that the page had already
      // escaped is left alone, or the escape would come back escaping itself.
      return `$${tex.replace(/(?<!\\)\$/g, '\\$')}$`
    },
  })

  // An address is an address whether a picture or a link carries it, and
  // turndown escapes the one in an `href` the way this used to escape the one in
  // a `src`: a `\` on the page ended the destination early, and the rest of the
  // attribute became a link of the page's own after it. So a link is written here
  // too, through the same encoder.
  //
  // One rule for both of turndown's, which are an inlined link and a referenced
  // one; the converter asks for inlined, and a rule added here answers before
  // either of them whatever it asks for.
  //
  // The words keep the escaping they arrive with. A link's text is markdown by
  // the time it reaches this - the emphasis inside it, or a picture of its own -
  // and its text nodes have been through `escape` above, which is where a
  // backslash and the brackets are already dealt with.
  service.addRule('link', {
    filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) => {
      const href = node.getAttribute('href') ?? ''
      // The words stay where the target may not be written down, which is what an
      // unresolvable link is anywhere; see `mayPointAt`.
      if (!mayPointAt(href, options)) return content

      return `[${content}](${destination(href)}${titleOf(node)})`
    },
  })

  // The two things a picture says, and no `title`, which is the one place it
  // differs from a link: a caller's address arrives after the conversion, and the
  // clipper fills its numbers in by the shape `](nib:0)`, so a title written
  // between them would leave the placeholder in the note. A page's own goes with
  // the rest of the attributes, and there is no third string here to break out
  // of a title's quotes.
  service.addRule('picture', {
    filter: 'img',
    replacement: (_content, node) => {
      const source = node.getAttribute('src') ?? ''
      // The same rule a link goes through, and the one difference a picture makes: a
      // small one may travel inside the document as a `data:` image, and an SVG is a
      // document rather than a picture so it is not one of those.
      if (!source || !mayPointAt(source, options, true)) return ''

      const alt = altOf(node)
      return `![${alt}](${destination(options.image ? options.image(source, alt) : source)})`
    },
  })

  return service
}

/** Blank lines are how markdown separates blocks, and more than one of them says
 *  nothing extra. Trailing spaces on a line mean a hard break, so only the ones
 *  on otherwise empty lines go. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlToMarkdown(html: string, options: FromHtmlOptions = {}): string {
  if (!html.trim()) return ''
  return tidy(converter(options).turndown(html))
}
