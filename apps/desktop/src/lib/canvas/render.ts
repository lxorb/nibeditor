/** What a card on the canvas shows.
 *
 *  A text card is a small page: the same renderer the reading view uses, so a
 *  heading, a table and a `[[link]]` in a card look exactly like they would in a
 *  note. What it is not is the whole reading pipeline - no diagrams to draw, no
 *  embeds to fetch first - because a card is a paragraph or two and rendering it
 *  must not wait on anything.
 *
 *  Remembered by the words it came from. Rendering one card is nothing; rendering
 *  five hundred on every pan is a frozen surface, and a canvas that is only being
 *  looked at renders nothing at all. */

import { hardBreaks, renderMarkdown } from '@nib/markdown'
import { isPicturePath } from '../space-paths'
import { assetUrl, joinPath } from '../tauri'
import { enginesArrived } from '../engines.svelte'
import { links } from '../link-index.svelte'
import { pointer } from '../reading/render'

/** How many cards' worth of HTML is worth keeping. Far more than a screenful,
 *  few enough that a long afternoon on a large canvas cannot grow without end. */
const MOST = 600

const cache = new Map<string, string>()
/** Which version of the link index the cache was built against. A note added or
 *  renamed changes which links resolve, so the answers are no longer answers. */
let at = -1

/** `trusted` is whether the HTML in this plane is markup rather than the
 *  characters it is made of. A plane arrives through a room card by card, so the
 *  words in one may be anybody's who is in the space; the rule is trust.ts, and
 *  the caller has already asked it. It is part of the key as well, because a
 *  space becoming shared changes the answer for cards already rendered. */
export function cardHtml(text: string, canvasPath: string | null, trusted: boolean): string {
  if (at !== links.version) {
    at = links.version
    cache.clear()
  }

  // Whether a single newline breaks the line is part of the key: it is the
  // renderer's own answer rather than an option passed in, so a card rendered
  // before the setting moved is no longer the card the renderer would draw.
  //
  // And so is how many of the renderer's heavy libraries have arrived, for exactly
  // the same reason: a card with a formula in it drawn before KaTeX landed shows the
  // formula's own source, and a canvas is only redrawn when something says so. This
  // is what says so; see engines.svelte.ts.
  const key = `${trusted ? 'own' : 'theirs'}\n${hardBreaks() ? 'br' : 'flow'}\n${enginesArrived()}\n${canvasPath ?? ''}\n${text}`
  const held = cache.get(key)
  if (held !== undefined) return held

  const html = renderMarkdown(text, {
    footnotes: true,
    escapeHtml: !trusted,
    resolveLink: pointer({ text, path: canvasPath }),
  })

  // Cleared rather than trimmed one at a time: this only happens on a canvas of
  // hundreds of cards, and a map that big is cheaper to drop than to prune.
  if (cache.size >= MOST) cache.clear()
  cache.set(key, html)

  return html
}

/** Whether a file node holds a picture rather than a note. A picture is shown as
 *  itself; anything else is read as markdown. */
export function isPicture(file: string): boolean {
  return isPicturePath(file)
}

/** A file node's path as something the webview will load. The path is relative to
 *  the space, which is how JSON Canvas writes one. */
export function fileUrl(file: string, root: string | null): string {
  return root ? assetUrl(joinPath(root, file)) : file
}

/** The markdown of the note a file node names, or null when the space holds
 *  none. Read through the index, which keeps the last handful in hand so a
 *  screenful of cards on the same note costs one read. */
export function fileSource(file: string): Promise<string | null> {
  return links.embedSource(file, null)
}
