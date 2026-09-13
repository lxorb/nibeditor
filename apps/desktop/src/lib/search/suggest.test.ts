import { describe, expect, test } from 'vitest'
import { OPERATORS, parseQuery, type Query } from './query'
import { chosen, completing, naming, offered } from './suggest'

/** The caret sits where the pipe is, which is how these read. */
function at(source: string) {
  const caret = source.indexOf('|')
  return completing(source.replace('|', ''), caret)
}

describe('what is being finished', () => {
  test('is the value of the operator the caret is in', () => {
    expect(at('path:wo|')).toMatchObject({ field: 'path', typed: 'wo' })
    expect(at('file:Me|')).toMatchObject({ field: 'file', typed: 'Me' })
    expect(at('tag:#wo|')).toMatchObject({ field: 'tag', typed: '#wo' })
  })

  test('is the whole value even when nothing is typed yet', () => {
    expect(at('path:|')).toMatchObject({ field: 'path', typed: '' })
  })

  test('says where the value sits, so the chosen one lands there', () => {
    expect(at('alpha path:wo|')).toMatchObject({ from: 11, to: 13 })
  })

  test('is nothing when the caret is in an ordinary word', () => {
    expect(at('alpha|')).toBeNull()
    expect(at('|')).toBeNull()
  })

  test('is nothing once the value has ended', () => {
    expect(at('path:work |')).toBeNull()
  })

  test('is nothing for an operator that has no values to offer', () => {
    expect(at('line:al|')).toBeNull()
  })

  test('reaches through an exclusion', () => {
    expect(at('-tag:wo|')).toMatchObject({ field: 'tag', typed: 'wo' })
  })

  test('lets a quoted value hold a space', () => {
    expect(at('path:"my no|')).toMatchObject({ field: 'path', typed: 'my no', quoted: true })
  })
})

describe('what is offered', () => {
  const VALUES = ['Work/', 'Work/2026/', 'Archive/work/', 'Drafts/']

  test('is everything when nothing has been typed', () => {
    expect(offered('', VALUES)).toEqual(VALUES)
  })

  test('puts what starts with the typing first', () => {
    expect(offered('work', VALUES)).toEqual(['Work/', 'Work/2026/', 'Archive/work/'])
  })

  test('folds case', () => {
    expect(offered('WORK', VALUES)).toEqual(['Work/', 'Work/2026/', 'Archive/work/'])
  })

  test('is empty when nothing holds the typing', () => {
    expect(offered('zeta', VALUES)).toEqual([])
  })

  test('stops at a list a popup can show', () => {
    const many = Array.from({ length: 40 }, (_one, index) => `folder${index}/`)
    expect(offered('folder', many)).toHaveLength(12)
  })
})

describe('choosing one', () => {
  test('puts it where the typing was', () => {
    const source = 'alpha path:wo'
    const found = completing(source, source.length)
    expect(found && chosen(source, found, 'Work/')).toEqual({
      text: 'alpha path:Work/',
      caret: 16,
    })
  })

  test('quotes a value that holds a space', () => {
    const source = 'path:my'
    const found = completing(source, source.length)
    expect(found && chosen(source, found, 'my notes/')).toEqual({
      text: 'path:"my notes/"',
      caret: 16,
    })
  })

  test('closes a quote the reader opened', () => {
    const source = 'path:"my'
    const found = completing(source, source.length)
    expect(found && chosen(source, found, 'my notes/')).toEqual({
      text: 'path:"my notes/"',
      caret: 16,
    })
  })

  test('steps over a closing quote that is already there', () => {
    const source = 'path:"my"'
    const found = completing(source, 8)
    expect(found && chosen(source, found, 'my notes/')).toEqual({
      text: 'path:"my notes/"',
      caret: 16,
    })
  })

  test('leaves whatever came after the value where it was', () => {
    const source = 'path:wo beta'
    const found = completing(source, 7)
    expect(found && chosen(source, found, 'Work/')).toEqual({
      text: 'path:Work/ beta',
      caret: 10,
    })
  })
})

/** The operators themselves, offered while what is typed could still become one.
 *  Not when it could not: an ordinary word opens nothing. */
describe('finishing an operator name', () => {
  const asked = (source: string) => naming(source, source.length)

  test('offers the ones the letters could still become', () => {
    const at = asked('ta')
    expect(at?.field).toBe('name')
    expect(offered(at?.typed ?? '', OPERATORS)).toEqual([
      'tag:',
      'task:',
      'task-todo:',
      'task-done:',
    ])
  })

  test('and the hyphenated ones, which are the reason for offering any', () => {
    expect(offered(asked('task-')?.typed ?? '', OPERATORS)).toEqual(['task-todo:', 'task-done:'])
  })

  test('and nothing at all for a word that could not be one', () => {
    expect(asked('plan')).toBeNull()
    expect(asked('kestrel')).toBeNull()
    expect(asked('')).toBeNull()
  })

  test('at the start of a term, after a space, a bracket or a minus', () => {
    expect(asked('plan ta')?.typed).toBe('ta')
    expect(asked('(ta')?.typed).toBe('ta')
    expect(asked('-ta')?.typed).toBe('ta')
    // Not in the middle of a word: `beta` is a word being typed, not `ta`.
    expect(asked('beta')).toBeNull()
  })

  test('and never inside a value somebody is already finishing', () => {
    // `path:ta` is a value, which `completing` answers for; the name popup would
    // be a second list over the same letters.
    expect(completing('path:ta', 7)?.field).toBe('path')
  })

  /** Which is what keeps this list and the parser together: an operator the
   *  parser has never heard of is read as a word, and offering one would be
   *  offering to type a search for `task-todo:plan` itself. */
  test('and each one it offers is one the parser reads as an operator', () => {
    const words = (query: Query): string[] => {
      switch (query.kind) {
        case 'all':
        case 'any':
          return query.of.flatMap(words)
        case 'not':
        case 'scope':
          return words(query.of)
        case 'text':
        case 'content':
          return [query.text]
        case 'regex':
        case 'path':
        case 'file':
        case 'tag':
        case 'property':
          return []
      }
    }

    for (const operator of OPERATORS) {
      const said = words(parseQuery(`${operator}word`)).join(' ')
      expect(said, operator).not.toContain(operator)
    }
  })
})
