import { describe, expect, test } from 'vitest'
import { frontMatterValue } from '@nib/markdown/front-matter'
import { clipNote, clipSource, keptBody, webTitleOf, webUrlOf } from './note'

const WHEN = new Date('2026-09-12T08:30:00.000Z')

/** What the old writer wrote: front matter, the title as a heading, and the address
 *  again as a link. Kept here as a string because nothing writes one any more - a
 *  website is a shortcut file now - and what is left is the reading of the ones that
 *  are already in people's spaces. */
const WAS = `---
url: https://svelte.dev/docs
title: Svelte docs
date: 2026-09-12T08:30:00.000Z
---

# Svelte docs

<https://svelte.dev/docs>
`

describe('which notes are websites', () => {
  test('a note the old writer wrote reads back', () => {
    expect(webUrlOf(WAS)).toBe('https://svelte.dev/docs')
    expect(webTitleOf(WAS)).toBe('Svelte docs')
  })

  test('a note with no url is prose', () => {
    expect(webUrlOf('# Idea\n\nSome words.\n')).toBeNull()
    expect(webUrlOf('---\ntitle: Idea\n---\n\n# Idea\n')).toBeNull()
    expect(webUrlOf(null)).toBeNull()
  })

  /** A note can arrive from a shared space, a room or somebody's export, so the key
   *  is judged and not only read. */
  test('an address no tab may open is not a website', () => {
    expect(webUrlOf('---\nurl: javascript:alert(1)\n---\n')).toBeNull()
    expect(webUrlOf('---\nurl: file:///etc/passwd\n---\n')).toBeNull()
    expect(webUrlOf('---\nurl: not an address\n---\n')).toBeNull()
  })

  test('a title nobody wrote is no title', () => {
    expect(webTitleOf('---\nurl: https://a.example/\ntitle:\n---\n')).toBeNull()
    expect(webTitleOf('# Idea\n')).toBeNull()
  })
})

/** Awaited, because the converter that turns a page into markdown is fetched when a
 *  page is clipped rather than when the window opens; see note.ts. */
describe('the note a clip is', () => {
  test('says where it came from and when, and holds the page as markdown', async () => {
    const note = await clipNote(
      {
        url: 'https://example.com/post',
        title: 'A post',
        html: '<h2>A heading</h2><p>Some <strong>words</strong>.</p>',
      },
      WHEN,
    )

    expect(frontMatterValue(note, 'source')).toBe('https://example.com/post')
    expect(frontMatterValue(note, 'title')).toBe('A post')
    expect(frontMatterValue(note, 'date')).toBe('2026-09-12T08:30:00.000Z')
    expect(note).toContain('\n# A post\n')
    expect(note).toContain('## A heading')
    expect(note).toContain('Some **words**.')
  })

  /** A browser build cannot read the frame's document, so a clip there is the link,
   *  which is what the glyph said it would be. */
  test('a page with no words to keep says the one thing it knows', async () => {
    const note = await clipNote(
      { url: 'https://example.com/post', title: 'A post', html: '' },
      WHEN,
    )
    expect(note).toContain('<https://example.com/post>')
  })

  test('a page with no title at all is still a note', async () => {
    const note = await clipNote({ url: 'https://example.com/post', title: '', html: '' }, WHEN)
    expect(frontMatterValue(note, 'title')).toBe('Untitled')
    expect(note).toContain('\n# Untitled\n')
  })

  /** A page names itself, and the name becomes the note's heading: a note of the
   *  reader's own has its markup rendered, so a title cannot carry a tag. */
  test('a title that names a tag says the words rather than the tag', async () => {
    const note = await clipNote(
      {
        url: 'https://example.com/a',
        title: 'Fine <img src=x onerror=alert(1)>',
        html: '<p>x</p>',
      },
      WHEN,
    )

    expect(note).toContain('# Fine \\<img src=x onerror=alert(1)>')
    expect(note).not.toContain('# Fine <img')
  })

  test('a title that is a paragraph is cut to a line', async () => {
    const note = await clipNote(
      { url: 'https://example.com/a', title: 'One\nTwo', html: '<p>x</p>' },
      WHEN,
    )
    expect(frontMatterValue(note, 'title')).toBe('One Two')
  })
})

/** A tab that has no page yet - the address field still empty, which is what "Open a
 *  website" opens on - has no address to have come from. Clipping it wrote a note whose
 *  `source:` was empty and whose whole body was `<>`; the audit found one called
 *  `Second page.md`. */
describe('a tab with no address is not a clip', () => {
  test('refuses a blank address rather than writing an empty source', () => {
    expect(clipSource('', null)).toBeNull()
    expect(clipSource(null, null)).toBeNull()
    expect(clipSource(undefined, '')).toBeNull()
    expect(clipSource('   ', null)).toBeNull()
  })

  /** The same judgement the tab itself is held to, so a clip cannot come from
   *  somewhere the tab would never have opened. */
  test('and anything that is not the web', () => {
    expect(clipSource('javascript:alert(1)', null)).toBeNull()
    expect(clipSource('file:///C:/notes/Idea.md', null)).toBeNull()
    expect(clipSource('http://tauri.localhost/index.html', null)).toBeNull()
  })

  test('while a page that has an address clips from it, read first', () => {
    expect(clipSource('https://a.example/read', 'https://a.example/tab')).toBe(
      'https://a.example/read',
    )
    expect(clipSource('', 'https://a.example/tab')).toBe('https://a.example/tab')
    expect(clipSource(null, 'https://a.example/tab')).toBe('https://a.example/tab')
  })
})

/** A clip carried its title twice: the heading this file writes above the words, and
 *  the article's own `h1`, which the converter keeps because it is part of the page. */
describe('the heading a clip wears', () => {
  test('is written once when the article opens with the same heading', async () => {
    const note = await clipNote(
      {
        url: 'https://example.com/post',
        title: 'What runes are',
        html: '<h1>What runes are</h1><p>They are signals.</p>',
      },
      WHEN,
    )

    expect(note.match(/^# /gm)?.length).toBe(1)
    expect(note).toContain('# What runes are')
    expect(note).toContain('They are signals.')
  })

  /** A page whose article says something else keeps both: the note is still titled
   *  after the page, and the article's own heading is the article's. */
  test('and twice when the article says something else', async () => {
    const note = await clipNote(
      {
        url: 'https://example.com/post',
        title: 'What runes are',
        html: '<h1>Signals, actually</h1><p>Words.</p>',
      },
      WHEN,
    )

    expect(note.match(/^# /gm)?.length).toBe(2)
    expect(note).toContain('# What runes are')
    expect(note).toContain('# Signals, actually')
  })
})

describe('what a converted note leaves behind', () => {
  test('nothing, when the note said only that it was a website', () => {
    expect(keptBody(WAS)).toBeNull()
  })

  test('and nothing for one whose body somebody emptied', () => {
    expect(keptBody('---\nurl: https://a.example/\n---\n\n')).toBeNull()
  })

  /** Somebody wrote in it. That is a note, and it stays one - without the line that
   *  made it a website, because the shortcut written beside it is what that line
   *  means now. */
  test('the note itself, when somebody had written in it', () => {
    const said = keptBody(`${WAS}
Why this page is worth keeping.
`)
    expect(said).not.toBeNull()
    expect(said).toContain('Why this page is worth keeping.')
    expect(said).toContain('title: Svelte docs')
    expect(webUrlOf(said)).toBeNull()
  })

  test('and the words, where the note had no front matter left to keep', () => {
    const said = keptBody('---\nurl: https://a.example/\n---\n\nJust words.\n')
    expect(said).toBe('Just words.\n')
  })
})
