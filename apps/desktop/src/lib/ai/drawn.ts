/** A model's answer as a page of the app draws it: the Ask panel's and the quick
 *  question's.
 *
 *  Markdown, with the model's raw HTML escaped - a model's words are nobody's markup -
 *  and every picture, frame and player taken out, so a note that talked a model into
 *  writing `![](https://somewhere/?what-you-wrote)` loads nothing from anywhere. Links
 *  stay, and are followed by whoever draws them.
 *
 *  A block of code wears a bar over it with its language and a copy button, ChatGPT's
 *  way: code in an answer is there to be taken somewhere else, and selecting it by hand
 *  out of a scrolling box is the one fiddly part of that. */

import { renderMarkdown, type RenderOptions } from '@nib/markdown'

type LinkResolver = NonNullable<RenderOptions['resolveLink']>

/** Pictures, frames and players: what an answer may not load. */
const MEDIA = /<(?:img|iframe|video|audio|source|picture|object|embed)\b[^>]*>/gi

/** A fenced block as the renderer writes it, and the language it names if any. */
const BLOCK = /<pre><code(?: class="language-([^"]*)")?>/g

/** The copy button's two faces, drawn by Answer.svelte as the press goes. */
const COPY_PATH =
  'M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z'

/** Every code block with its bar over it: the language at the start, a copy button
 *  at the end, labelled `copy` (already in the reader's language and escaped). */
export function withCodeBars(html: string, copy: string): string {
  const label = copy.replace(/[&<>"]/g, (one) => `&#${one.charCodeAt(0)};`)
  const opened = html.replace(BLOCK, (_, language: string | undefined) => {
    const named = language ? ` class="language-${language}"` : ''
    return (
      `<div class="code"><div class="code-bar"><span>${language ?? ''}</span>` +
      `<button type="button" class="code-copy" data-copy title="${label}" aria-label="${label}">` +
      `<svg viewBox="0 0 13 13"><path d="${COPY_PATH}"/></svg></button></div>` +
      `<pre><code${named}>`
    )
  })
  return opened === html ? html : opened.replace(/<\/code><\/pre>/g, '</code></pre></div>')
}

export function answerHtml(markdown: string, resolveLink?: LinkResolver, copy = ''): string {
  const html = renderMarkdown(markdown, {
    escapeHtml: true,
    ...(resolveLink ? { resolveLink } : {}),
  }).replace(MEDIA, '')
  return copy ? withCodeBars(html, copy) : html
}
