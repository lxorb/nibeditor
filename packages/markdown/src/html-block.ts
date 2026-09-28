/** A block of raw HTML in a note that does something rather than shows
 *  something: a `<div>` and the `<script>` that fills it in.
 *
 *  Raw HTML is the form, not a ` ```html ` fence, and that is a decision about
 *  the file rather than about nib. Obsidian and Typora both render raw HTML where
 *  it stands and both drop the scripts out of it; an `html` fence is a code block
 *  in both, and in nib too - a fence says "show me these characters", every other
 *  fence keeps that promise, and one that quietly became a running program would
 *  make a note read differently depending on which editor opened it. So a block
 *  written the way the other two already render it is the block that runs here,
 *  and a note carrying one still shows its markup in them, minus the script.
 *
 *  What nib adds is that the script is not silently dropped. It is not run in the
 *  app either: it runs in a frame with an opaque origin, once the reader has asked
 *  for it, and that frame knows nothing about the note it sits in. The card is
 *  built here and the frame is built by the editor's web-frame.ts, which is the
 *  one place that decides what a frame may have.
 *
 *  Whose HTML runs at all is trust.ts's answer, not this file's: the renderer only
 *  reaches this when it is rendering a document whose markup is markup. A note in
 *  a room, in a shared space, or on a published page is escaped exactly as before,
 *  script and all, and comes out as the characters it is made of. */

import { escape } from './html'
import { cardMarkup, iframeCard } from './web-embed'

/** A whole `<script>…</script>` somewhere in the block.
 *
 *  Whole, because the halves are not a program: marked hands out a lone `<script>`
 *  as an inline tag when one turns up mid-sentence, and a card standing in for an
 *  opening tag would swallow the words after it. Both halves means this is the
 *  HTML block CommonMark says it is - everything from the tag to its closer - and
 *  that running it is what the note asked for. */
const SCRIPTED = /<script\b[^>]*>[\s\S]*?<\/script\s*>/i

/** Whether a piece of raw HTML is a thing that runs. */
function isInteractiveHtml(html: string): boolean {
  return SCRIPTED.test(html)
}

/** The room the card takes before the block has said how tall it is.
 *
 *  It says so the moment it is running - see web-frame.ts - so this is only ever
 *  the size of the card and of the first frame in it, never of the block for
 *  long. Small enough not to push the page about, big enough to be a thing worth
 *  pressing. */
const FIRST_HEIGHT = 180

/** The card a block of the note's own HTML becomes, or null for HTML that only
 *  shows something - a `<div>`, a `<details>`, a styled span - which needs no
 *  card and goes on through the renderer as markup the way it always has. */
export function htmlBlockCard(html: string): string | null {
  if (!isInteractiveHtml(html)) return null

  return cardMarkup({
    extra: 'embed-html',
    shape: FIRST_HEIGHT,
    // The block itself, as an attribute nothing fetches and no parser reads until
    // the frame is built out of it. `escape` covers every character that could
    // end the attribute or start a tag of its own.
    data: ` data-srcdoc="${escape(html)}"`,
    mark: 'play',
    // One word, and the word is what it is. A card that explained itself would
    // be the only card in the app that did.
    name: 'HTML',
    href: null,
  })
}

/** What else in a trusted document's HTML would act on the app rather than show
 *  something. The content policy stops handlers and a script put in by `innerHTML`;
 *  it does not stop a frame (`javascript:` or `srcdoc`), a `<meta>` refresh, a
 *  script in the frame an export is printed in, or a `javascript:` target. */
const ACTS =
  /<(?:script|iframe|frame|frameset|object|embed|applet|meta|base|link|portal)(?=[\s/>]|$)/i

/** A `javascript:` or `vbscript:` target however it is spelled: with character
 *  references, and with the blanks a browser skips inside an address. */
function namesScript(html: string): boolean {
  const decoded = html.replace(
    /&#(x?)([0-9a-f]+);?|&(colon|tab|newline);?/gi,
    (whole, x, n, name) => {
      if (name) return { colon: ':', tab: '\t', newline: '\n' }[String(name).toLowerCase()] ?? whole
      const code = Number.parseInt(String(n), x ? 16 : 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    },
  )
  return /(?:java|vb)script:/i.test(decoded.replace(/[\s\p{Cc}\p{Cf}]/gu, ''))
}

/** The rest of a trusted document's raw HTML: a frame becomes the card a frame on
 *  its own is, and markup still holding anything that acts is shown as its source.
 *  Whole rather than cut down, because patterns are no parser to decide what to
 *  keep. */
export function ownMarkup(html: string): string {
  const carded = html
    .replace(/<\/iframe\s*>/gi, '')
    .replace(/<iframe\b[^>]*>/gi, (tag) => iframeCard(tag) ?? '')

  return ACTS.test(carded) || namesScript(carded) ? escape(html) : carded
}
