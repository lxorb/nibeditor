import { describe, expect, test } from 'vitest'
import type { Origin } from '@nib/markdown/article'
import {
  byteLength,
  fileName,
  fits,
  frontMatter,
  interpreted,
  MAX_NOTE_BYTES,
  noteFor,
} from './note'

const AT = new Date('2026-03-04T09:12:00Z')

function origin(over: Partial<Origin> = {}): Origin {
  return {
    kind: 'page',
    url: 'https://site.example/a',
    title: 'A title',
    tags: [],
    ...over,
  }
}

describe('front matter', () => {
  test('says where, what, when and about what', () => {
    expect(frontMatter(origin({ tags: ['one', 'two'] }), AT)).toBe(
      [
        '---',
        'source: https://site.example/a',
        'title: A title',
        'clipped: 2026-03-04T09:12:00.000Z',
        'tags: [one, two]',
        '---',
      ].join('\n'),
    )
  })

  test('states an empty tag list rather than leaving the field out', () => {
    expect(frontMatter(origin(), AT)).toContain('tags: []')
  })

  test('quotes a title whose colon would open a mapping', () => {
    expect(frontMatter(origin({ title: 'Rust 1.0: a retrospective' }), AT)).toContain(
      "title: 'Rust 1.0: a retrospective'",
    )
  })

  test('quotes a title whose hash would open a comment', () => {
    expect(frontMatter(origin({ title: 'Sprint 4 #done' }), AT)).toContain(
      "title: 'Sprint 4 #done'",
    )
  })

  test('quotes a title that starts with something YAML reads as syntax', () => {
    expect(frontMatter(origin({ title: '- not a list' }), AT)).toContain("title: '- not a list'")
    expect(frontMatter(origin({ title: '"quoted"' }), AT)).toContain(`title: '"quoted"'`)
  })

  // Doubling the apostrophe is YAML, but the app's own front matter reader takes
  // quotes off a value without undoubling anything inside them, so a clipped
  // article read `It''s: here` in its own properties row. Double quotes say the
  // same thing to Obsidian and to that reader.
  test('quotes a title with an apostrophe in the quotes that need no escape', () => {
    expect(frontMatter(origin({ title: "It's: here" }), AT)).toContain(`title: "It's: here"`)
  })

  test('leaves an ordinary address unquoted, colons and all', () => {
    expect(frontMatter(origin({ url: 'https://site.example/a?b=1#c' }), AT)).toContain(
      'source: https://site.example/a?b=1#c',
    )
  })

  test('quotes a tag that would break the list', () => {
    expect(frontMatter(origin({ tags: ['a, b'] }), AT)).toContain("tags: ['a, b']")
  })

  // A page names itself in `og:title`, and a page may put anything at all in
  // there. Without this the block ends where the page said it did and the rest
  // of what it wrote lands in the note as markdown of its own choosing.
  test('cannot be ended early by a title with lines in it', () => {
    const block = frontMatter(origin({ title: 'Fine\n---\n\n<img src=x onerror=alert(1)>' }), AT)

    expect(block.split('\n').filter((line) => line === '---')).toHaveLength(2)
    expect(block).toContain('title: Fine --- <img src=x onerror=alert(1)>')
  })

  test('keeps a tag on its own line too', () => {
    expect(frontMatter(origin({ tags: ['one\n---\ntwo'] }), AT)).toContain('tags: [one --- two]')
  })

  test('states an address as one line, whatever arrived', () => {
    const block = frontMatter(origin({ url: 'https://site.example/a\nclipped: never' }), AT)
    expect(block.split('\n').filter((line) => line.startsWith('clipped:'))).toHaveLength(1)
  })
})

describe('the file a clip wants to be', () => {
  test('is the title with an extension', () => {
    expect(fileName('A title')).toBe('A title.md')
  })

  test('replaces what a filesystem refuses', () => {
    expect(fileName('Rust 1.0: a/b "c" <d>')).toBe('Rust 1.0 a b c d.md')
  })

  test('keeps a hyphen, which a filesystem does not mind', () => {
    expect(fileName('Well-being at work')).toBe('Well-being at work.md')
  })

  test('is one line', () => {
    expect(fileName('Two\nlines')).toBe('Two lines.md')
  })

  test('never ends in a dot or a space', () => {
    expect(fileName('  Trailing.  ')).toBe('Trailing.md')
  })

  test('stops at sixty characters', () => {
    const long = 'a'.repeat(200)
    expect(fileName(long)).toBe(`${'a'.repeat(60)}.md`)
  })

  test('falls back to a name rather than an extension on its own', () => {
    expect(fileName('')).toBe('Untitled.md')
    expect(fileName('///')).toBe('Untitled.md')
  })
})

