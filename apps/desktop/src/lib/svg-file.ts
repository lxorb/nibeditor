/** A drawing, read tag by tag, so that what a file holds is what a picture is.
 *
 *  An SVG is a document. On a published page a diagram is only ever an `<img>`,
 *  where nothing runs and nothing is fetched - but its address is a link like any
 *  other, and a reader who opens it is opening a document on that site's own
 *  hostname. So what the file may hold is an allow-list: the shapes, the text and the
 *  furniture a drawing library writes, and nothing that embeds, animates or points
 *  anywhere.
 *
 *  Read rather than swept. This was a handful of regular expressions - a `<script>`
 *  pair, `on…="…"` in either quote, `href="…"` in double quotes - and every one of
 *  them was a shape somebody else's markup does not have to take: `href='…'` and
 *  `href=…` unquoted survived it, and so did `<use>`, `<foreignObject>` and
 *  `<animate attributeName="href">`, none of which is a shape. An allow-list read off
 *  the tags cannot be got round by writing the same thing differently, because what
 *  it asks is what the tag *is*.
 *
 *  Its own module because it is one question with no opinion about diagrams in it,
 *  and because site-diagrams.ts is otherwise about a publish. No DOM: this runs in
 *  the app, in the plugin, and in a test, and a parser that exists in only two of
 *  those would be a scrub that quietly did nothing in the third. */

/** What a drawing is made of: structure, shapes, text, and the things a fill or a
 *  marker points at by name. Anything else - `<script>`, `<image>`, `<use>`,
 *  `<foreignObject>`, `<iframe>`, `<animate>` and the rest of the animation family,
 *  the filter primitives that can fetch - is not a shape and does not survive.
 *
 *  `<a>` is here because a link inside a picture is a place in the picture, and its
 *  target is judged like any other below: a `#fragment` stays and an address goes,
 *  which leaves the tag inert rather than absent. `<style>` is here because the
 *  classes a drawing library writes live in it; what it can reach is settled by the
 *  policy the store serves it under, not by this. */
const SHAPES = new Set([
  'svg',
  'g',
  'a',
  'defs',
  'style',
  'title',
  'desc',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'path',
  'line',
  'polyline',
  'polygon',
  'rect',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'textpath',
])

/** An attribute no shape needs: a handler, a target, and the name an animation would
 *  write through. A target is judged rather than named, so it is not here; see
 *  `pointsInside`. */
function allowed(name: string): boolean {
  const said = name.toLowerCase()
  if (said.startsWith('on')) return false

  return !['target', 'attributename', 'xlink:show', 'xlink:actuate', 'begin', 'end'].includes(said)
}

/** Whether a target is a place in this picture rather than somewhere else. A
 *  `#fragment` is how a fill, a marker and a clip path name each other. */
function pointsInside(value: string): boolean {
  return value.trim().startsWith('#')
}

/** One tag, read from the `<`: where it ends, what it is called, whether it closes
 *  itself, and what its attributes say. Quotes are read properly, which is the whole
 *  point: a `>` inside an attribute does not end a tag. */
interface Tag {
  /** Where the `>` is, or the end of the text for a tag nobody closed. */
  to: number
  /** The name as written. SVG is case-sensitive - a `linearGradient` written
   *  `lineargradient` is an element nothing has heard of - so what goes back out is
   *  what came in, and only the asking is case-blind. */
  raw: string
  name: string
  closing: boolean
  selfClosing: boolean
  attributes: { name: string; value: string; quote: string }[]
}

