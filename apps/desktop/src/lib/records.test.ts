import { describe, expect, test } from 'vitest'
import { filledIn } from './records'

describe('a map filled in from storage that answered late', () => {
  test('takes the keys it did not have, and keeps its own for the ones it did', () => {
    const held = { a: 'written this launch' }

    expect(filledIn(held, { a: 'stale', b: 'late' })).toEqual({
      a: 'written this launch',
      b: 'late',
    })
  })

  test('is nothing at all when storage said nothing new, so nothing is reassigned', () => {
    expect(filledIn({ a: 1 }, { a: 2 })).toBeNull()
    expect(filledIn({ a: 1 }, {})).toBeNull()
  })
})
