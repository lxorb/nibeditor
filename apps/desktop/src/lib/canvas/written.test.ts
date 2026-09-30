import { describe, expect, test } from 'vitest'
import { changesBetween, type Replacement, written } from './written'

/** The replacements put into the old file, last first so each keeps its offsets. */
function applied(text: string, changes: readonly Replacement[]): string {
  return [...changes]
    .sort((one, other) => other.from - one.from)
    .reduce((out, one) => out.slice(0, one.from) + one.insert + out.slice(one.to), text)
}

const text = (runs: readonly (readonly string[])[]) => written(runs).text

describe('what changed between two writes of a plane', () => {
  const head = ['{\n']
  const ink = ['a', ',', 'b', ',', 'c']
  const tail = ['\n}\n']

  test('is nothing at all where nothing did', () => {
    expect(changesBetween(written([head, ink, tail]), [head, [...ink], tail])).toEqual([])
  })

  test('is the one piece a stroke drawn adds, and nothing before it', () => {
    const after = [head, [...ink, ',', 'd'], tail]
    const changes = changesBetween(written([head, ink, tail]), after) ?? []

    expect(changes).toEqual([{ from: 7, to: 7, insert: ',d' }])
    expect(applied(text([head, ink, tail]), changes)).toBe(text(after))
  })

  test('is the piece taken out of the middle, where one is rubbed out', () => {
    const after = [head, ['a', ',', 'c'], tail]
    const changes = changesBetween(written([head, ink, tail]), after) ?? []

    expect(changes.reduce((sum, one) => sum + one.to - one.from, 0)).toBe(2)
    expect(applied(text([head, ink, tail]), changes)).toBe(text(after))
  })

  test('is one replacement per run that moved, however far apart they are', () => {
    const times = ['"a": 1\n', '"b": 1\n', '"c": 1']
    const after = [head, [...ink, ',', 'd'], ['"a": 1\n', '"b": 1\n', '"c": 1\n', '"d": 2'], tail]
    const changes = changesBetween(written([head, ink, times, tail]), after) ?? []

    expect(changes).toHaveLength(2)
    expect(applied(text([head, ink, times, tail]), changes)).toBe(text(after))
  })

  test('is not worked out for two files laid out differently', () => {
    expect(changesBetween(written([head, tail]), [head, ink, tail])).toBeNull()
  })
})
