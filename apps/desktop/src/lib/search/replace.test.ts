import { describe, expect, test } from 'vitest'
import { Matcher } from './match'
import { parseQuery } from './query'
import { applied, expand, replaceIn, reverse } from './replace'

/** What the panel does to one note: find, keep the lines that are ticked,
 *  and put the replacement in. */
function rewrite(body: string, query: string, replacement: string, lines?: number[]) {
  const spans = new Matcher(parseQuery(query)).spans({
    path: '/space/Note.md',
    relative: 'Note.md',
    name: 'Note.md',
    body,
  })

  if (!spans) return null

  const kept = new Set(lines ?? body.split('\n').map((_line, index) => index))
  const edits = replaceIn(body, spans, kept, replacement)
  return edits && { text: applied(body, edits), edits }
}

describe('replacing', () => {
  test('puts the new words in every match', () => {
    expect(rewrite('alpha and alpha\n', 'alpha', 'beta')?.text).toBe('beta and beta\n')
  })

  test('leaves the lines nobody ticked alone', () => {
    const body = 'alpha one\nalpha two\nalpha three\n'
    expect(rewrite(body, 'alpha', 'beta', [1])?.text).toBe('alpha one\nbeta two\nalpha three\n')
  })

  test('answers nothing when no ticked line matched', () => {
    expect(rewrite('alpha\nbeta\n', 'alpha', 'gamma', [1])).toBeNull()
  })

  test('keeps the case that was typed, whatever case was found', () => {
    expect(rewrite('Alpha and ALPHA\n', 'alpha', 'beta')?.text).toBe('beta and beta\n')
  })

  test('replaces words two operators both found only once', () => {
    expect(rewrite('alphabet\n', 'alpha alphabet', 'x')?.text).toBe('x\n')
  })

  test('says which edits it made, so a pane can take them as edits', () => {
    expect(rewrite('a alpha b\n', 'alpha', 'beta')?.edits).toEqual([
      { from: 2, to: 7, insert: 'beta' },
    ])
  })

  test('takes the words out when the replacement is empty', () => {
    expect(rewrite('alpha beta\n', '"alpha "', '')?.text).toBe('beta\n')
  })
})

describe('groups', () => {
  test('put back what the pattern caught', () => {
    expect(rewrite('Doe, John\n', '/(\\w+), (\\w+)/', '$2 $1')?.text).toBe('John Doe\n')
  })

  test('put back the whole match for $&', () => {
    expect(rewrite('alpha\n', '/al\\w+/', '[$&]')?.text).toBe('[alpha]\n')
  })

  test('take $$ as one dollar', () => {
    expect(rewrite('alpha\n', '/alpha/', '$$1')?.text).toBe('$1\n')
  })

  test('leave a group the pattern never had alone', () => {
    expect(rewrite('alpha\n', '/alpha/', '$3')?.text).toBe('$3\n')
  })

  test('do not read a plain word as a pattern with groups', () => {
    expect(rewrite('alpha\n', 'alpha', '$1')?.text).toBe('$1\n')
  })

  test('run down a whole note', () => {
    const body = 'a-1\nb-2\n'
    expect(rewrite(body, '/(\\w)-(\\d)/', '$2$1')?.text).toBe('1a\n2b\n')
  })
})

describe('putting a replacement back', () => {
  const back = (body: string, query: string, replacement: string) => {
    const made = rewrite(body, query, replacement)
    if (!made) throw new Error('nothing was replaced')

    return { made, edits: reverse(body, made.edits) }
  }

  test('gives the note its old words', () => {
    const body = 'alpha and alpha\n'
    const { made, edits } = back(body, 'alpha', 'beta')

    expect(applied(made.text, edits)).toBe(body)
  })

  test('works when the replacement is longer than what it replaced', () => {
    const body = 'a b a\n'
    const { made, edits } = back(body, 'a', 'much longer')

    expect(made.text).toBe('much longer b much longer\n')
    expect(applied(made.text, edits)).toBe(body)
  })

  test('works when the replacement is shorter', () => {
    const body = 'alpha alpha alpha\n'
    const { made, edits } = back(body, 'alpha', 'x')

    expect(made.text).toBe('x x x\n')
    expect(applied(made.text, edits)).toBe(body)
  })

  test('works when the replacement took the words out', () => {
    const body = 'keep alpha this\n'
    const { made, edits } = back(body, '"alpha "', '')

    expect(made.text).toBe('keep this\n')
    expect(applied(made.text, edits)).toBe(body)
  })
})

describe('expanding a replacement', () => {
  test('hands a plain one back untouched', () => {
    expect(expand('$1 and $&', 'matched', undefined)).toBe('$1 and $&')
  })

  test('fills what the pattern caught', () => {
    expect(expand('$1-$2', 'ab', ['a', 'b'])).toBe('a-b')
  })

  test('reads a group that took part in no match as nothing', () => {
    expect(expand('[$1]', 'x', [''])).toBe('[]')
  })
})
