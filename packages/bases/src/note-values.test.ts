import { describe, expect, test } from 'vitest'
import { noteValues, scalarValue, taskHash } from './note-values'

describe('front matter as values', () => {
  test('reads every kind the Properties panel draws', () => {
    const values = noteValues(
      [
        '---',
        'title: Dune',
        'pages: 412',
        'read: true',
        'started: 2026-10-01',
        'finished: 2026-10-03T21:15',
        'author: "[[Frank Herbert]]"',
        'tags: [books, sf]',
        'related:',
        '  - "[[Foundation|Asimov]]"',
        '  - plain',
        'empty:',
        '---',
        'words',
      ].join('\n'),
    )
    expect(values).toEqual({
      title: 'Dune',
      pages: 412,
      read: true,
      started: { kind: 'date', iso: '2026-10-01' },
      finished: { kind: 'date', iso: '2026-10-03', time: '21:15' },
      author: { kind: 'link', target: 'Frank Herbert' },
      tags: ['books', 'sf'],
      related: [{ kind: 'link', target: 'Foundation', display: 'Asimov' }, 'plain'],
      empty: null,
    })
  })

  test('takes the block without its fences, as the scan carries it', () => {
    expect(noteValues('status: Doing\npriority: 2\n')).toEqual({ status: 'Doing', priority: 2 })
  })

  test('falls back to YAML for a block the panel leaves as source', () => {
    const values = noteValues('---\n# a comment\nstatus: Doing\nnested:\n  a:\n    - 1\n---\n')
    expect(values).toEqual({ status: 'Doing', nested: { a: [1] } })
  })

  test('is nothing for a note without front matter or with a block that is not YAML', () => {
    expect(noteValues('just words')).toEqual({})
    expect(noteValues('---\n: : :\n  - [\n---\n')).toEqual({})
  })

  test('a key named kind is a key like any other', () => {
    expect(noteValues('---\n# c\nkind: date\n---\n')).toEqual({ kind: 'date' })
  })

  test('scalars', () => {
    expect(scalarValue('~')).toBeNull()
    expect(scalarValue('-3.5')).toBe(-3.5)
    expect(scalarValue('FALSE')).toBe(false)
    expect(scalarValue('2026-10-03T10:00:00Z')).toEqual({
      kind: 'date',
      iso: '2026-10-03',
      time: '10:00:00',
      zone: 'UTC',
    })
  })
})

describe('a task hash', () => {
  test('is stable and short, and differs with the words', () => {
    expect(taskHash('Call the bank')).toBe(taskHash('Call the bank'))
    expect(taskHash('Call the bank')).not.toBe(taskHash('Call the bunk'))
    expect(taskHash('')).toMatch(/^[0-9a-z]+$/)
  })
})
