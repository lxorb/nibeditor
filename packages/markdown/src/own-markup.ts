/** Raw HTML in a document whose markup is markup, with what would act on the app
 *  taken out of it.
 *
 *  A document of the reader's own renders its HTML the way Typora does - `<u>`,
 *  `<details>`, a styled `<div>` - and it is put into the app's own page. What
 *  keeps a file somebody was handed from being their disk is the content policy
 *  (apps/desktop/src/csp.ts): no handler attribute runs, and a `<script>` that
 *  arrived through `innerHTML` never does. What the policy cannot stop is a thing
 *  that makes a *new* document or a navigation, because those carry the page's own
 *  permissions with them:
 *
 *  - an `<iframe src="javascript:…">`, which runs in the app the moment it is
 *    drawn, and an `<iframe srcdoc="…">`, a same-origin document whose own
 *    `<script>` is parsed as a script - written with `&lt;` so that nothing
 *    looking for `<script` finds it. Either inside a `<div>` got past the card an
 *    `<iframe>` at the start of a block becomes;
 *  - a `<meta http-equiv="refresh">`, which sends the whole window somewhere else;
 *  - a `<script>` mid-sentence, which is inert here and runs in the frame an
 *    export is printed and measured in, because that frame parses the document
 *    rather than having it assigned;
 *  - a `javascript:` target on anything that can be followed.
 *
 *  So a frame inside a block becomes the same card a frame on its own does - the
 *  card or nothing, never the tag; see web-embed.ts - and markup that still holds
 *  one of the rest is shown as the characters it is made of, the way a document
 *  from somebody else is. Refusing the whole piece rather than cutting the bad part
 *  out is on purpose: this reads HTML with patterns rather than a parser, and a
 *  pattern that decides what to keep can be argued with, where one that only
 *  decides whether to show the source cannot. */

import { escape } from './html'
import { iframeCard } from './web-embed'

/** The elements that make a document, a navigation or a program rather than
 *  show something. Checked as the opening of a tag, so `<linearGradient>` is not
 *  `<link>` and `</script>` alone - which ends nothing - passes. */
const ACTS =
  /<(?:script|iframe|frame|frameset|object|embed|applet|meta|base|link|portal)(?=[\s/>]|$)/i

/** A frame's opening tag, and its closing one. */
const FRAME_OPENS = /<iframe\b[^>]*>/gi
const FRAME_CLOSES = /<\/iframe\s*>/gi

/** A character reference a browser decodes inside an attribute before it reads
 *  the address: a number, or one of the three names that spell the characters a
 *  scheme needs. `&#106;avascript:` and `javascript&colon;` are both
 *  `javascript:` by the time anybody clicks. */
const REFERENCE = /&#(x[0-9a-f]+|\d+);?|&(colon|tab|newline);?/gi

const NAMED: Record<string, string> = { colon: ':', tab: '\t', newline: '\n' }

function decoded(html: string): string {
  return html.replace(REFERENCE, (whole, number: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole

    const code =
      number?.startsWith('x') || number?.startsWith('X')
        ? Number.parseInt(number.slice(1), 16)
        : Number(number)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole
  })
}

/** Whether a piece of markup names a scheme that runs code, anywhere in it. A
 *  browser skips whitespace and control characters while it reads an address,
 *  so they are skipped here too: `java&#9;script:` is a scheme to it. */
function namesScript(html: string): boolean {
  return /(?:java|vb)script:/i.test(decoded(html).replace(/[\s\p{Cc}\p{Cf}]/gu, ''))
}

/** The markup to put on the page for a piece of a trusted document's raw HTML. */
export function ownMarkup(html: string): string {
  const carded = html.replace(FRAME_CLOSES, '').replace(FRAME_OPENS, (tag) => iframeCard(tag) ?? '')

  return ACTS.test(carded) || namesScript(carded) ? escape(html) : carded
}
