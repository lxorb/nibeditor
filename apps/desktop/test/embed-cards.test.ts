import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The click-to-load card, on every surface that renders a note.
 *
 *  `![](https://youtube.com/watch?v=…)` renders as a card the size the frame will
 *  be, and the frame arrives when the card is pressed - one piece of markup out of
 *  @nib/markdown, one loader in @nib/editor's web-frame.ts, one set of rules in
 *  packages/themes/src/document.css. Four surfaces show it: the reading view, the
 *  editor's live preview, a canvas card and a slide.
 *
 *  Two of them had neither the rules nor the press. A card on a canvas came out as a
 *  borderless line thirty-seven pixels tall, because every rule was written
 *  `#write .embed-web` and a canvas card is not a document; pressing it loaded
 *  nothing, because nothing on the plane was listening - and once something was, the
 *  press still had to be taken from the plane, which asks to be sent the rest of
 *  every contact that lands on it. A card on a slide turned the slide or sent the
 *  reader out to the page, because the deck read the card's own link before anything
 *  asked whether it was a card.
 *
 *  Read off the source rather than remembered: a surface added later is a surface
 *  that has to answer these too. What each one actually does when pressed is the
 *  drive's - see apps/desktop/test/e2e/editor-gaps.py. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function source(path: string): string {
  return readFileSync(`${ROOT}${path}`, 'utf8')
}

const DOCUMENT_CSS = source('packages/themes/src/document.css')
const CANVAS_NODE = source('apps/desktop/src/lib/CanvasNode.svelte')
const SLIDES = source('apps/desktop/src/lib/Slides.svelte')
const READING = source('apps/desktop/src/lib/Reading.svelte')
const WEB_WIDGET = source('packages/editor/src/live-preview/web.ts')

/** Every selector in the sheet that dresses part of a web card. */
function cardSelectors(): string[] {
  return [...DOCUMENT_CSS.matchAll(/^([^{}\n][^{}]*)\{/gm)]
    .map((one) => (one[1] ?? '').trim())
    .filter((one) => /\.embed-(web|wide|play|frame)\b/.test(one))
}

describe('the rules a web card is drawn with', () => {
  test('are found by the scan', () => {
    expect(cardSelectors().length).toBeGreaterThanOrEqual(5)
  })

  /** A canvas card is rendered markdown and is not a document, so it carries
   *  `.nib-rendered`; `:is(#write, .nib-rendered)` is the same specificity as
   *  `#write` alone, so nothing about which rule wins changes. */
  test('reach a canvas card as well as a document', () => {
    for (const selector of cardSelectors()) {
      expect(selector, selector).toContain(':is(#write, .nib-rendered)')
      expect(selector, selector).not.toMatch(/(^|[^,(])\s*#write\s+\./)
    }
  })

  test('and the canvas card says so on every rendered card it draws', () => {
    const rendered = [...CANVAS_NODE.matchAll(/<div class="card page[^"]*"/g)].map((one) => one[0])

    expect(rendered.length).toBeGreaterThanOrEqual(3)
    for (const one of rendered) expect(one, one).toContain('nib-rendered')
  })
})

describe('the press that loads the frame', () => {
  test('is the one loader in @nib/editor, on all four surfaces', () => {
    // The editor's live preview, through the widget that draws the card.
    expect(WEB_WIDGET).toContain('embedClicks')
    // A canvas card, on the card itself, so the surface's gestures are untouched.
    expect(CANVAS_NODE).toContain('embedClicks')
    expect(CANVAS_NODE).toContain('use:embeds')
    // The reading view and a deck, each inside the click it already reads.
    expect(READING).toContain('loadEmbed')
    expect(SLIDES).toContain('loadEmbed')
  })

  /** A card is an `<a>` to the page itself, for a published deck that runs no
   *  script. In the app that link must never be followed: the frame arrives in
   *  place instead, so the check has to come before the deck reads an anchor. */
  test('is asked before a deck reads the card as a link or turns the slide', () => {
    const press = SLIDES.indexOf('loadEmbed')
    const anchor = SLIDES.indexOf("closest('a')")
    const turn = SLIDES.indexOf('else onwards()')

    expect(press).toBeGreaterThan(-1)
    expect(press).toBeLessThan(anchor)
    expect(press).toBeLessThan(turn)
  })
})
