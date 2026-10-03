// @vitest-environment jsdom
/** The clip's reader, the page's half of a clip, run over the extractor's own saved pages
 *  in a page of their own - and what it wrote down read back the way the window reads it.
 *
 *  The script is the very file the crate runs (`src-tauri/src/web_tabs/reader.js`), with
 *  the two words filled in the way `web_tabs::reader` fills them. What it hands over has
 *  to come out of the extractor as exactly what the extractor makes of the live page,
 *  because that is what the clipper extension clips: one page, one note, whichever of the
 *  two clipped it. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extract, readSnapshot } from '@nib/markdown/article'
import { frontMatterValue } from '@nib/markdown/front-matter'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { articleOf, clipNote } from './note'

const READER = readFileSync(
  join(import.meta.dirname, '../../../src-tauri/src/web_tabs/reader.js'),
  'utf8',
)
const FIXTURES = join(import.meta.dirname, '../../../../../packages/markdown/src/fixtures')

const PAGES: [string, string][] = [
  ['news.html', 'https://ledger.example/news/2026/lake.html'],
  ['docs.html', 'https://rivulet.example/docs/streams.html'],
  ['wikipedia.html', 'https://en.wikipedia.example/wiki/Euler%27s_identity'],
  ['tables.html', 'https://rails.example/guides/night-trains'],
]

interface Clipped {
  url: string
  title: string
  html: string
}

function pageOf(name: string, url: string): JSDOM {
  const html = readFileSync(join(FIXTURES, name), 'utf8')
  return new JSDOM(html, { url, runScripts: 'outside-only' })
}

/** What the reader answers on that page, asked for the selection or not. */
function read(page: JSDOM, selection: boolean, longest = 4_000_000): Clipped {
  const script = READER.replace('__SELECTION__', selection ? 'yes' : 'no').replace(
    '__LONGEST__',
    String(longest),
  )
  return page.window.eval(script) as Clipped
}

describe('a page written down and read back', () => {
  for (const [name, url] of PAGES) {
    test(`${name} is the article the extension clips from the live page`, () => {
      const page = pageOf(name, url)
      const answered = read(page, false)

      expect(answered.url).toBe(url)
      expect(answered.html.startsWith('<!DOCTYPE html>')).toBe(true)
      expect(readSnapshot(answered.html, url)).toEqual(
        extract(pageOf(name, url).window.document, 'page', url),
      )
    })
  }

  test('leaves the page itself as it was', () => {
    const page = pageOf('news.html', PAGES[0][1])
    const before = page.serialize()
    read(page, true)

    expect(page.serialize()).toBe(before)
  })

  test('writes no script, no style and no stylesheet down', () => {
    const answered = read(pageOf('news.html', PAGES[0][1]), false)

    expect(answered.html).not.toMatch(/<script|<style|<link/i)
  })
})

describe('what is selected', () => {
  function selectedIn(page: JSDOM, selector: string): void {
    const range = page.window.document.createRange()
    range.selectNodeContents(page.window.document.querySelector(selector)!)
    page.window.getSelection()!.addRange(range)
  }

  test('wins over the article when asked for, under the page’s own title and tags', async () => {
    const [name, url] = PAGES[1]
    const page = pageOf(name, url)
    selectedIn(page, 'pre')
    const answered = read(page, true)

    const article = await articleOf(answered)
    expect(article.kind).toBe('selection')
    expect(article.title).toBe('Streams — Rivulet 3.2 documentation')
    expect(article.tags).toEqual(['streams', 'async', 'rivulet'])
    expect(article.html).toContain("import { from } from 'rivulet'")
    expect(article.html).not.toContain('A stream is a value')
  })

  test('is not the clip when it was not asked for', async () => {
    const [name, url] = PAGES[1]
    const page = pageOf(name, url)
    selectedIn(page, 'pre')

    expect((await articleOf(read(page, false))).kind).toBe('page')
  })
})

describe('a field', () => {
  test('is written down without what it holds, and a password field not at all', () => {
    const page = new JSDOM(
      '<!doctype html><body><article><p>Words.</p><input name="q" value="secret words"><input type="password" value="hunter2"></article></body>',
      { url: 'https://a.example/', runScripts: 'outside-only' },
    )
    const answered = read(page, false)

    expect(answered.html).not.toContain('secret words')
    expect(answered.html).not.toContain('hunter2')
    expect(answered.html).not.toContain('type="password"')
  })
})

describe('the note a tab’s clip is', () => {
  test('is the clipper’s shape, with the article’s own title and the page’s tags', async () => {
    const [name, url] = PAGES[0]
    const note = await clipNote(read(pageOf(name, url), false), new Date('2026-10-03T08:00:00Z'))

    expect(frontMatterValue(note, 'source')).toBe(url)
    expect(frontMatterValue(note, 'title')).toBe('Lake Zurich warms a full degree in a decade')
    expect(frontMatterValue(note, 'clipped')).toBe('2026-10-03T08:00:00.000Z')
    expect(note).toContain('tags: [Climate, Zurich, Lakes]')
    expect(note.match(/^# /gm)).toHaveLength(1)
    expect(note).toContain('the cantonal water office said on Friday')
    expect(note).not.toContain('We use cookies')
  })

  test('stops at the longest page it may read rather than failing', async () => {
    const [name, url] = PAGES[0]
    const answered = read(pageOf(name, url), false, 1000)

    expect(answered.html.length).toBe(1000)
    expect(await clipNote(answered, new Date())).toContain(`source: ${url}`)
  })
})
