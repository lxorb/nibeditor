import { describe, expect, test } from 'vitest'
import { type Anchor, headingPath, headingsIn, readAnchor, resolve } from './anchors'
import { DocError } from './problem'

/** What an anchor names, as the words it covers. */
function named(text: string, anchor: Anchor, selected: { from: number; to: number } | null = null) {
  const place = resolve(anchor, text, selected)
  return text.slice(place.from, place.to)
}

/** The problem an anchor is refused with, and the sentence. */
function refused(text: string, anchor: Anchor): { code: string; message: string; count: number } {
  try {
    resolve(anchor, text)
  } catch (error) {
    if (error instanceof DocError)
      return { code: error.code, message: error.message, count: error.count }
    throw error
  }
  throw new Error('the anchor resolved')
}

describe('a quote', () => {
  const TEXT = 'The plan is simple. The plan is late. Nobody read the plan.'

  test('names the one place its words are', () => {
    expect(resolve({ quote: 'simple' }, TEXT)).toEqual({ from: 12, to: 18, shape: 'words' })
  })

  test('is refused when its words are there twice, and says how often', () => {
    expect(refused(TEXT, { quote: 'The plan is' })).toEqual({
      code: 'ambiguous',
      message: 'the quote "The plan is" is in the note 2 times',
      count: 2,
    })
  })

  test('is told apart by the words either side of it', () => {
    expect(resolve({ quote: 'The plan is', suffix: ' late' }, TEXT).from).toBe(20)
    expect(resolve({ quote: 'plan', prefix: 'read the ' }, TEXT).from).toBe(54)
  })

  test('counts overlapping places', () => {
    expect(refused('aaa', { quote: 'aa' }).count).toBe(2)
  })

  test('and says so when its words are not there', () => {
    expect(refused(TEXT, { quote: 'plans' })).toMatchObject({
      code: 'not_found',
      message: 'the quote "plans" is not in the note',
    })
  })

  test('finds words written with the other line ending', () => {
    const anchor = readAnchor({ quote: 'one\r\ntwo' })
    expect(named('zero\none\ntwo\n', anchor)).toBe('one\ntwo')
  })

  test('counts emoji and CJK the way the editor does, in code units', () => {
    const text = '会议 🎉 notes: 明天 🎉 lunch'
    expect(resolve({ quote: '🎉 lunch' }, text)).toEqual({ from: 16, to: 24, shape: 'words' })
    expect(named(text, { quote: '明天', prefix: 'notes: ' })).toBe('明天')
  })
})

describe('a heading', () => {
  const NOTE = [
    '# Plan', // 0
    'intro',
    '',
    '## Later', // 3
    'under plan',
    '',
    '### Details', // 6
    'deep',
    '',
    '# Log', // 9
    '## Later', // 10
    'under log',
    '',
    '```',
    '## Later',
    '```',
    '',
  ].join('\n')

  test('names its section, down to the last words before the next heading at its level', () => {
    expect(named(NOTE, { heading: 'Plan/Later' })).toBe('## Later\nunder plan\n\n### Details\ndeep')
  })

  test('with the same name under two parents is told apart by the path', () => {
    expect(named(NOTE, { heading: 'Log/Later' })).toBe('## Later\nunder log\n\n```\n## Later\n```')
    expect(refused(NOTE, { heading: 'Later' })).toMatchObject({ code: 'ambiguous', count: 2 })
  })

  test('is found under an ancestor that is not its parent', () => {
    expect(named(NOTE, { heading: 'Plan/Details' })).toBe('### Details\ndeep')
  })

  test('by its words in any case, or by the id a link gives it', () => {
    expect(named(NOTE, { heading: 'plan/later' })).toMatch(/^## Later/)
    expect(named('## Q3 Goals & plans\nx', { heading: 'q3-goals-plans' })).toBe(
      '## Q3 Goals & plans\nx',
    )
  })

  test('never inside a fence', () => {
    expect(headingsIn(NOTE).map((one) => one.line)).toEqual([0, 3, 6, 9, 10])
  })

  test('with a slash in its title, written as one or not', () => {
    const text = '# Q3/Q4 plan\nwords\n'
    expect(named(text, { heading: 'Q3\\/Q4 plan' })).toBe('# Q3/Q4 plan\nwords')
    expect(named(text, { heading: 'Q3/Q4 plan' })).toBe('# Q3/Q4 plan\nwords')
    expect(headingPath(headingsIn(text)[0] ?? { path: [], title: '' })).toBe('Q3\\/Q4 plan')
  })

  test('and the nth of several with one path', () => {
    const text = '## Notes\none\n## Notes\ntwo\n'
    expect(named(text, { heading: 'Notes', nth: 2 })).toBe('## Notes\ntwo')
    expect(refused(text, { heading: 'Notes', nth: 3 }).code).toBe('not_found')
  })
})

describe('a block', () => {
  test('is the run of lines around its name, and a replacement keeps the name', () => {
    const text = 'before\n\nfirst line\nthe idea ^idea\n\nafter'
    expect(resolve({ block: 'idea' }, text)).toEqual({
      from: 8,
      to: 33,
      shape: 'paragraph',
      keep: ' ^idea',
    })
  })

  test('named on a line of its own, under a table', () => {
    const text = '| a | b |\n| - | - |\n| 1 | 2 |\n^table\n'
    const place = resolve(readAnchor({ block: '^table' }), text)
    expect(text.slice(place.from, place.to)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n^table')
    expect(place.keep).toBe('\n^table')
  })

  test('is not found inside a fence', () => {
    expect(refused('```\nx ^code\n```\n', { block: 'code' }).code).toBe('not_found')
  })
})

describe('a task', () => {
  const TEXT = '- [ ] Buy milk\n- [x] Call Anna ^call\n  - [ ] Buy milk\n'

  test('is found by its words, with or without its box, ticked or not', () => {
    expect(named(TEXT, { task: '- [x] Call Anna' })).toBe('- [x] Call Anna ^call')
    expect(named(TEXT, { task: 'Call Anna' })).toBe('- [x] Call Anna ^call')
  })

  test('and the nth of two with the same words', () => {
    expect(refused(TEXT, { task: 'Buy milk' }).code).toBe('ambiguous')
    expect(named(TEXT, { task: 'Buy milk', nth: 2 })).toBe('  - [ ] Buy milk')
  })
})

describe('the other places', () => {
  test('the selection is the reader’s, and only in the note in front', () => {
    expect(named('abcdef', { selection: true }, { from: 1, to: 3 })).toBe('bc')
    expect(refused('abcdef', { selection: true }).code).toBe('no_selection')
  })

  test('the start is past the front matter', () => {
    expect(resolve({ start: true }, '---\ntags: a\n---\n# Title\n').from).toBe(16)
    expect(resolve({ start: true }, '# Title\n').from).toBe(0)
  })

  test('the end is the end', () => {
    expect(resolve({ end: true }, 'abc').from).toBe(3)
  })
})

describe('an anchor off the wire', () => {
  test('is one of the shapes, or refused', () => {
    expect(readAnchor({ heading: 'A/B', nth: 2 })).toEqual({ heading: 'A/B', nth: 2 })
    expect(readAnchor({ block: '^id' })).toEqual({ block: 'id' })
    expect(readAnchor({ quote: 'x', prefix: '', suffix: 'y' })).toEqual({ quote: 'x', suffix: 'y' })
    expect(() => readAnchor({ quote: '' })).toThrow(DocError)
    expect(() => readAnchor({ heading: 3 })).toThrow('an anchor is one of')
    expect(() => readAnchor('the plan')).toThrow('an anchor is an object')
  })
})
