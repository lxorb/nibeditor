// @vitest-environment jsdom
/** The extractor over four saved pages, the kinds clipped most: a news article, a page of
 *  documentation with code in three languages, a Wikipedia article with maths, and a
 *  page whose point is a table.
 *
 *  Each goes through `extract` as the clipper extension hands it a live page, and
 *  through `readSnapshot` as a web tab hands it the page written down, and the two must
 *  agree to the character - that is what "the same page clips to the same note from
 *  both" comes to. What is checked beyond that is the markdown, because that is what
 *  lands in the note. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { extract, readSnapshot } from './article'
import { htmlToMarkdown } from './from-html'

function pageOf(name: string, url: string): Document {
  const html = readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
  return new JSDOM(html, { url }).window.document
}

/** The page written down the way a tab's reader writes it, minus the selection: the
 *  doctype, the base resolved, and the rest as it stands. The reader itself is the
 *  app's, and the app's test runs the real one over these same pages. */
function snapshotOf(page: Document): string {
  const copy = page.documentElement.cloneNode(true) as HTMLElement
  const base = page.createElement('base')
  base.setAttribute('href', page.baseURI)
  copy.querySelector('head')?.prepend(base)
  return `<!DOCTYPE html>${copy.outerHTML}`
}

function both(name: string, url: string) {
  const page = pageOf(name, url)
  const live = extract(page, 'page', url)
  const written = readSnapshot(snapshotOf(page), url)
  return { live, written, markdown: htmlToMarkdown(live.html) }
}

describe('a news article', () => {
  const url = 'https://ledger.example/news/2026/lake.html'
  const { live, written, markdown } = both('news.html', url)

  test('reads the same live and written down', () => {
    expect(written).toEqual(live)
  })

  test('is called what the article says, without the site', () => {
    expect(live.title).toBe('Lake Zurich warms a full degree in a decade')
  })

  test('carries the tags the page published', () => {
    expect(live.tags).toEqual(['Climate', 'Zurich', 'Lakes'])
  })

  test('keeps the article and leaves the furniture', () => {
    expect(markdown).toContain('the cantonal water office said on Friday')
    expect(markdown).toContain('"A lake does not forget a warm winter,"')
    for (const furniture of ['We use cookies', 'Subscribe', 'Privacy', 'console.log']) {
      expect(markdown).not.toContain(furniture)
    }
  })

  test('keeps the photograph a lazy picture deferred, at its widest', () => {
    expect(markdown).toMatch(/!\[The lake at dawn\]\(https:\/\/ledger\.example\/img\/lake-/)
    expect(markdown).not.toContain('data:image/gif')
  })

  test('resolves a link that climbs out of the page’s folder', () => {
    expect(markdown).toContain('[plant shade trees](https://ledger.example/news/plans/shade.html)')
  })
})

describe('a page of documentation', () => {
  const url = 'https://rivulet.example/docs/streams.html'
  const { live, written, markdown } = both('docs.html', url)

  test('reads the same live and written down', () => {
    expect(written).toEqual(live)
  })

  test('fences each block with the language its page named, however it named it', () => {
    expect(markdown).toContain("```ts\nimport { from } from 'rivulet'")
    expect(markdown).toContain('```python\nfrom rivulet import stream')
    expect(markdown).toContain('```sh\n$ rivulet run --slow-reader example.ts')
  })

  test('keeps code as it was written', () => {
    expect(markdown).toContain('.map((n) => n * 2)')
    expect(markdown).toContain('`map`, `filter` and `take`')
  })

  test('leaves the sidebar and the footer behind', () => {
    expect(markdown).not.toContain('Getting started')
    expect(markdown).not.toContain('Edit on GitHub')
  })
})

describe('Wikipedia, with maths', () => {
  const url = 'https://en.wikipedia.example/wiki/Euler%27s_identity'
  const { live, written, markdown } = both('wikipedia.html', url)

  test('reads the same live and written down', () => {
    expect(written).toEqual(live)
  })

  test('keeps a formula as the TeX it was written in, once', () => {
    expect(markdown).toContain('e^{i\\pi }+1=0')
    expect(markdown.split('e^{i\\pi }+1=0').length).toBe(2)
    expect(markdown).not.toContain('render/svg')
  })

  test('keeps an inline formula inline', () => {
    expect(markdown).toMatch(/where \$\{?\\displaystyle e\}?\$ is/)
  })

  test('leaves the navigation and the edit links behind', () => {
    expect(markdown).not.toContain('Random article')
    expect(markdown).not.toContain('action=edit')
  })
})

describe('a page whose point is a table', () => {
  const url = 'https://rails.example/guides/night-trains'
  const { live, written, markdown } = both('tables.html', url)

  test('reads the same live and written down', () => {
    expect(written).toEqual(live)
  })

  test('keeps the table as a table', () => {
    expect(markdown).toMatch(/\| Destination \| Leaves \| Arrives \| Couchette from \|/)
    expect(markdown).toContain(
      '| [Hamburg](https://rails.example/trains/hamburg) | 19:59 | 08:09 |',
    )
  })

  test('escapes a pipe a cell holds, so the row stays one row', () => {
    expect(markdown).toContain('CHF 99 \\| sleeper only')
  })
})
