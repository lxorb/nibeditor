/** Putting a note's own words into HTML.
 *
 *  Everything this package renders was written by whoever wrote the note, and
 *  when a note is published it is served to strangers from a domain shared with
 *  every other blog. Escaping the raw HTML in a note is not enough on its own:
 *  a construct that builds its own markup out of the source, or writes a target
 *  the author chose into an attribute, goes straight past that. So each of the
 *  ways text reaches HTML has a function here, and the renderers call one
 *  rather than interpolating anything of their own. */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text as HTML, for element content and for a double-quoted attribute that is
 *  not a URL.
 *
 *  An ampersand that already opens an entity is left alone, which is what
 *  marked's own escaping does: a note that wrote `&amp;` meant the ampersand,
 *  and escaping it again would show the five characters instead. That is safe
 *  here because an entity which survives renders as text - every character that
 *  could end the attribute or start a tag is gone either way. It is not safe
 *  inside a URL, which is why `attributeUrl` below does not do it. */
export function escape(text: string): string {
  return text.replace(/&(?!#?\w+;)|[<>"']/g, (character) => ESCAPES[character] ?? character)
}

/** The schemes a link may name. Everything else is dropped rather than written:
 *  `javascript:` and `vbscript:` run code, and a `data:` document is a page of
 *  the author's own served inside the reader's origin. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/** A picture may also travel inside the document as a `data:` URL. Not
 *  `image/svg+xml`: an SVG is a document, and can carry script. */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);/i

/** Whitespace and control characters taken out, because a browser skips them
 *  while reading a URL: `java&#9;script:alert(1)` names a scheme to it even
 *  though it does not read as one here. */
function withoutBlanks(target: string): string {
  return target.replace(/[\s\p{Cc}\p{Cf}]/gu, '')
}

/** The scheme a target names, lowercased, or the empty string for the relative
 *  paths, `#fragment`s and `?query`s that name none. */
function schemeOf(target: string): string {
  return /^([a-z][a-z\d+.-]*):/i.exec(withoutBlanks(target))?.[1]?.toLowerCase() ?? ''
}

/** Whether a target may go into an `href`. */
export function safeHref(target: string): boolean {
  const scheme = schemeOf(target)
  return scheme === '' || SAFE_SCHEMES.has(scheme)
}

/** Whether a target may go into an `img src`. */
export function safeSrc(target: string): boolean {
  return safeHref(target) || SAFE_DATA_IMAGE.test(withoutBlanks(target))
}

/** The schemes nothing may name, whoever is asking: the two that run code, and the
 *  three that serve a document of the author's own inside the reader's origin. */
const CODE_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'blob', 'filesystem'])

/** Whether a target names another app rather than the web, and is safe to write into
 *  a note as it stands.
 *
 *  For an import and for nothing else. `applenotes:note/ideas`, `bear://x-callback-url/…`,
 *  `evernote:///view/…`, `obsidian://open?…`: a link to something an export did not
 *  carry is a fact about where the note used to live, and dropping it loses the one
 *  thing the note still said about that. It is not rendered as a link by anything -
 *  `safeHref` above still refuses it - so what this allows is the address surviving in
 *  the file, which is where the reader can see it and another app can read it.
 *
 *  A scheme that names none is not one of these: a relative path is `safeHref`'s
 *  business, and answering yes to it here would let this stand in for that. See
 *  `appTargets` in from-html.ts. */
export function appHref(target: string): boolean {
  const scheme = schemeOf(target)
  return scheme !== '' && !CODE_SCHEMES.has(scheme)
}

/** A target ready for an attribute: percent-encoded the way marked's own
 *  renderer does it, and then with *every* ampersand written as an entity.
 *
 *  That last step is what the checks above rest on. A browser decodes entities
 *  while it parses an attribute, so a target of `javascript&colon;alert(1)`
 *  names no scheme when `safeHref` reads it and names `javascript:` by the time
 *  anyone clicks it. Escaping the ampersand means no entity can form after the
 *  check, and it is what the HTML wanted anyway: a bare `&` in an attribute is
 *  not valid. */
export function attributeUrl(target: string): string {
  let encoded: string
  try {
    encoded = encodeURI(target).replace(/%25/g, '%')
  } catch {
    // A lone surrogate, which the encoder refuses. There is nothing to point at.
    return ''
  }
  return encoded.replace(/&/g, '&amp;')
}

/** A name the note chose, as something that can be an `id` and the `#fragment`
 *  pointing at it. Percent-encoding is what an anchor wants in any case, and it
 *  leaves nothing that could end the attribute or open a tag:
 *  `encodeURIComponent` never emits `<`, `>`, `"` or `&`. */
export function fragment(name: string): string {
  try {
    return encodeURIComponent(name)
  } catch {
    // A lone surrogate again: nothing readable to keep, and nothing to link to.
    return ''
  }
}
