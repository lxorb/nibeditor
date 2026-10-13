import { describe, expect, test } from 'vitest'
import { CORPUS, CORPUS_NAME } from './corpus'
import { documentOf } from './document'
import { toPlainText } from './text'

const TEXT = toPlainText(documentOf(CORPUS, CORPUS_NAME))
const lines = TEXT.split('\n')

/** The line that holds `text`, so a test says what it is looking for rather than
 *  counting its way to an index. */
function lineWith(text: string): string {
  const found = lines.find((line) => line.includes(text))
  expect(found, text).toBeDefined()
  // Asserted on the line above.
  return found!
}

const plain = (source: string) => toPlainText(documentOf(source, 'Note.md'))

describe('a note as plain text', () => {
  test('carries no markdown marks at all', () => {
    for (const mark of ['**', '~~', '==', '`', '#', '[[', '](']) {
      expect(TEXT, mark).not.toContain(mark)
    }
  })

  test('ends with exactly one newline', () => {
    expect(TEXT.endsWith('\n')).toBe(true)
    expect(TEXT.endsWith('\n\n')).toBe(false)
  })

  test('never leaves three newlines in a row', () => {
    expect(TEXT).not.toContain('\n\n\n')
  })

  test('never leaves trailing space on a line', () => {
    expect(lines.filter((line) => /\s$/.test(line))).toEqual([])
  })
})

describe('headings', () => {
  test('are their own line, with the marks gone', () => {
    expect(lines).toContain('Export corpus')
    expect(lines).toContain('A table')
  })

  test('the title is not repeated when the first heading already says it', () => {
    expect(lines.filter((line) => line === 'Export corpus')).toHaveLength(1)
  })

  test('a title the body does not say heads the file', () => {
    const text = plain('---\ntitle: Meta\n---\n\nJust words.\n')
    expect(text.split('\n')[0]).toBe('Meta')
  })
})

describe('prose', () => {
  test('keeps the words and drops the emphasis', () => {
    expect(lineWith('Prose with')).toContain('Prose with bold, italic, struck, marked, inline code')
  })

  test('writes a link as its words and then its address', () => {
    expect(TEXT).toContain('a link (https://orden.so)')
  })

  test('writes a link whose words are its address only once', () => {
    expect(plain('<https://nib.dev>\n').trim()).toBe('https://nib.dev')
  })

  test('keeps inline maths as the TeX it was written as', () => {
    expect(TEXT).toContain('E = mc^2')
  })

  test('marks a footnote reference with its label', () => {
    expect(lineWith('a footnote')).toContain('a footnote[one]')
  })

  test('names a picture in brackets, and a nameless one as a picture', () => {
    expect(lines).toContain('[Pasted picture]')
    expect(plain('![](a.png)\n').trim()).toBe('[picture]')
  })
})

describe('a table', () => {
  test('is drawn with its columns lined up', () => {
    const head = lineWith('Left')
    const rule = lines[lines.indexOf(head) + 1] ?? ''
    const first = lines[lines.indexOf(head) + 2] ?? ''

    expect(rule).toMatch(/^-+ {2}-+ {2}-+$/)
    expect(head.length).toBe(rule.length)
    // `Right` is right aligned and `22` is the longest value under it, so the
    // heading and the value end in the same column.
    expect(first.length).toBe(head.length)
  })

  test('lines a right aligned column up on the right', () => {
    const text = plain('| a |\n| --: |\n| 1 |\n| 222 |\n')
    expect(text.split('\n').slice(0, 4)).toEqual(['  a', '---', '  1', '222'])
  })
})

describe('code', () => {
  test('is kept exactly as it was written, indentation and all', () => {
    expect(TEXT).toContain('const answer: number = 42\n  const indented = true')
  })

  test('a diagram is kept as its own source too', () => {
    expect(TEXT).toContain('graph TD; A-->B')
  })
})

describe('lists', () => {
  test('keep a bullet, because the shape is the meaning', () => {
    expect(lines).toContain('- plain bullet')
  })

  test('indent what is nested under an item', () => {
    expect(lines).toContain('  - nested bullet')
  })

  test('number an ordered list as it was numbered', () => {
    expect(lines).toContain('1. first')
    expect(lines).toContain('2. second')
  })

  test('write a task as a box, ticked or not', () => {
    expect(lines).toContain('- [x] done')
    expect(lines).toContain('- [ ] open')
  })

  test('carry on from the number the list started at', () => {
    expect(plain('7. seven\n8. eight\n').trim().split('\n')).toEqual(['7. seven', '8. eight'])
  })
})

describe('the rest of the constructs', () => {
  test('a quote is marked down its left', () => {
    expect(lines).toContain('> A blockquote, with bold inside it.')
  })

  test('a callout says what kind it is first', () => {
    expect(lines).toContain('> Note')
    expect(lines).toContain('> Careful with that.')
  })

  test('display maths is its own lines of TeX', () => {
    expect(TEXT).toContain('\\int_0^1 x^2\\,dx = \\frac{1}{3}')
  })

  test('a definition list indents each meaning under its term', () => {
    expect(lines).toContain('Markdown')
    expect(lines).toContain('  A way of writing formatted text.')
    expect(lines).toContain('  Also the format itself.')
  })

  test('a rule is a run of dashes', () => {
    expect(lines.filter((line) => /^-{32}$/.test(line)).length).toBeGreaterThan(0)
  })

  test('the footnotes follow at the bottom, under a rule', () => {
    const at = lines.findIndex((line) => line.startsWith('[one] '))
    expect(at).toBeGreaterThan(0)
    expect(lines[at]).toContain("The footnote's own words, with bold in them.")
    expect(at).toBe(lines.length - 2)
  })
})

describe('a note with almost nothing in it', () => {
  test('comes out as one line', () => {
    expect(plain('Just words.\n')).toBe('Just words.\n')
  })

  test('an empty note comes out empty', () => {
    expect(plain('')).toBe('\n')
  })
})
