import { describe, expect, test } from 'vitest'
import { frontMatter } from '../note'
import type { Origin } from '@nib/markdown/article'
import { objectIn, readFilled } from './values'
import type { Template } from './templates'

const AT = new Date('2026-03-04T09:12:00Z')

function template(over: Partial<Template> = {}): Template {
  return {
    name: 'Article',
    when: [],
    fields: [
      { key: 'author', says: 'Who wrote it', list: false },
      { key: 'published', says: 'The day', list: false },
      { key: 'tags', says: 'A few topics', list: true },
    ],
    ...over,
  }
}

function origin(over: Partial<Origin> = {}): Origin {
  return { kind: 'page', url: 'https://site.example/a', title: 'A title', tags: [], ...over }
}

describe('finding the object in a reply', () => {
  test('takes the reply itself when that is all it is', () => {
    expect(objectIn('{"a": 1}')).toEqual({ a: 1 })
  })

  test('takes it out of a fence, whatever the fence claims to hold', () => {
    expect(objectIn('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(objectIn('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  test('takes it out of a sentence a model could not help adding', () => {
    expect(objectIn('Here are the properties:\n{"a": 1}\nHope that helps.')).toEqual({ a: 1 })
  })

  test('is nothing for a reply with no object in it', () => {
    expect(objectIn('I could not read the page.')).toBe(null)
    expect(objectIn('')).toBe(null)
  })

  test('is nothing for a list or a bare value, which are not properties', () => {
    expect(objectIn('[1, 2]')).toBe(null)
    expect(objectIn('"author"')).toBe(null)
    expect(objectIn('null')).toBe(null)
  })

  test('is nothing for something that only looks like JSON', () => {
    expect(objectIn('{ author: nobody }')).toBe(null)
    expect(objectIn('{"a": 1,}')).toBe(null)
  })
})

describe('reading the properties out of a reply', () => {
  test('takes the ones the template asked for, in the order it asked', () => {
    const filled = readFilled('{"tags": ["one"], "author": "A. Writer"}', template())

    expect(filled).toEqual([
      { key: 'author', value: 'A. Writer' },
      { key: 'tags', value: ['one'] },
    ])
  })

  test('leaves out a property the template did not name, however confidently named', () => {
    expect(readFilled('{"author": "A", "sentiment": "upbeat"}', template())).toEqual([
      { key: 'author', value: 'A' },
    ])
  })

  test('leaves out a property the page did not say', () => {
    expect(readFilled('{"author": null, "published": ""}', template())).toEqual([])
  })

  test('is an empty answer, not a failure, when the page said none of them', () => {
    expect(readFilled('{}', template())).toEqual([])
  })

  test('is no answer at all when the reply was not properties', () => {
    expect(readFilled('I cannot tell.', template())).toBe(null)
  })

  test('takes a number or a yes as the word it is', () => {
    const one = template({ fields: [{ key: 'servings', says: 'How many', list: false }] })

    expect(readFilled('{"servings": 4}', one)).toEqual([{ key: 'servings', value: '4' }])
    expect(readFilled('{"servings": true}', one)).toEqual([{ key: 'servings', value: 'true' }])
  })

  test('drops a value that is not a line where a line was asked for', () => {
    expect(readFilled('{"author": {"name": "A"}}', template())).toEqual([])
    expect(readFilled('{"author": ["A", "B"]}', template())).toEqual([])
  })

  test('reads one string as a list of one where a list was asked for', () => {
    expect(readFilled('{"tags": "one"}', template())).toEqual([{ key: 'tags', value: ['one'] }])
  })

  test('answers a list of nothing by leaving the property out', () => {
    expect(readFilled('{"tags": []}', template())).toEqual([])
    expect(readFilled('{"tags": [null, {}]}', template())).toEqual([])
  })

  test('keeps a list of lines and drops the members that are not', () => {
    expect(readFilled('{"tags": ["one", 2, null, "three"]}', template())).toEqual([
      { key: 'tags', value: ['one', '2', 'three'] },
    ])
  })

  test('says each member of a list once', () => {
    expect(readFilled('{"tags": ["one", "one", "two"]}', template())).toEqual([
      { key: 'tags', value: ['one', 'two'] },
    ])
  })

  test('stops a list well short of a page of them', () => {
    const many = Array.from({ length: 40 }, (_, at) => `t${at}`)
    const read = readFilled(JSON.stringify({ tags: many }), template())

    expect((read?.[0]?.value as string[]).length).toBe(8)
  })

  test('answers a key written the way the template writes a list', () => {
    expect(readFilled('{"tags[]": ["one"]}', template())).toEqual([{ key: 'tags', value: ['one'] }])
  })
})

/** The half that makes a model's answer safe to put in a file. A value is made one
 *  line here and quoted by the writer; between them, nothing a model can say ends
 *  the block, opens a key of its own or buries the note. */
describe('a value that would break the block', () => {
  test('arrives as one line, however many the model wrote', () => {
    const filled = readFilled(
      JSON.stringify({ author: 'A. Writer\n---\nsource: https://evil.example/' }),
      template(),
    )

    expect(filled).toEqual([
      { key: 'author', value: 'A. Writer --- source: https://evil.example/' },
    ])
  })

  test('leaves the note with one block, and every word of it inside a value', () => {
    const filled =
      readFilled(JSON.stringify({ author: 'A\n---\ntags: [taken over]' }), template()) ?? []
    const block = frontMatter(origin(), AT, filled)

    expect(block.split('\n').filter((line) => line === '---')).toHaveLength(2)
    expect(block).toContain("author: 'A --- tags: [taken over]'")
    // The clip's own tags, not the ones the value was trying to be.
    expect(block).toContain('tags: []')
  })

  test('is quoted where it would open a mapping or a comment', () => {
    const filled = readFilled(JSON.stringify({ author: 'Smith, J: a life # 2' }), template()) ?? []

    expect(frontMatter(origin(), AT, filled)).toContain("author: 'Smith, J: a life # 2'")
  })

  test('is quoted where YAML would read it as something other than a string', () => {
    const one = template({ fields: [{ key: 'servings', says: 'How many', list: false }] })
    const filled = readFilled('{"servings": "no"}', one) ?? []

    expect(frontMatter(origin(), AT, filled)).toContain("servings: 'no'")
  })

  test('is short enough that the block stays metadata', () => {
    const filled = readFilled(JSON.stringify({ author: 'A'.repeat(5000) }), template())
    const said = filled?.[0]?.value

    expect(typeof said === 'string' && said.length).toBe(300)
  })

  test('cannot be a property the clip writes for itself, whatever it answers', () => {
    // The template reader refuses to name one; a model naming one anyway is a key
    // the template did not ask for, and is dropped for that reason alone.
    const filled = readFilled('{"source": "https://evil.example/", "author": "A"}', template())

    expect(filled).toEqual([{ key: 'author', value: 'A' }])
    expect(frontMatter(origin(), AT, filled ?? [])).toContain('source: https://site.example/a')
  })
})
