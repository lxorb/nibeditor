/** The miniature a theme is judged by.
 *
 *  A card in the gallery shows a small note rendered with the theme's own
 *  tokens: a heading, a paragraph, a list, a fence. Not a screenshot, and not a
 *  second set of prose rules written to look like the app's - the app's own
 *  rules are taken as text and re-scoped, so a miniature cannot drift from the
 *  thing it is a miniature of. One stylesheet serves every card.
 *
 *  Scaled rather than shrunk: the page inside the frame is laid out at the width
 *  a real note has and then scaled down, so the proportions are the ones the
 *  reader will get. Eight-pixel text would only be mush. */

import { t } from '../i18n.svelte'
import type { Palette, StoreTheme } from './registry'
import { closes } from './validate'

/** The frame, and the page inside it. Global names in the app's own `nib-`
 *  family, because the stylesheet below is injected rather than scoped: the
 *  markup is handed over as HTML and Svelte's scoping never reaches it. */
export const FRAME = 'nib-mini'
const PAGE = 'nib-mini-page'

/** Where the app's prose rules point once they are re-scoped. */
const SURFACE = `.${PAGE}`

/** How tall the sample note is at the size a note is really read at, in each of
 *  the two lengths it comes in. Every card shows the same note, so these are
 *  constants rather than something measured on thirty elements; the frame takes
 *  its height from whichever it is showing. */
const CARD_HEIGHT = 296
export const FULL_HEIGHT = 428

/** The top-level rules of a stylesheet, as they were written.
 *
 *  Only the top level: a rule inside a media query belongs to a screen width,
 *  and the miniature's width is not the screen's. Nested blocks are stepped over
 *  whole, which is also what keeps this from having to understand at-rules. The
 *  picker's cards read a sheet the same way; see theme-picker/looks.ts. */
export function* rules(source: string): Generator<{ prelude: string; body: string }> {
  // Taken out first: what stands between one rule and the next is that rule's
  // selector, and the sheets these come from are commented throughout. A
  // comment left in is a comment read as part of the name of the thing after it.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  let at = 0
  let start = 0

  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) return

    // The same walk the validator uses to find where a block ends, quotes and
    // nesting included, so the two cannot disagree about what a rule is.
    const close = closes(css, open)
    const prelude = css.slice(start, open).trim()
    const body = css.slice(open + 1, close)

    start = close + 1
    at = close + 1

    if (!prelude.startsWith('@') && !body.includes('{')) yield { prelude, body }
  }
}

/** The rules whose selectors mention the writing surface, pointed at the
 *  miniature's page instead. */
export function rescoped(css: string, surface = SURFACE): string {
  return [...rules(css)]
    .filter((rule) => rule.prelude.includes('#write'))
    .map((rule) => `${rule.prelude.replace(/#write/g, surface)} {${rule.body}}`)
    .join('\n')
}

/** The token blocks that belong to no particular scheme, restated on the frame.
 *
 *  A custom property written in terms of another one is substituted where it is
 *  declared, not where it is read: `--code-block-bg-color: var(--surface)` on
 *  the root element resolves against the root's surface and then inherits as a
 *  colour. So a miniature that only overrides `--surface` would still show the
 *  app's code block, not the theme's. Restating the blocks here makes them
 *  resolve against the frame instead.
 *
 *  Only the blocks whose selector is `:root` alone: the two that also name a
 *  scheme are the palettes, and restating those would paint every miniature the
 *  same colour whatever theme it belongs to. */
export function scopedRoots(css: string, scope = `.${FRAME}`): string {
  return [...rules(css)]
    .filter((rule) => rule.prelude === ':root')
    .map((rule) => `${scope} {${rule.body}}`)
    .join('\n')
}

/** The whole of the miniature's stylesheet: the frame it lives in, and the
 *  app's prose rules re-scoped to the page inside it. Built once, and asked for
 *  only when the gallery is first opened - the rules arrive as text, which is
 *  tens of kilobytes nobody who never opens the gallery should have to load. */
