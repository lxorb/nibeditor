import { describe, expect, test } from 'vitest'
import { lexMarkdown, renderMarkdown } from './index'
import { opensTag, tagNameAt } from './tags'

/** The tags a render drew, by the name each carries. */
function drawn(source: string, options: Parameters<typeof renderMarkdown>[1] = {}): string[] {
  const html = renderMarkdown(source, options)
  return [...html.matchAll(/class="tag"[^>]*data-tag="([^"]*)"/g)].map((found) => found[1] ?? '')
}

describe('what a tag is', () => {
  test('a letter after the hash, then letters, digits and the joining three', () => {
    expect(tagNameAt('#work', 0)).toBe('work')
    expect(tagNameAt('#work/nib-2_b, then', 0)).toBe('work/nib-2_b')
    expect(tagNameAt('#Überblick', 0)).toBe('Überblick')
    expect(tagNameAt('#日本語', 0)).toBe('日本語')
  })

  test('not a number, not a heading, not a bare hash', () => {
    expect(tagNameAt('#42', 0)).toBeNull()
    expect(tagNameAt('# Heading', 0)).toBeNull()
    expect(tagNameAt('#', 0)).toBeNull()
    expect(tagNameAt('work', 0)).toBeNull()
  })

  test('only where a word opens', () => {
    expect(opensTag('')).toBe(true)
    expect(opensTag(' ')).toBe(true)
    expect(opensTag('\n')).toBe(true)
    expect(opensTag('(')).toBe(true)
    expect(opensTag('C')).toBe(false)
    expect(opensTag('/')).toBe(false)
    expect(opensTag('*')).toBe(false)
  })
})

describe('a tag on a page', () => {
  test('is drawn as a tag, the hash with it', () => {
    expect(renderMarkdown('Filed under #work.')).toBe(
      '<p>Filed under <span class="tag" data-tag="work">#work</span>.</p>\n',
    )
  })

  test('nested is one tag', () => {
    expect(drawn('Under #work/nib/canvas today')).toEqual(['work/nib/canvas'])
  })

  test('opening a paragraph, a heading, an item, a cell and a bracket', () => {
    expect(drawn('#first words')).toEqual(['first'])
    expect(drawn('## A heading #in-it')).toEqual(['in-it'])
    expect(drawn('- #item\n- two')).toEqual(['item'])
    expect(drawn('| a |\n| - |\n| #cell |')).toEqual(['cell'])
    expect(drawn('words (#aside) more')).toEqual(['aside'])
  })

  test('left alone in code, maths, addresses, links, headings and mid-word', () => {
    expect(drawn('`#code` and\n\n```\n#fenced\n```')).toEqual([])
    expect(drawn('$#x$')).toEqual([])
    expect(drawn('https://nib.dev/#top and <https://nib.dev/#also>')).toEqual([])
    expect(drawn('[see #this](https://nib.dev) and [[Note#Heading]]')).toEqual([])
    expect(drawn('# Heading\n\nC#sharp and a#b')).toEqual([])
    expect(drawn('#42 and \\#escaped')).toEqual([])
  })

  test('a link on a surface that says where one goes, and words everywhere else', () => {
    const html = renderMarkdown('A #work/nib tag', { tagHref: (tag) => `#tag:${tag}` })

    expect(html).toContain('<a class="tag" href="#tag:work/nib" data-tag="work/nib">#work/nib</a>')
    expect(renderMarkdown('A #work tag', { escapeHtml: true })).toContain(
      '<span class="tag" data-tag="work">#work</span>',
    )
  })

  test('says its words to a reader of the tokens that has never heard of a tag', () => {
    const [paragraph] = lexMarkdown('Filed #work')
    const inline = (paragraph as { tokens?: { type: string; text?: string }[] }).tokens ?? []

    expect(inline.map((one) => [one.type, one.text])).toEqual([
      ['text', 'Filed '],
      ['hashtag', '#work'],
    ])
  })
})
