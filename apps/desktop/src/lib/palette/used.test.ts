import { describe, expect, test } from 'vitest'
import { withUse } from './used'

describe('the commands used lately', () => {
  test('puts the one just run at the front, once', () => {
    expect(withUse(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(withUse([], 'a')).toEqual(['a'])
  })

  test('keeps only so many', () => {
    expect(withUse(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})