export async function miniatureCss(): Promise<string> {
  const { proseCss, tokensCss } = await import('@nib/themes/raw')

  // The app's rules first and the frame's after them, so what the frame says
  // about the page it holds wins. The prose rules are written for a pane with a
  // scrollbar and end in half a screen of empty space below the last line;
  // a miniature is all page and no pane.
  return `${scopedRoots(tokensCss)}

${rescoped(proseCss)}

.${FRAME} {
  position: relative;
  overflow: hidden;
  /* The sample is the same handful of elements on every card, so its height is
     known: the frame is that height, scaled, and every card is the same shape
     without any of them being measured. */
  --mini-page: ${CARD_HEIGHT}px;
  height: calc(var(--mini-page) * var(--mini-scale));
  background: var(--bg);
  color: var(--text);
  contain: strict;
}

.${PAGE} {
  /* Laid out at the width of a real note, then scaled: what the frame shows is
     the shape of the thing rather than a squashed version of it. */
  width: calc(100% / var(--mini-scale));
  height: var(--mini-page);
  max-width: none;
  margin: 0;
  padding: 22px 26px 0;
  transform: scale(var(--mini-scale));
  transform-origin: top left;
  box-sizing: border-box;
  font-family: var(--font-content);
  font-size: var(--text-content);
  line-height: var(--leading-content);
  color: var(--text);
}

.${PAGE} > *:first-child {
  margin-top: 0;
}

/* Pointing at a card that has both schemes shows the other one, and this is
   what makes that a change of light rather than a flicker: the frame's scheme
   attribute is swapped, and every colour in it crosses over. A wildcard, but a
   wildcard inside a frame of eight elements. */
.${FRAME},
.${PAGE},
.${PAGE} * {
  transition:
    background-color var(--dur-slow) var(--ease-in-out),
    border-color var(--dur-slow) var(--ease-in-out),
    color var(--dur-slow) var(--ease-in-out);
}`
}

/** One block per theme and scheme, so a card paints from the index alone.
 *
 *  Two attributes rather than one: the scheme attribute is the app's own, which
 *  means the frame starts with every built-in token for that scheme and the
 *  theme only has to state what it changes. Two attributes also outrank the
 *  app's one, so the theme wins without anything being marked important. */
export function paletteCss(themes: StoreTheme[]): string {
  const block = (id: string, scheme: string, palette: Palette) => {
    const lines = Object.entries(palette).map(([token, value]) => `  ${token}: ${value};`)
    if (!lines.length) return ''

    return `[data-palette='${id}'][data-theme='${scheme}'] {\n${lines.join('\n')}\n}`
  }

  return themes
    .flatMap((theme) => [
      block(theme.id, 'light', theme.palettes.light),
      block(theme.id, 'dark', theme.palettes.dark),
    ])
    .filter(Boolean)
    .join('\n')
}

/** The sample note, as the markup the renderer would have produced.
 *
 *  Short enough on a card that thirty of them are the same handful of elements,
 *  and long enough to show what a theme did to a heading, a link, a list and a
 *  fence. `full` adds the quote and the rule, for the one preview that has room
 *  for them: a card is a taste and a preview is the note. */
export function sampleHtml(full = false): string {
  const sentence = t('Words with {bold} and a {link}.', {
    bold: `<strong>${t('bold')}</strong>`,
    // No `href`: the card is itself a button, and a link inside one is a second
    // thing to tab to and a place to accidentally go. What it is here for is the
    // colour a theme gives a link, which needs no destination.
    link: `<a>${t('link')}</a>`,
  })

  const more = full
    ? `
<blockquote><p>${t('Everything is markdown, and nothing else.')}</p></blockquote>
<hr>`
    : ''

  return `<h2>${t('A note')}</h2>
<p>${sentence}</p>
<ul><li>${t('One thing')}</li><li>${t('Another')}</li></ul>
<pre><code>const ink = 'on glass'</code></pre>${more}`
}
