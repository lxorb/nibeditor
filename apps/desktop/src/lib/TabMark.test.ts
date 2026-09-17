import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render } from 'svelte/server'
import type { TabKind } from './workspace/documents.svelte'

/** The mark an open tab wears, drawn.
 *
 *  One sentence holds the whole file together: a file wears one mark, and which
 *  surface is drawing it does not come into it. So every kind is drawn here with an
 *  icon chosen on its path and every kind has to wear it - the same icon the row in
 *  the file list wears, out of the same reader - and every kind has to fall back to
 *  its own drawing where nothing was chosen. It was the other way around until Emil
 *  asked: "for all note types, the tab icon and the explorer icon should always be
 *  the same".
 *
 *  A website is the one tab whose mark is not about the file at all, because which
 *  site it is on is the interesting fact and every browser has drawn it for thirty
 *  years. Three states, and all three are here: the site's own picture, the globe for
 *  a site that has none, and the turn while the page is on its way.
 *
 *  Where the icon a file chose comes from is chosen-icon.ts's business and this
 *  component's not, so the reader is stood in for the way FileMark.test.ts stands it
 *  in. */

const chosen: Record<string, string | null> = {}
const marks: Record<string, string | null> = {}

vi.mock('./chosen-icon', () => ({
  chosenIcon: (path: string) => chosen[path] ?? null,
  chosenTint: () => null,
  faviconFor: (path: string) => marks[path] ?? null,
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { loadIcons } = await import('./icons')
const { MARKS } = await import('./file-mark')
const { GRAPH_MARK } = await import('./panel-marks')
const { NoteDoc, Tab } = await import('./workspace/documents.svelte')
const { pages } = await import('./web-tab/pages.svelte')
const { writeShortcut } = await import('./web-tab/shortcut')
const TabMark = (await import('./TabMark.svelte')).default

/** The stroked set, in place before anything is drawn: in the app it arrives a moment
 *  after the first paint and the marks redraw themselves, and there is no moment to
 *  wait for here. */
iconLibrary.set = await loadIcons()

/** The `d` of every stroke a drawing is made of, which is what tells two of them
 *  apart in the markup. */
function strokes(icon: readonly (readonly [string, Record<string, unknown>])[]): string[] {
  return icon.flatMap(([, attrs]) => (typeof attrs.d === 'string' ? [attrs.d] : []))
}

const rocket = strokes(iconLibrary.shape('rocket') ?? [])

/** A tab holding one document, built the way the workspace builds one. */
function tabFor(kind: TabKind, path: string | null, text = ''): InstanceType<typeof Tab> {
  const doc = new NoteDoc(
    { kind, path, name: path?.split('/').at(-1) ?? 'Untitled', text, dirty: false },
    () => undefined,
    () => true,
  )

  return new Tab(doc, 'pane')
}

function drawn(tab: InstanceType<typeof Tab>): string {
  return render(TabMark, { props: { tab } }).body
}

const SITE = 'https://svelte.dev/docs'
const FAVICON = 'https://svelte.dev/favicon.png'
/** The same mark as the row draws it: out of the index rather than out of the copy of
 *  the file this window is holding. */
const FOUND = 'https://svelte.dev/found.png'

/** A website as its file: the shortcut the app writes, so the key the favicon is kept
 *  under is the writer's own rather than a string spelled twice. */
function shortcut(icon: string | null): string {
  return writeShortcut(SITE, 'Svelte docs', new Date('2026-09-13T08:00:00.000Z'), null, icon)
}

describe('a tab wearing the mark of what it holds', () => {
  test('a note that chose an icon wears it, the way its row does', () => {
    chosen['Plan.md'] = 'rocket'
    const body = drawn(tabFor('note', 'Plan.md', '# Plan'))

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.note)[0])
  })

  /** The same rule for the three other kinds that keep an icon of their own: a canvas
   *  and a page note say it under `nib.icon`, a folder note in its front matter. */
  test('and so do the canvas, the page note and the PDF', () => {
    for (const [kind, path] of [
      ['canvas', 'Board.canvas'],
      ['pages', 'Lecture.pages'],
      ['pdf', 'Paper.pdf'],
    ] as const) {
      chosen[path] = 'rocket'
      const body = drawn(tabFor(kind, path))

      for (const stroke of rocket) expect(body, kind).toContain(stroke)
      expect(body, kind).not.toContain(strokes(MARKS[kind])[0])
    }
  })

  /** Which is what the kinds are for: nobody dresses every note, and a strip of
   *  undressed ones still says which window is the plane and which is the paper. */
  test('and a file that chose nothing wears its kind s own drawing', () => {
    for (const [kind, path] of [
      ['note', 'Bare.md'],
      ['canvas', 'Bare.canvas'],
      ['pages', 'Bare.pages'],
      ['pdf', 'Bare.pdf'],
    ] as const) {
      const body = drawn(tabFor(kind, path))

      for (const stroke of strokes(MARKS[kind])) expect(body, kind).toContain(stroke)
      for (const stroke of rocket) expect(body, kind).not.toContain(stroke)
    }
  })

  /** A note nobody has saved has no file to have chosen anything in, and asking
   *  after an icon by a path it has not got would be asking about the empty string. */
  test('and a note with no file yet wears the page with writing on it', () => {
    chosen[''] = 'rocket'
    const body = drawn(tabFor('note', null, '# draft'))

    for (const stroke of strokes(MARKS.note)) expect(body).toContain(stroke)
    for (const stroke of rocket) expect(body).not.toContain(stroke)
  })

  /** The one tab that is not a file, so there is no kind's mark for it to wear: the
   *  picture the panel that opens the graph and a bookmarked view of it already draw.
   *  It used to wear nothing at all, which left one tab in the strip whose name began
   *  where no other name did. */
  test('and the graph is the space s own picture', () => {
    expect(drawn(tabFor('graph', null))).toContain(GRAPH_MARK)
  })
})

describe('a tab holding a website', () => {
  test('wears the site s own picture, out of the file, before any page has loaded', () => {
    const body = drawn(tabFor('web', 'Svelte docs.url', shortcut(FAVICON)))

    expect(body).toContain(`src="${FAVICON}"`)
    // And not the globe as well: one mark per tab.
    for (const stroke of strokes(MARKS.web)) expect(body).not.toContain(stroke)
  })

  test('and the globe where neither the file nor the page has one', () => {
    const body = drawn(tabFor('web', 'Svelte docs.url', shortcut(null)))

    for (const stroke of strokes(MARKS.web)) expect(body).toContain(stroke)
    expect(body).not.toContain('<img')
  })

  /** And where the file this window holds says nothing, what the row says: the tab
   *  falls through to the same component the file list draws, so a mark that reached
   *  the index without reaching this tab's copy of the file still lands in the strip.
   *  One chain, ending at the globe. */
  test('and what the row draws for it where this window s own file says nothing', () => {
    marks['Elsewhere.url'] = FOUND
    const body = drawn(tabFor('web', 'Elsewhere.url', shortcut(null)))

    expect(body).toContain(`src="${FOUND}"`)
    for (const stroke of strokes(MARKS.web)) expect(body).not.toContain(stroke)
  })

  /** What a browser does with this box while a page is coming, and the reason the box
   *  is worth having: the reader can see which of six tabs is still loading. */
  test('and turns instead of either while the page is on its way', () => {
    const tab = tabFor('web', 'Svelte docs.url', shortcut(FAVICON))
    pages.of(tab.id).loading = true

    const body = drawn(tab)
    expect(body).toContain('turning')
    expect(body).not.toContain('<img')
  })

  /** The turn is the page's, not the tab's. A note has no page to be loading, and the
   *  mark it wears must not depend on what some other tab's page is doing. */
  test('while a note is its page whatever any page is doing', () => {
    const tab = tabFor('note', 'Bare.md', '# Plan')
    pages.of(tab.id).loading = true

    const body = drawn(tab)
    expect(body).not.toContain('turning')
    for (const stroke of strokes(MARKS.note)) expect(body).toContain(stroke)
  })
})

/** A strip of every kind at once reads as a strip only if all of them are drawn in the
 *  same box. Most are `FileMark.svelte`, which owns that box; the favicon, the graph
 *  and the turn this component draws itself have to be the same box, and that is a
 *  number said in two files. The pixels themselves are measured in
 *  apps/desktop/test/e2e/tab-icons.py. */
describe('one box for every kind', () => {
  const source = readFileSync(fileURLToPath(new URL('./TabMark.svelte', import.meta.url)), 'utf8')
  const mark = readFileSync(fileURLToPath(new URL('./FileMark.svelte', import.meta.url)), 'utf8')

  test('is the box the file list draws a mark in', () => {
    for (const rule of ['width: var(--icon-md)', 'height: var(--icon-md)']) {
      expect(mark).toContain(rule)
      expect(source).toContain(rule)
    }
  })

  /** A stroke is in the units of the grid it was drawn on, so the same number on two
   *  grids is two weights. The graph comes off the panel's 13 and the rest off
   *  Lucide's 24, and the sum is written out rather than resolved so that neither can
   *  drift away from the other. */
  test('and one weight, across the two grids the marks are drawn on', () => {
    expect(mark).toContain('stroke-width: 1.6')
    expect(source).toContain('stroke-width: 1.6')
    expect(source).toContain('stroke-width: calc(1.6 * 13 / 24)')
  })

  /** The app's one answer to somebody who has asked for less movement, which the bar
   *  over the page gives in the same words. */
  test('and the turn stops where movement is not wanted', () => {
    const style = source.slice(source.indexOf('<style>'))
    expect(style).toContain('@media (prefers-reduced-motion: reduce)')
    expect(style).toMatch(/prefers-reduced-motion[\s\S]{0,200}animation: none/)
  })
})
