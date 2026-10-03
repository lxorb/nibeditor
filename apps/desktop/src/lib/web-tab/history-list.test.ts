import { describe, expect, test } from 'vitest'
import { answers, dayName, dayOf, historyRows, hostOf, onScreen } from './history-list'
import type { Visit } from './visits'

/** Noon on a Saturday, on this computer's clock, so the days are the machine's own. */
const NOW = new Date(2026, 9, 3, 12, 0).getTime()
const HOUR = 3_600_000

function visit(url: string, last: number, title = ''): Visit {
  return { url, title, visits: 1, typed: 0, last }
}

describe('the History page', () => {
  test('lists the newest first, a heading before each day', () => {
    const rows = historyRows(
      [
        visit('https://a.example/', NOW - 30 * HOUR),
        visit('https://b.example/', NOW - HOUR),
        visit('https://c.example/', NOW - 2 * HOUR),
      ],
      '',
    )
    expect(rows.map((one) => (one.kind === 'day' ? 'day' : one.visit.url))).toEqual([
      'day',
      'https://b.example/',
      'https://c.example/',
      'day',
      'https://a.example/',
    ])
    expect(rows[0]).toMatchObject({ kind: 'day', day: dayOf(NOW) })
  })

  test('finds a page by every word, in its title or its address, any case', () => {
    const one = visit('https://svelte.dev/docs/runes', NOW, 'Runes • Svelte docs')
    expect(answers(one, 'svelte RUNES')).toBe(true)
    expect(answers(one, 'docs runes')).toBe(true)
    expect(answers(one, 'svelte react')).toBe(false)
    expect(answers(one, '   ')).toBe(true)
    expect(historyRows([one, visit('https://react.dev/', NOW)], 'svelte')).toHaveLength(2)
  })

  test('calls today and yesterday by name, and the rest by date', () => {
    const words = { today: 'Today', yesterday: 'Yesterday' }
    expect(dayName(dayOf(NOW), NOW, 'en', words)).toBe('Today')
    expect(dayName(dayOf(NOW - 24 * HOUR), NOW, 'en', words)).toBe('Yesterday')
    expect(dayName(dayOf(NOW - 72 * HOUR), NOW, 'en', words)).toBe('Wednesday, September 30')
    // Another year says its year.
    expect(dayName(dayOf(new Date(2025, 0, 2).getTime()), NOW, 'en', words)).toContain('2025')
  })

  test('shows the host without www, as the list reads it', () => {
    expect(hostOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
    expect(hostOf('not an address')).toBe('not an address')
  })

  /** Two thousand rows are drawn a screenful at a time. */
  test('draws the rows on screen and a few either side', () => {
    expect(onScreen(0, 280, 28, 2000)).toEqual({ from: 0, to: 18 })
    expect(onScreen(28 * 100, 280, 28, 2000)).toEqual({ from: 92, to: 118 })
    expect(onScreen(28 * 1995, 280, 28, 2000)).toEqual({ from: 1987, to: 2000 })
    expect(onScreen(0, 0, 28, 0)).toEqual({ from: 0, to: 0 })
  })
})
