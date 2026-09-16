import { describe, expect, test } from 'vitest'
import { escapeText } from './escapes'

/** One text node at a time, which is how turndown hands a page's words over.
 *  from-html.test.ts is the same rule seen through a conversion; what is here is
 *  the rule itself, including the edges a page rarely reaches and an adversarial
 *  one aims for. */
describe('a page’s text, as a note may hold it', () => {
  test('prose is prose', () => {
    expect(escapeText('Schauen Sie sich das Cheatsheet an.')).toBe(
      'Schauen Sie sich das Cheatsheet an.',
    )
  })

  test('a marker that would be read as markup is escaped', () => {
    expect(escapeText('see [1] and [2]')).toBe('see \\[1\\] and \\[2\\]')
    expect(escapeText('a ` and nothing to close it')).toBe('a \\` and nothing to close it')
    expect(escapeText('*emphasis*')).toBe('\\*emphasis\\*')
    expect(escapeText('_emphasis_')).toBe('\\_emphasis\\_')
  })

  describe('an escape that changes nothing', () => {
    test('is not written in front of an underscore inside a word', () => {
      expect(escapeText('cx_out and snake_case_name')).toBe('cx_out and snake_case_name')
    })

    test('and is still written where the underscore can open emphasis', () => {
      expect(escapeText('_start and end_')).toBe('\\_start and end\\_')
      expect(escapeText('a _ b')).toBe('a \\_ b')
      // The ends of the text are the next node's business, so they are escaped.
      expect(escapeText('_out')).toBe('\\_out')
      expect(escapeText('out_')).toBe('out\\_')
    })

    test('nor in front of a star that leans neither way', () => {
      expect(escapeText('2 * 3 = 6')).toBe('2 * 3 = 6')
    })

    test('and is still written where the star could begin a list or a word', () => {
      expect(escapeText('* item')).toBe('\\* item')
      expect(escapeText('  * item')).toBe('  \\* item')
      expect(escapeText('2*3*4')).toBe('2\\*3\\*4')
      expect(escapeText('rename *.md to *.txt')).toBe('rename \\*.md to \\*.txt')
    })

    test('nor in front of a backslash that escapes nothing', () => {
      expect(escapeText('C:\\Users\\me')).toBe('C:\\Users\\me')
    })

    test('and is still written where the backslash would eat the marker after it', () => {
      expect(escapeText('C:\\*.md')).toBe('C:\\\\\\*.md')
      // At the end of the text, whatever the next node starts with.
      expect(escapeText('ends in \\')).toBe('ends in \\\\')
    })
  })

  describe('a run that is unmistakably markdown', () => {
    test('is kept as it was written', () => {
      expect(escapeText('überfliegen Sie **kurz** das Dokument')).toBe(
        'überfliegen Sie **kurz** das Dokument',
      )
      expect(escapeText('ganz __fett__ gesagt')).toBe('ganz __fett__ gesagt')
      expect(escapeText('run `npm run dev` first')).toBe('run `npm run dev` first')
    })

    test('and a code span keeps what a fence would keep', () => {
      expect(escapeText('the `<img>` tag')).toBe('the `<img>` tag')
      expect(escapeText('write `a_b` for it')).toBe('write `a_b` for it')
    })

    test('unless a marker has a blank against it, where markdown stops reading one', () => {
      expect(escapeText('2 ** 3 ** 4')).toBe('2 \\*\\* 3 \\*\\* 4')
      expect(escapeText('**half open')).toBe('\\*\\*half open')
    })

    test('unless there is more of the same marker against it', () => {
      expect(escapeText('***drei***')).toBe('\\*\\*\\*drei\\*\\*\\*')
    })

    test('unless the words inside it are not words', () => {
      expect(escapeText('**<img src=q>**')).toBe('\\*\\*\\<img src=q>\\*\\*')
      expect(escapeText('**[a](javascript:alert(1))**')).toBe(
        '\\*\\*\\[a\\](javascript:alert(1))\\*\\*',
      )
      expect(escapeText('**a\\**')).toBe('\\*\\*a\\\\\\*\\*')
      expect(escapeText('**a`b**')).toBe('\\*\\*a\\`b\\*\\*')
    })

    test('and the words around it are escaped as the text they are', () => {
      expect(escapeText('[1] **kurz** *lang*')).toBe('\\[1\\] **kurz** \\*lang\\*')
    })

    /** A page is somebody else's to fill with whatever it likes, and a run of
     *  backticks with no end to it is the shape that would have the engine try
     *  every length of it. Three is every code span anybody writes. */
    test('and a wall of markers is escaped rather than read', () => {
      expect(escapeText('````x````')).toBe('\\`\\`\\`\\`x\\`\\`\\`\\`')
      expect(escapeText(`${'`'.repeat(2000)}x`)).toBe(`${'\\`'.repeat(2000)}x`)
    })
  })

  /** Only at the start of the text, which is where turndown looked for these too:
   *  a marker in the middle of a line opens nothing. */
  describe('a marker that would open a block of its own', () => {
    test('is escaped where the text begins', () => {
      expect(escapeText('+ Lesen und üben Sie')).toBe('\\+ Lesen und üben Sie')
      expect(escapeText('# 1 der Liste')).toBe('\\# 1 der Liste')
      expect(escapeText('> sagte sie')).toBe('\\> sagte sie')
      expect(escapeText('- eins')).toBe('\\- eins')
      expect(escapeText('--- und weiter')).toBe('\\--- und weiter')
      expect(escapeText('=== und weiter')).toBe('\\=== und weiter')
      expect(escapeText('~~~ und weiter')).toBe('\\~~~ und weiter')
      expect(escapeText('1. eins')).toBe('1\\. eins')
    })

    test('and is not where the same characters are punctuation', () => {
      expect(escapeText('-5 °C und +5 °C')).toBe('-5 °C und +5 °C')
      expect(escapeText('#hashtag')).toBe('#hashtag')
      expect(escapeText('sagte sie > mir')).toBe('sagte sie > mir')
      expect(escapeText('Kapitel 1. eins')).toBe('Kapitel 1. eins')
    })
  })

  /** The rule the whole escaping was written for, and the one a kept run must not
   *  be a way around: a note's own HTML is markup, so a page's `<` is not. */
  test('a bracket that would open a tag is escaped wherever it is', () => {
    expect(escapeText('a <img src=x onerror=alert(1)> b')).toBe(
      'a \\<img src=x onerror=alert(1)> b',
    )
    expect(escapeText('**kurz** <script>alert(1)</script>')).toBe(
      '**kurz** \\<script>alert(1)\\</script>',
    )
    expect(escapeText('a < b')).toBe('a < b')
  })

  test('nothing in, nothing out', () => {
    expect(escapeText('')).toBe('')
  })
})
