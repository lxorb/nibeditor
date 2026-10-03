/** A model's answer as a page of the app draws it: the Ask panel's and the quick
 *  question's.
 *
 *  Markdown, with the model's raw HTML escaped - a model's words are nobody's markup -
 *  and every picture, frame and player taken out, so a note that talked a model into
 *  writing `![](https://somewhere/?what-you-wrote)` loads nothing from anywhere. Links
 *  stay, and are followed by whoever draws them. */

import { renderMarkdown, type RenderOptions } from '@nib/markdown'

type LinkResolver = NonNullable<RenderOptions['resolveLink']>

/** Pictures, frames and players: what an answer may not load. */
const MEDIA = /<(?:img|iframe|video|audio|source|picture|object|embed)\b[^>]*>/gi

export function answerHtml(markdown: string, resolveLink?: LinkResolver): string {
  const html = renderMarkdown(markdown, {
    escapeHtml: true,
    ...(resolveLink ? { resolveLink } : {}),
  })
  return html.replace(MEDIA, '')
}
