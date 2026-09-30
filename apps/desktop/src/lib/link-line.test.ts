import { describe, expect, test } from 'vitest'
import { linkPieces } from './link-line'

/** What the Links panel quotes under a row: the line as the reading view reads it.
 *  Found by hunt-7, which saw `[[Kestrel notes]]` in the panel, brackets and all. */

const shown = (line: string) =>
  linkPieces(line)
    .map((one) => (one.link ? `<${one.text}>` : one.text))
    .join('')

describe('a quoted line', () => {
  test('shows a link as the note it names', () => {
    expect(shown('The birds are in [[Kestrel notes]].')).toBe('The birds are in <Kestrel notes>.')
  })

  test('shows an alias where the link has one', () => {
    expect(shown('See [[Kestrel notes#Wind|wind notes]] first.')).toBe('See <wind notes> first.')
  })

  test('shows a heading link the way the reading view writes it', () => {
    expect(shown('[[Kestrel notes#Wind]]')).toBe('<Kestrel notes#Wind>')
  })

  test('shows every link on the line, and an embed as its name', () => {
    expect(shown('[[A]] and ![[B]] and [c](C.md)')).toBe('<A> and <B> and <c>')
  })

  test('shows a link out at the web by its label', () => {
    expect(shown('Read [the docs](https://example.com/docs) today')).toBe('Read <the docs> today')
  })

  test('leaves a link written as code alone', () => {
    expect(shown('Type `[[Note]]` to link')).toBe('Type `[[Note]]` to link')
  })

  test('is the line itself where it links nowhere', () => {
    expect(linkPieces('Write up the Kestrel notes before Friday.')).toEqual([
      { text: 'Write up the Kestrel notes before Friday.', link: false },
    ])
  })
})
