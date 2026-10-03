/** A tool row's verb and object. */

import { describe, expect, test } from 'vitest'
import { bareName, objectOf, verbOf } from './verbs'

describe('a tool row', () => {
  test('says nib’s tools with a verb, whichever road called them', () => {
    expect(verbOf('read_note')).toBe('Read')
    expect(verbOf('mcp__nib__edit_note')).toBe('Edited')
    expect(verbOf('browser_click')).toBe('Clicked')
    expect(bareName('mcp__nib__create_note')).toBe('create_note')
  })

  test('leaves a tool it does not know to its own name', () => {
    expect(verbOf('something_new')).toBeNull()
  })

  test('names a note without its folder or extension, a page by its host, a search by its words', () => {
    expect(objectOf({ path: 'Reading/Birds/Herons.md' })).toBe('Herons')
    expect(objectOf({ url: 'https://example.org/a/b' })).toBe('example.org')
    expect(objectOf({ query: 'kestrel' })).toBe('“kestrel”')
    expect(objectOf(null)).toBe('')
  })
})
