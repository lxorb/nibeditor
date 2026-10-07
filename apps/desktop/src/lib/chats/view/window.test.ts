import { describe, expect, test } from 'vitest'
import { anchorAt, anchored, Heights } from './window'

const plain = (heights: number[]) => new Heights(heights)

describe('heights', () => {
  test('a row starts where the rows above it end', () => {
    const list = plain([10, 20, 30, 40])
    expect([0, 1, 2, 3, 4].map((i) => list.top(i))).toEqual([0, 10, 30, 60, 100])
    expect(list.total).toBe(100)
  })

  test('a measured row moves every row under it and nothing above', () => {
    const list = plain([10, 20, 30, 40])
    expect(list.set(1, 50)).toBe(30)
    expect([0, 1, 2, 3].map((i) => list.top(i))).toEqual([0, 10, 60, 90])
    expect(list.total).toBe(130)
    expect(list.set(1, 50)).toBe(0)
  })

  test('finds the row at a height', () => {
    const list = plain([10, 20, 30, 40])
    expect([-5, 0, 9, 10, 29, 30, 59, 60, 99, 500].map((y) => list.at(y))).toEqual([
      0, 0, 0, 1, 1, 2, 2, 3, 3, 3,
    ])
  })

  test('a span covers what is on screen and the overscan either side', () => {
    const list = plain(Array.from({ length: 100 }, () => 20))
    expect(list.span(400, 200, 0)).toEqual({ from: 20, to: 31 })
    expect(list.span(400, 200, 100)).toEqual({ from: 15, to: 36 })
    expect(list.span(0, 200, 100)).toEqual({ from: 0, to: 16 })
    expect(list.span(1900, 200, 100)).toEqual({ from: 90, to: 100 })
    expect(plain([]).span(0, 200, 100)).toEqual({ from: 0, to: 0 })
  })

  test('a row of no height is stepped over', () => {
    const list = plain([10, 0, 10])
    expect(list.at(10)).toBe(2)
  })
})

describe('the anchor', () => {
  test('history arriving above keeps the row being read where it was', () => {
    const keys = ['c', 'd', 'e']
    const before = plain([30, 30, 30])
    const anchor = anchorAt(before, keys, 40)
    expect(anchor).toEqual({ key: 'd', offset: -10 })

    const after = plain([25, 25, 30, 30, 30])
    expect(anchored(after, ['a', 'b', ...keys], anchor)).toBe(90)
  })

  test('a row that went leaves the scroll alone', () => {
    expect(anchored(plain([10]), ['x'], { key: 'gone', offset: 0 })).toBeNull()
    expect(anchorAt(plain([]), [], 0)).toBeNull()
  })
})

describe('at the size of a long chat', () => {
  test('100,000 rows: built, measured and walked without a pass over the chat', () => {
    const count = 100_000
    const list = plain(Array.from({ length: count }, (_, i) => 20 + (i % 7)))
    let expected = 0
    for (let i = 0; i < count; i++) expected += 20 + (i % 7)
    expect(list.total).toBe(expected)

    const started = performance.now()
    for (let i = 0; i < 10_000; i++) {
      const row = (i * 7919) % count
      list.set(row, 40)
      const top = list.top(row)
      expect(list.at(top)).toBe(row)
    }
    // Ten thousand measurements and lookups: a pass over the chat each would be a
    // billion steps and many seconds; a walk each is a few milliseconds.
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
