import { describe, expect, test } from 'vitest'
import { bandOf, slides } from './tree-lift'

/** A row 28 pixels tall whose top is at 100, which is what a row under a pointer
 *  is; the thumb-sized one is twice that. */
const TOP = 100
const TALL = 28

describe('which part of a row the pointer is in', () => {
  test('the thin band at the top is the space above the row', () => {
    expect(bandOf(TOP, TOP, TALL)).toBe('before')
    expect(bandOf(TOP + 6, TOP, TALL)).toBe('before')
  })

  test('the thin band at the bottom is the space below it', () => {
    expect(bandOf(TOP + TALL - 1, TOP, TALL)).toBe('after')
    expect(bandOf(TOP + 22, TOP, TALL)).toBe('after')
  })

  test('the middle of it is the row itself, which a drop goes into', () => {
    expect(bandOf(TOP + 8, TOP, TALL)).toBe('on')
    expect(bandOf(TOP + 14, TOP, TALL)).toBe('on')
    expect(bandOf(TOP + 20, TOP, TALL)).toBe('on')
  })

  test('half the row is still the row, at either scale the list is drawn at', () => {
    // 28 under a pointer, 56 under a thumb; see `tokenRow` in row-window.svelte.ts.
    for (const height of [28, 56]) {
      const middle = [...Array(height).keys()].filter(
        (along) => bandOf(TOP + along, TOP, height) === 'on',
      )
      expect(middle.length / height, `${height}`).toBeGreaterThanOrEqual(0.5)
    }
  })

  test('a row of no height is all middle, since there is nothing to divide', () => {
    expect(bandOf(TOP, TOP, 0)).toBe('on')
  })
})

describe('how far each row has to slide', () => {
  const was = new Map([
    ['a.md', 0],
    ['b.md', 28],
    ['c.md', 56],
  ])

  test('a row that swapped places starts from where it was', () => {
    const now = new Map([
      ['a.md', 0],
      ['b.md', 56],
      ['c.md', 28],
    ])

    expect([...slides(was, now)]).toEqual([
      ['b.md', -28],
      ['c.md', 28],
    ])
  })

  test('a row that did not move is left out', () => {
    expect(slides(was, was).size).toBe(0)
  })

  test('the row being carried is left out: it is drawn under the pointer', () => {
    const now = new Map([
      ['a.md', 28],
      ['b.md', 0],
      ['c.md', 56],
    ])

    expect([...slides(was, now, ['b.md'])]).toEqual([['a.md', -28]])
  })

  test('a row only one measurement knows has nowhere to slide from', () => {
    const now = new Map([
      ['b.md', 0],
      ['d.md', 28],
    ])

    expect([...slides(was, now)]).toEqual([['b.md', 28]])
  })
})
