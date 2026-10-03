import { describe, expect, test } from 'vitest'
import { FROZEN_AFTER, isSaver, overCap, rest, type Resting, SAVING } from './resting'

/** A page out of sight on numbers: frozen after five minutes and never taken down, unless
 *  Memory saver is on; see resting.ts. */

const NOW = 1_000_000_000
const MINUTES = 60_000
const HOURS = 60 * MINUTES

/** A page out of sight for `minutes`, with nothing going on in it. */
function page(id: string, minutes: number, more: Partial<Resting> = {}): Resting {
  return {
    id,
    live: true,
    onScreen: false,
    frozen: false,
    looked: NOW - minutes * MINUTES,
    loading: false,
    playing: false,
    heard: 0,
    acting: false,
    calling: false,
    notifying: false,
    edited: false,
    pinned: false,
    inPrivate: false,
    ...more,
  }
}

describe('with Memory saver off, which is where it starts', () => {
  test('a page out of sight is frozen at five minutes and asked about again then', () => {
    expect(rest(page('a', 0), 'off', NOW)).toEqual({ act: null, again: FROZEN_AFTER })
    expect(rest(page('a', 4), 'off', NOW)).toEqual({ act: null, again: MINUTES })
    expect(rest(page('a', 5), 'off', NOW)).toEqual({ act: 'freeze', again: null })
  })

  test('is never taken down, however long it is out of sight', () => {
    expect(rest(page('a', 10 * 60), 'off', NOW).act).toBe('freeze')
    expect(rest(page('a', 10 * 60, { frozen: true }), 'off', NOW)).toEqual({
      act: null,
      again: null,
    })
  })

  test('nor for how many are running', () => {
    const many = Array.from({ length: 40 }, (_, at) => page(`p${String(at)}`, at))
    expect(overCap(many, 'off', NOW)).toEqual([])
  })
})

describe('what is never frozen', () => {
  test('the page on screen, nor one under a menu', () => {
    expect(rest(page('a', 60, { onScreen: true }), 'off', NOW).act).toBeNull()
  })

  test.each([
    ['playing', { playing: true }],
    ['heard two minutes ago', { heard: NOW - 2 * MINUTES }],
    ['loading', { loading: true }],
    ['in a call', { calling: true }],
    ['waiting to notify', { notifying: true }],
    ['acted in by an agent', { acting: true }],
  ])('a page %s, asked about again a freeze later', (_, more) => {
    expect(rest(page('a', 60, more), 'off', NOW)).toEqual({ act: null, again: FROZEN_AFTER })
  })

  test('a page heard more than five minutes ago is quiet', () => {
    expect(rest(page('a', 60, { heard: NOW - 6 * MINUTES }), 'off', NOW).act).toBe('freeze')
  })
})

describe('with Memory saver on', () => {
  test('a page out of sight is parked after its strength’s time, frozen before', () => {
    const { after } = SAVING.maximum
    expect(rest(page('a', 29), 'maximum', NOW)).toEqual({ act: 'freeze', again: MINUTES })
    expect(rest(page('a', 29, { frozen: true }), 'maximum', NOW).act).toBeNull()
    expect(rest(page('a', after / MINUTES, { frozen: true }), 'maximum', NOW)).toEqual({
      act: 'park',
      again: null,
    })
  })

  test('each strength waits as long as it says', () => {
    expect(rest(page('a', 5 * 60), 'moderate', NOW).act).toBe('freeze')
    expect(rest(page('a', 6 * 60), 'moderate', NOW).act).toBe('park')
    expect(rest(page('a', 3 * 60), 'balanced', NOW).act).toBe('freeze')
    expect(rest(page('a', 4 * 60), 'balanced', NOW).act).toBe('park')
    expect(SAVING.moderate.after).toBe(6 * HOURS)
  })

  test('beyond its count, the pages looked at longest ago go first', () => {
    const pages = Array.from({ length: 9 }, (_, at) => page(`p${String(at)}`, at))
    expect(overCap(pages, 'maximum', NOW)).toEqual(['p8', 'p7', 'p6'])
    expect(overCap(pages, 'balanced', NOW)).toEqual([])
  })

  test('never the page on screen or any in a pane on screen, even over its count', () => {
    const pages = Array.from({ length: 9 }, (_, at) =>
      page(`p${String(at)}`, at, { onScreen: at > 5 }),
    )
    expect(overCap(pages, 'maximum', NOW)).toEqual(['p5', 'p4', 'p3'])
    const shown = Array.from({ length: 9 }, (_, at) =>
      page(`p${String(at)}`, at, { onScreen: true }),
    )
    expect(overCap(shown, 'maximum', NOW)).toEqual([])
  })

  test.each([
    ['playing', { playing: true }],
    ['in a call', { calling: true }],
    ['waiting to notify', { notifying: true }],
    ['acted in by an agent', { acting: true }],
    ['typed into', { edited: true }],
    ['pinned', { pinned: true }],
    ['private', { inPrivate: true }],
  ])('never one %s, by its time or its count', (_, more) => {
    expect(rest(page('a', 10 * 60, { frozen: true, ...more }), 'maximum', NOW).act).toBeNull()
    const pages = [
      page('a', 10 * 60, more),
      ...Array.from({ length: 6 }, (_, at) => page(`p${String(at)}`, at)),
    ]
    expect(overCap(pages, 'maximum', NOW)).not.toContain('a')
  })

  test('a page that cannot be taken down yet is asked about again a freeze later', () => {
    expect(rest(page('a', 60, { frozen: true, edited: true }), 'maximum', NOW)).toEqual({
      act: null,
      again: FROZEN_AFTER,
    })
  })
})

test('a setting read back is one of the four, or nothing', () => {
  expect(['off', 'moderate', 'balanced', 'maximum'].every(isSaver)).toBe(true)
  expect(isSaver('on')).toBe(false)
  expect(isSaver(null)).toBe(false)
})
