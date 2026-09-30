import { describe, expect, test } from 'vitest'
import { laidOut, pagesAsked, quadsOver, quoteIn, type Run } from './pdf-text'
import { Refused } from './problem'

/** A line of runs as pdf.js hands them over: words, where each starts, how wide. */
function line(y: number, ...parts: [string, number, number][]): Run[] {
  return parts.map(([str, x, width]) => ({
    str,
    transform: [10, 0, 0, 10, x, y],
    width,
    height: 10,
  }))
}

describe('the pages asked for', () => {
  test('are a printer dialog range, in order, each once, inside the PDF', () => {
    expect(pagesAsked('3-5,1,4', 10)).toEqual([1, 3, 4, 5])
    expect(pagesAsked('8-20', 10)).toEqual([8, 9, 10])
    expect(pagesAsked(null, 3)).toEqual([1, 2, 3])
  })

  test('refuse what is not one', () => {
    expect(() => pagesAsked('first', 3)).toThrow(Refused)
    expect(() => pagesAsked('1-x', 3)).toThrow(Refused)
  })
})

describe('a quote on a page', () => {
  const runs = [
    ...line(700, ['The quick ', 72, 100], ['brown fox', 172, 90]),
    ...line(680, ['jumps over', 72, 100]),
  ]

  test('is found across runs and line breaks, whatever the spaces', () => {
    const found = quoteIn(runs, 'quick  brown\nfox')
    expect(found).toHaveLength(1)
    const [place] = found
    expect(laidOut(runs).text.slice(place?.from, place?.to)).toBe('quick brown fox')
  })

  test('says every place it is', () => {
    expect(quoteIn(line(700, ['a b a b', 0, 70]), 'a b')).toHaveLength(2)
    expect(quoteIn(runs, 'lazy dog')).toEqual([])
  })

  test('is covered by one band per line, in PDF user space, clockwise from the top left', () => {
    const [place] = quoteIn(runs, 'fox jumps')
    if (!place) throw new Error('found')

    const quads = quadsOver(runs, place.from, place.to)
    expect(quads).toHaveLength(2)

    // `fox` is the last three of the nine characters of its run.
    const [first] = quads
    expect(first?.[0]).toBeCloseTo(172 + 90 * (6 / 9))
    expect(first?.[2]).toBeCloseTo(262)
    // Above the baseline at the top, below it at the bottom.
    expect(first?.[1]).toBeGreaterThan(700)
    expect(first?.[5]).toBeLessThan(700)
  })
})
