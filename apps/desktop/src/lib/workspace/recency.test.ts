import { describe, expect, test } from 'vitest'
import { ranked, Walk } from './recency'

const STRIP = ['a', 'b', 'c', 'd']

describe('a strip in order of use', () => {
  test('is the tab in front, then the rest by how recently each was in front', () => {
    expect(ranked(STRIP, ['c', 'a', 'b'], 'c')).toEqual(['c', 'a', 'b', 'd'])
  })

  /** A session read back at launch: nothing has been looked at yet. */
  test('keeps the strip s own order for tabs never in front', () => {
    expect(ranked(STRIP, [], 'b')).toEqual(['b', 'a', 'c', 'd'])
  })

  test('leaves out tabs that are not in this strip any more', () => {
    expect(ranked(['a', 'b'], ['gone', 'b', 'a'], 'a')).toEqual(['a', 'b'])
  })
})

describe('Ctrl+Tab in order of use', () => {
  /** Looked at a, then b, then c: c is in front. */
  const walk = () => new Walk(STRIP, 'c', ['c', 'b', 'a'])

  test('goes to the tab used before this one', () => {
    expect(walk().step(1)).toBe('b')
  })

  test('goes further back with each press while held, and round', () => {
    const held = walk()
    expect([held.step(1), held.step(1), held.step(1), held.step(1)]).toEqual(['b', 'a', 'd', 'c'])
  })

  test('goes to the tab used longest ago with Shift', () => {
    expect(walk().step(-1)).toBe('d')
  })

  /** Letting go is using the tab arrived at, and nothing walked past on the way. */
  test('moves only the tab it ended on to the front of the order', () => {
    const held = walk()
    held.step(1)
    held.step(1)
    expect(held.ended('a')).toEqual(['a', 'c', 'b'])
  })

  /** So one press, let go, and one more press goes back to where it started. */
  test('goes back and forth between two tabs, one press at a time', () => {
    const first = walk()
    const there = first.step(1)
    const again = new Walk(STRIP, there ?? '', first.ended(there))
    expect(again.step(1)).toBe('c')
  })

  test('has nowhere to go in a strip of one', () => {
    expect(new Walk(['a'], 'a', ['a']).step(1)).toBeNull()
  })
})
