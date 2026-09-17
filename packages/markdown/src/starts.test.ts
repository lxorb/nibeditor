import { describe, expect, test } from 'vitest'
import { firstStart, lineStart, matchesAt, paragraphWindow } from './starts'
import { codeBlocks, renderMarkdown } from './index'

describe('looking for the fences of a note', () => {
  test('finds them, whichever mark they were written with', () => {
    expect(codeBlocks('```ts\nconst a = 1\n```\n')).toEqual([
      { language: 'ts', code: 'const a = 1' },
    ])
    expect(codeBlocks('~~~py\nx = 1\n~~~\n')).toEqual([{ language: 'py', code: 'x = 1' }])
  })

  test('finds one inside a quote, which is not at the start of its line', () => {
    expect(codeBlocks('> ```ts\n> const a = 1\n> ```\n')).toHaveLength(1)
  })

  test('reads a note with neither mark in it no further', () => {
    expect(codeBlocks('# Just words\n\nand a `span` of code.\n')).toEqual([])
  })
})

describe('how far a block start has to look', () => {
  test('to the end of the paragraph', () => {
    const src = 'one\ntwo\n\nthree'
    expect(paragraphWindow(src)).toBe(9)
    expect(src.slice(0, paragraphWindow(src))).toBe('one\ntwo\n\n')
  })

  test('a line of blanks ends one too', () => {
    const src = 'one\n   \nthree'
    expect(src.slice(0, paragraphWindow(src))).toBe('one\n   \n')
  })

  test('a carriage return counts as the empty line it is half of', () => {
    const src = 'one\r\n\r\nthree'
    expect(paragraphWindow(src)).toBeLessThan(src.length)
  })

  test('all of it when there is no blank line', () => {
    expect(paragraphWindow('one\ntwo\nthree')).toBe(13)
    expect(paragraphWindow('')).toBe(0)
    expect(paragraphWindow('no newline at all')).toBe(17)
  })

  test('the last line, when the document ends in blanks', () => {
    expect(paragraphWindow('one\n  ')).toBe(6)
  })
})

describe('the first place a construct could be', () => {
  const at = (src: string) => firstStart(src, ['xy'], (_src, found) => found)

  test('is where the literal is', () => {
    expect(at('--xy--')).toBe(2)
  })

  test('is nothing when the literal is absent', () => {
    expect(at('nothing here')).toBeUndefined()
  })

  test('is nothing when the literal is past the paragraph', () => {
    // Marked cuts the paragraph it is about to read; a place beyond that
    // paragraph would change nothing, and looking for it is what cost the time.
    expect(at('a paragraph\n\nand then xy')).toBeUndefined()
  })

  test('takes the earliest of several literals', () => {
    const found = firstStart('..b..a..', ['a', 'b'], (_src, found) => found)
    expect(found).toBe(2)
  })

  test('skips a place the pattern turns down', () => {
    const found = firstStart('xy xy', ['xy'], (_src, found) => (found === 0 ? null : found))
    expect(found).toBe(3)
  })

  test('confirms against the whole document, not the paragraph', () => {
    // A construct that starts inside the paragraph may run past it.
    const src = 'one\nxy tail\n\nrest'
    const found = firstStart(src, ['xy'], (whole, found) =>
      whole.slice(found).startsWith('xy tail\n\nrest') ? found : null,
    )
    expect(found).toBe(4)
  })
})

describe('the line a place sits on', () => {
  test('is the newline before it', () => {
    expect(lineStart('one\ntwo', 4)).toBe(3)
  })

  test('is nothing when words come first', () => {
    expect(lineStart('one two', 4)).toBeNull()
  })

  test('allows the blanks it is told to', () => {
    expect(lineStart('one\n  two', 6, { blanks: 3 })).toBe(3)
    expect(lineStart('one\n      two', 10, { blanks: 3 })).toBeNull()
  })

  test('counts the start of the string only when asked', () => {
    expect(lineStart('two', 0)).toBeNull()
    expect(lineStart('two', 0, { orString: true })).toBe(0)
  })
})

describe('matching at one place', () => {
  test('holds the pattern to that place', () => {
    const pattern = /ab/y
    expect(matchesAt(pattern, 'xxabxx', 2)).toBe(true)
    expect(matchesAt(pattern, 'xxabxx', 1)).toBe(false)
  })
})

/** The block starts used to hand marked a place for anything that merely looked
 *  like their construct, and marked cut the paragraph in two there. The seam
 *  showed as a newline in the words, which a browser reads as a space. */
describe('a mark in the middle of a sentence leaves the sentence alone', () => {
  test('a footnote reference', () => {
    const html = renderMarkdown('A sentence with a note[^1] in it.\n\n[^1]: The note.\n', {
      footnotes: true,
    })

    expect(html).toContain('with a note<sup class="footnote-ref"')
    expect(html).toContain('</sup> in it.')
  })

  test('a pair of dollars', () => {
    const html = renderMarkdown('Costs $$5 and $$6 in total.\n')

    expect(html).toBe('<p>Costs $$5 and $$6 in total.</p>\n')
  })

  test('a bracket that opens no definition', () => {
    const html = renderMarkdown('Text with *[a link](https://x)* in it.\n')

    expect(html).toBe('<p>Text with <em><a href="https://x">a link</a></em> in it.</p>\n')
  })

  test('an embed that is not on a line of its own', () => {
    const html = renderMarkdown('Text with ![[Note]] in it.\n', {
      resolveEmbed: () => '# Note\n\nwords\n',
    })

    expect(html).toBe('<p>Text with Note in it.</p>\n')
  })
})

describe('a construct on a line of its own still ends the paragraph above it', () => {
  test('a maths block', () => {
    const html = renderMarkdown('Text\n$$\na^2\n$$\n')

    expect(html).toContain('<p>Text</p>')
    expect(html).toContain('<div class="math-block"')
  })

  test('a footnote definition', () => {
    const html = renderMarkdown('Text[^1]\n[^1]: The note.\n', { footnotes: true })

    expect(html).toContain('<p>Text<sup class="footnote-ref"')
    expect(html).toContain('<section class="footnotes">')
  })

  test('an abbreviation definition', () => {
    const html = renderMarkdown('Text about HTML\n*[HTML]: HyperText Markup Language\n')

    expect(html).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
    expect(html).not.toContain('*[HTML]')
  })

  test('an embed', () => {
    const html = renderMarkdown('Text\n![[Note]]\n', { resolveEmbed: () => 'words\n' })

    expect(html).toContain('<p>Text</p>')
    expect(html).toContain('<figure class="embed">')
  })

  test('a table of contents', () => {
    const html = renderMarkdown('Text\n[TOC]\n\n# One\n', { toc: true })

    expect(html).toContain('<p>Text</p>')
    expect(html).toContain('<nav class="toc">')
  })
})
