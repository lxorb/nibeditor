import { describe, expect, test } from 'vitest'
import { byPin, type Pinnable, pinnedRun, placeFor } from './pinning'

/** A strip, written as the reader sees it: an upper-case letter for a tab that is
 *  pinned and a lower-case one for a tab that is not. So `PPab` is two kept tabs
 *  and two ordinary ones, which is what the rule here is about. */
function strip(shape: string): (Pinnable & { name: string })[] {
  const rows: (Pinnable & { name: string })[] = []
  for (const name of shape) rows.push({ name, pinned: name === name.toUpperCase() })

  return rows
}

/** That strip with a tab put at a place in it, spelled the same way, so a test
 *  says where a tab landed rather than what index it was given. */
function landed(shape: string, tab: string, at: number | null): string {
  const rows = strip(shape)
  const put = placeFor(rows, tab === tab.toUpperCase(), at) ?? rows.length

  return [
    ...rows.slice(0, put).map((one) => one.name),
    tab,
    ...rows.slice(put).map((one) => one.name),
  ].join('')
}

describe('the run of pinned tabs at the head of a strip', () => {
  test('is as long as the tabs that are pinned', () => {
    expect(pinnedRun(strip('PPab'))).toBe(2)
    expect(pinnedRun(strip('abc'))).toBe(0)
    expect(pinnedRun(strip('PP'))).toBe(2)
    expect(pinnedRun([])).toBe(0)
  })

  /** The run is the head of the strip, so it stops at the first tab that is not
   *  pinned however many are behind it. What puts such a strip right is `byPin`. */
  test('and stops at the first tab that is not one, whatever follows', () => {
    expect(pinnedRun(strip('PaPb'))).toBe(1)
    expect(pinnedRun(strip('aPP'))).toBe(0)
  })
})

describe('where a tab may land in a strip', () => {
  test('a pinned tab joins the run wherever in it it was asked for', () => {
    expect(landed('PPab', 'Q', 0)).toBe('QPPab')
    expect(landed('PPab', 'Q', 1)).toBe('PQPab')
    expect(landed('PPab', 'Q', 2)).toBe('PPQab')
  })

  /** A hand that overshot by a few pixels meant the end of the run: the drop does
   *  what can be done rather than nothing at all. */
  test('and is held at the end of the run when it is asked for past it', () => {
    expect(landed('PPab', 'Q', 3)).toBe('PPQab')
    expect(landed('PPab', 'Q', 99)).toBe('PPQab')
    expect(landed('PPab', 'Q', null)).toBe('PPQab')
  })

  test('and lands at the head of a strip that has no run yet', () => {
    expect(landed('abc', 'Q', 2)).toBe('Qabc')
    expect(landed('abc', 'Q', null)).toBe('Qabc')
    expect(landed('', 'Q', null)).toBe('Q')
  })

  test('a tab that is not pinned takes any place after the run', () => {
    expect(landed('PPab', 'c', 2)).toBe('PPcab')
    expect(landed('PPab', 'c', 3)).toBe('PPacb')
    expect(landed('PPab', 'c', null)).toBe('PPabc')
  })

  /** Dropped in front of the kept tabs, it lands at the first place that is not
   *  one of them: the strip the reader sees is what the drop is read against. */
  test('and never in front of it, however far in front it was dropped', () => {
    expect(landed('PPab', 'c', 0)).toBe('PPcab')
    expect(landed('PPab', 'c', 1)).toBe('PPcab')
  })

  test('and lands where it was asked for where nothing is pinned', () => {
    expect(landed('abc', 'd', 0)).toBe('dabc')
    expect(landed('abc', 'd', 2)).toBe('abdc')
  })
})

describe('a strip put back in order', () => {
  /** A session written by a build that let a pinned tab sit further along, or one
   *  edited by hand: it opens with the kept tabs at the head and everything else
   *  in the order it was written in. */
  test('brings the pinned tabs to the head, each run in the order it was in', () => {
    expect(
      byPin(strip('aPbQ'))
        .map((one) => one.name)
        .join(''),
    ).toBe('PQab')
  })

  test('and leaves a strip that is already in order exactly as it was', () => {
    for (const shape of ['PPab', 'abc', 'PP', '']) {
      expect(
        byPin(strip(shape))
          .map((one) => one.name)
          .join(''),
      ).toBe(shape)
    }
  })
})