function readTag(svg: string, from: number): Tag | null {
  let at = from + 1
  const closing = svg[at] === '/'
  if (closing) at += 1

  const start = at
  while (at < svg.length && /[^\s/>]/.test(svg[at] ?? '')) at += 1
  const raw = svg.slice(start, at)
  const name = raw.toLowerCase()
  if (!name) return null

  const attributes: Tag['attributes'] = []

  for (;;) {
    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1
    const one = svg[at]
    if (one === undefined) return null

    if (one === '>') return { to: at, raw, name, closing, selfClosing: false, attributes }
    if (one === '/' && svg[at + 1] === '>') {
      return { to: at + 1, raw, name, closing, selfClosing: true, attributes }
    }

    const named = at
    while (at < svg.length && /[^\s=/>]/.test(svg[at] ?? '')) at += 1
    const said = svg.slice(named, at)
    if (!said) return null

    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1
    if (svg[at] !== '=') {
      // An attribute with no value at all, which SVG has none of and HTML writes.
      attributes.push({ name: said, value: '', quote: '' })
      continue
    }

    at += 1
    while (at < svg.length && /\s/.test(svg[at] ?? '')) at += 1

    const quote = svg[at] === '"' || svg[at] === "'" ? (svg[at] ?? '') : ''
    if (quote) at += 1

    // An unquoted value runs to the next space or `>` and to nothing else. Stopping at
    // a `/` as well would read `href=https://elsewhere.example` as the word `https:`
    // followed by nothing that parses, which is how an address gets through a reader
    // by being written without quotes.
    const opened = at
    while (at < svg.length && (quote ? svg[at] !== quote : /[^\s>]/.test(svg[at] ?? ''))) at += 1

    attributes.push({ name: said, value: svg.slice(opened, at), quote })
    if (quote) at += 1
  }
}

/** The tag written again with only the attributes a shape may carry. */
function written(tag: Tag): string {
  const said = tag.attributes
    .filter((one) => allowed(one.name))
    .filter((one) => !/^(?:xlink:)?href$/i.test(one.name) || pointsInside(one.value))
    .map((one) => {
      if (!one.quote && !one.value) return one.name
      // Written in double quotes whatever it arrived in, and the quote inside it
      // written as the entity: an attribute cannot end early that way.
      return `${one.name}="${one.value.replace(/"/g, '&quot;')}"`
    })

  return `<${tag.raw}${said.length ? ` ${said.join(' ')}` : ''}${tag.selfClosing ? '/' : ''}>`
}

/** Where the element that opened at `tag` closes, counting the ones of the same name
 *  inside it, or the end of the text for one nobody closed. */
function past(svg: string, tag: Tag): number {
  let at = tag.to + 1
  let depth = 1

  while (at < svg.length && depth > 0) {
    const next = svg.indexOf('<', at)
    if (next === -1) return svg.length

    const inner = readTag(svg, next)
    if (!inner) {
      at = next + 1
      continue
    }

    if (inner.name === tag.name && !inner.selfClosing) depth += inner.closing ? -1 : 1
    at = inner.to + 1
  }

  return at
}

/** A drawing with nothing in it but the drawing.
 *
 *  Everything that is not a shape goes, and goes whole: an element that is not on the
 *  list takes its own content with it, so a `<foreignObject>` does not leave a page of
 *  HTML behind in the file. Comments, doctypes and processing instructions go the same
 *  way - a picture says nothing in them. */
export function shapesOnly(svg: string): string {
  let out = ''
  let at = 0

  while (at < svg.length) {
    const next = svg.indexOf('<', at)
    if (next === -1) return out + svg.slice(at)

    out += svg.slice(at, next)

    // A comment, a CDATA section, a doctype: read to its own end and keep none of it.
    if (svg.startsWith('<!--', next)) {
      const shut = svg.indexOf('-->', next)
      at = shut === -1 ? svg.length : shut + 3
      continue
    }
    if (svg.startsWith('<![CDATA[', next)) {
      const shut = svg.indexOf(']]>', next)
      at = shut === -1 ? svg.length : shut + 3
      continue
    }
    if (svg.startsWith('<!', next) || svg.startsWith('<?', next)) {
      const shut = svg.indexOf('>', next)
      at = shut === -1 ? svg.length : shut + 1
      continue
    }

    const tag = readTag(svg, next)
    if (!tag) {
      // A `<` that opens nothing is a character in the text.
      out += svg[next] ?? ''
      at = next + 1
      continue
    }

    if (SHAPES.has(tag.name)) {
      out += tag.closing ? `</${tag.raw}>` : written(tag)
      at = tag.to + 1
      continue
    }

    // Not a shape. A closing tag of its own is already gone with it.
    at = tag.closing || tag.selfClosing ? tag.to + 1 : past(svg, tag)
  }

  return out
}