describe('the note itself', () => {
  test('is front matter, then the title, then the article', () => {
    expect(noteFor(origin(), 'The body.', AT)).toBe(
      [
        '---',
        'source: https://site.example/a',
        'title: A title',
        'clipped: 2026-03-04T09:12:00.000Z',
        'tags: []',
        '---',
        '',
        '# A title',
        '',
        'The body.',
        '',
      ].join('\n'),
    )
  })

  test('states the title once when the article opened with it too', () => {
    const note = noteFor(origin(), '# A title\n\nThe body.', AT)

    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
    expect(note).toContain('# A title\n\nThe body.')
  })

  test('sees through the escaping the converter added to that heading', () => {
    const note = noteFor(origin({ title: '1. Beginnings' }), '# 1\\. Beginnings\n\nThe body.', AT)
    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
  })

  test('keeps a heading that is not the title', () => {
    const note = noteFor(origin(), '# Something else\n\nThe body.', AT)
    expect([...note.matchAll(/^# /gm)]).toHaveLength(2)
  })

  test('says the address and nothing else for a clipped link', () => {
    const note = noteFor(origin({ kind: 'link' }), '', AT)
    expect(note).toContain('# A title\n\n<https://site.example/a>\n')
  })

  test('calls a note with no title at all Untitled', () => {
    expect(noteFor(origin({ title: '   ' }), 'body', AT)).toContain('# Untitled')
  })

  test('has one heading and one front matter block however the title is written', () => {
    const note = noteFor(
      origin({ title: 'Fine\n---\n\n<img src=x onerror=alert(1)>\n\n# Something else' }),
      'The body.',
      AT,
    )

    expect(note.split('\n').filter((line) => line === '---')).toHaveLength(2)
    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
    expect(note.endsWith('The body.\n')).toBe(true)
    // And the heading is the page's words rather than the page's markup: a note of
    // the reader's own has its HTML rendered.
    expect(note).toContain('# Fine --- \\<img src=x onerror=alert(1)>')
  })

  test('shortens a title a page wrote a paragraph into', () => {
    const note = noteFor(origin({ title: 'a'.repeat(500) }), 'body', AT)
    expect(note).toContain(`# ${'a'.repeat(300)}\n`)
  })
})

describe('what the interpreter filled in', () => {
  const filled = [
    { key: 'author', value: 'A. Writer' },
    { key: 'published', value: '2026-02-01' },
    { key: 'tags', value: ['rust', 'compilers'] },
  ]

  test('comes under the four the clip always writes, in the order it was asked for', () => {
    // The pairing the note is written with: the origin folded, then the block
    // written from it and the rest of the properties.
    expect(frontMatter(interpreted(origin(), filled), AT, filled).split('\n')).toEqual([
      '---',
      'source: https://site.example/a',
      'title: A title',
      'clipped: 2026-03-04T09:12:00.000Z',
      'tags: [rust, compilers]',
      'author: A. Writer',
      'published: 2026-02-01',
      '---',
    ])
  })

  test('writes a list as the flow sequence tags are written as', () => {
    expect(frontMatter(origin(), AT, [{ key: 'authors', value: ['A', 'B'] }])).toContain(
      'authors: [A, B]',
    )
  })

  test('joins the tags it found to the ones the page published, each once', () => {
    const one = interpreted(origin({ tags: ['rust', 'systems'] }), filled)

    expect(one.tags).toEqual(['rust', 'systems', 'compilers'])
  })

  test('stops the tags well short of a line nobody reads', () => {
    const page = origin({ tags: Array.from({ length: 8 }, (_, at) => `p${at}`) })
    const many = [{ key: 'tags', value: Array.from({ length: 8 }, (_, at) => `m${at}`) }]

    expect(interpreted(page, many).tags).toHaveLength(12)
  })

  test('becomes the title of the note where it filled one in, everywhere at once', () => {
    const one = [{ key: 'title', value: 'The real headline' }]
    const note = noteFor(origin({ title: 'The real headline | Site' }), 'The body.', AT, one)

    expect(note).toContain('title: The real headline\n')
    expect(note).toContain('# The real headline\n')
    expect(interpreted(origin({ title: 'x' }), one).title).toBe('The real headline')
    expect(fileName(interpreted(origin({ title: 'x' }), one).title)).toBe('The real headline.md')
  })

  test('leaves the title the page gave itself where it filled none in', () => {
    expect(interpreted(origin(), filled).title).toBe('A title')
    expect(interpreted(origin(), [{ key: 'title', value: '' }]).title).toBe('A title')
  })

  test('says the title once, in the block and the heading, and never in the body twice', () => {
    const one = [{ key: 'title', value: 'The real headline' }]
    const note = noteFor(origin({ title: 'Whatever' }), '# The real headline\n\nThe body.', AT, one)

    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
    expect(note.endsWith('The body.\n')).toBe(true)
  })

  test('changes nothing about a clip nobody asked about', () => {
    expect(noteFor(origin(), 'The body.', AT, [])).toBe(noteFor(origin(), 'The body.', AT))
  })
})

describe('how large a note may be', () => {
  test('counts what the service counts, which is bytes and not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('ä')).toBe(2)
    expect(byteLength('絵')).toBe(3)
  })

  test('takes a note up to the limit', () => {
    expect(fits('a'.repeat(MAX_NOTE_BYTES))).toBe(true)
  })

  test('refuses one past it', () => {
    expect(fits('a'.repeat(MAX_NOTE_BYTES + 1))).toBe(false)
  })

  test('measures multibyte text as the service will', () => {
    expect(fits('絵'.repeat(MAX_NOTE_BYTES / 2))).toBe(false)
  })
})
